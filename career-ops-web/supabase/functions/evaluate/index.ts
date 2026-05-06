/**
 * Edge Function: evaluate
 *
 * POST /functions/v1/evaluate
 * Body: { url: string, jd_text?: string, user_id: string }
 *
 * Fetches the job posting, runs the full A-G evaluation via the AI API,
 * saves the report to the applications table and reports storage bucket.
 *
 * Required secrets (set via `supabase secrets set`):
 *   ANTHROPIC_API_KEY  or  GEMINI_API_KEY
 *   SUPABASE_SERVICE_ROLE_KEY  (auto-injected by Supabase)
 *   SUPABASE_URL               (auto-injected by Supabase)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { url: jobUrl, jd_text, user_id } = await req.json()

    if (!jobUrl && !jd_text) {
      return new Response(JSON.stringify({ error: 'Provide a job URL or JD text' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Fetch user profile + CV
    const { data: profile } = await supabase
      .from('profiles')
      .select('cv_markdown, full_name, target_roles, superpowers, comp_target, comp_minimum, remote_preference, headline, exit_story')
      .eq('user_id', user_id)
      .single()

    if (!profile?.cv_markdown) {
      return new Response(JSON.stringify({ error: 'No CV found in profile. Add your CV markdown in the Profile page first.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch JD if URL provided
    let jdContent = jd_text ?? ''
    if (jobUrl && !jd_text) {
      try {
        const res = await fetch(jobUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) })
        const html = await res.text()
        jdContent = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{3,}/g, '\n')
          .slice(0, 15000)
      } catch {
        return new Response(JSON.stringify({ error: 'Could not fetch the job URL. Try pasting the JD text instead.' }), {
          status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    const systemPrompt = buildSystemPrompt(profile)
    const userPrompt = buildEvaluationPrompt(jobUrl, jdContent)

    // Call AI
    let report: string
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    const geminiKey = Deno.env.get('GEMINI_API_KEY')

    if (anthropicKey) {
      report = await callAnthropic(anthropicKey, systemPrompt, userPrompt)
    } else if (geminiKey) {
      report = await callGemini(geminiKey, systemPrompt, userPrompt)
    } else {
      return new Response(JSON.stringify({ error: 'No AI API key configured. Set ANTHROPIC_API_KEY or GEMINI_API_KEY as Supabase secrets.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Parse score from report
    const scoreMatch = report.match(/\*\*(?:Overall\s+)?Score[^:]*:\*\*\s*([\d.]+)/i)
      ?? report.match(/Score[^:]*:\s*([\d.]+)\s*\/\s*5/i)
    const score = scoreMatch ? parseFloat(scoreMatch[1]) : null

    const legitMatch = report.match(/\*\*Legitimacy[^:]*:\*\*\s*(.+)/i)
    const legitimacy = legitMatch ? legitMatch[1].trim().split('\n')[0] : null

    const companyMatch = report.match(/\*\*Company[^:]*:\*\*\s*(.+)/i)
    const roleMatch = report.match(/\*\*Role[^:]*:\*\*\s*(.+)/i)
    const archetypeMatch = report.match(/\*\*Archetype[^:]*:\*\*\s*(.+)/i)

    const company = companyMatch ? companyMatch[1].trim().split('\n')[0] : 'Unknown'
    const role = roleMatch ? roleMatch[1].trim().split('\n')[0] : 'Unknown'
    const archetype = archetypeMatch ? archetypeMatch[1].trim().split('\n')[0] : null

    // Get next seq_num
    const { count } = await supabase
      .from('applications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user_id)
    const seqNum = (count ?? 0) + 1

    // Save report to storage
    const reportFilename = `${String(seqNum).padStart(3, '0')}-${slugify(company)}-${new Date().toISOString().split('T')[0]}.md`
    const storagePath = `${user_id}/reports/${reportFilename}`

    await supabase.storage
      .from('reports')
      .upload(storagePath, report, { contentType: 'text/markdown', upsert: true })

    const { data: { publicUrl: reportUrl } } = supabase.storage
      .from('reports')
      .getPublicUrl(storagePath)

    // Save application
    const { data: application, error: insertError } = await supabase
      .from('applications')
      .insert({
        user_id,
        seq_num: seqNum,
        date: new Date().toISOString().split('T')[0],
        company,
        role,
        score,
        status: 'Evaluated',
        url: jobUrl ?? null,
        archetype,
        legitimacy,
        report_url: reportUrl,
        report_content: report.slice(0, 50000),
      })
      .select()
      .single()

    if (insertError) throw insertError

    return new Response(JSON.stringify({ application, report }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

// ── AI Callers ────────────────────────────────────────────────────────────────

async function callAnthropic(apiKey: string, system: string, user: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 8192,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic API error: ${await res.text()}`)
  const data = await res.json()
  return data.content[0].text
}

async function callGemini(apiKey: string, system: string, user: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro-preview-05-06:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: 8192 },
      }),
    }
  )
  if (!res.ok) throw new Error(`Gemini API error: ${await res.text()}`)
  const data = await res.json()
  return data.candidates[0].content.parts[0].text
}

// ── Prompt Builders ───────────────────────────────────────────────────────────

function buildSystemPrompt(profile: Record<string, unknown>): string {
  return `You are Career-Ops, an expert job offer evaluator. Evaluate job offers with ruthless precision.

CANDIDATE PROFILE:
- Name: ${profile.full_name ?? 'Not set'}
- Headline: ${profile.headline ?? 'Not set'}
- Target roles: ${(profile.target_roles as string[] | undefined)?.join(', ') ?? 'Not set'}
- Superpowers: ${(profile.superpowers as string[] | undefined)?.join(', ') ?? 'Not set'}
- Compensation target: ${profile.comp_target ?? 'Not set'}
- Minimum: ${profile.comp_minimum ?? 'Not set'}
- Remote preference: ${profile.remote_preference ?? 'Not set'}
- Exit story: ${profile.exit_story ?? 'Not set'}

CV:
${profile.cv_markdown}

EVALUATION FRAMEWORK:
Produce a structured A–G evaluation report:

**Block A — Role Summary** (1–2 paragraphs)
Summarize the role, company, and what makes it interesting or not.

**Block B — CV Match** (score 1–5, half-points allowed)
List top 3 strengths, top 3 gaps, and mitigation strategies for each gap.
**Score B: X/5**

**Block C — Level & Strategy** (score 1–5)
Assess seniority alignment, growth potential, archetype fit.
**Archetype: [archetype name]**
**Score C: X/5**

**Block D — Compensation & Demand** (score 1–5)
Assess compensation vs candidate target. Note if undisclosed.
**Score D: X/5**

**Block E — Personalization Plan**
Top 3 CV tweaks needed. Key phrases to inject. LinkedIn headline adjustment.

**Block F — Interview Plan**
Top 5 likely questions. 2 STAR+R stories from CV that apply.

**Block G — Posting Legitimacy**
Assess: real company, real role, not a ghost posting, not a scam.
**Legitimacy: [High Confidence | Proceed with Caution | Suspicious]**

**Overall Score: X/5** (weighted average of B, C, D)
**Recommendation: [Strong Apply | Apply | Borderline | Skip]**

Be specific, direct, and honest. Do not pad.`
}

function buildEvaluationPrompt(url: string | undefined, jdContent: string): string {
  return `Please evaluate this job offer.

${url ? `Job URL: ${url}\n` : ''}
Job Description / Page Content:
---
${jdContent}
---

Produce the full A–G evaluation report as specified.`
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
}
