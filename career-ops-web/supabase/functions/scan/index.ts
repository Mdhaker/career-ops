/**
 * Edge Function: scan
 *
 * POST /functions/v1/scan
 * Body: { user_id: string, company_ids?: string[] }
 *
 * Reads tracked_companies + title_filters from DB.
 * For each enabled company:
 *   - If it has a detectable ATS API (Greenhouse/Ashby/Lever) → hits it directly
 *   - Otherwise → asks Gemini to fetch and parse the careers page
 * Deduplicates against existing applications, returns new listings.
 *
 * Required secrets: GEMINI_API_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GEMINI_MODEL = 'gemini-2.0-flash-lite'
const SCAN_DELAY_MS = 2000  // delay between companies to avoid rate limiting

interface JobListing {
  title: string
  company: string
  url: string
  source: string
  posted_at?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { user_id, company_ids } = await req.json()
    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    if (!geminiKey) throw new Error('GEMINI_API_KEY secret not set')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Load config from DB
    let companiesQuery = supabase.from('tracked_companies').select('*').eq('user_id', user_id).eq('enabled', true)
    if (company_ids?.length) companiesQuery = companiesQuery.in('id', company_ids)

    const [
      { data: companies },
      { data: titleFilter },
      { data: existingApps },
    ] = await Promise.all([
      companiesQuery,
      supabase.from('title_filters').select('*').eq('user_id', user_id).maybeSingle(),
      supabase.from('applications').select('url, company, role').eq('user_id', user_id),
    ])

    const positive: string[] = titleFilter?.positive ?? []
    const negative: string[] = titleFilter?.negative ?? []

    const existingUrls = new Set((existingApps ?? []).map((a: Record<string, string>) => a.url).filter(Boolean))
    const existingKeys = new Set(
      (existingApps ?? []).map((a: Record<string, string>) => `${a.company?.toLowerCase()}::${a.role?.toLowerCase()}`)
    )

    const results: JobListing[] = []
    const errors: string[] = []
    const scanLog: Array<{ company: string; url: string; status: 'ok' | 'error' | 'skipped'; method: string; found: number; new: number; error?: string }> = []
    const scanRunId = crypto.randomUUID()

    await supabase.from('scan_runs').insert({ id: scanRunId, user_id, status: 'running' })

    let companyIdx = 0
    for (const company of (companies ?? [])) {
      if (companyIdx > 0) await sleep(SCAN_DELAY_MS)
      companyIdx++
      try {
        let jobs: JobListing[] = []

        let method = 'unknown'
        let logError: string | undefined

        // Try direct ATS API first (fast, free, no tokens)
        const api = detectApi(company)
        if (api) {
          method = api.type + '-api'
          jobs = await scanViaDetectedApi(api, company.name)
        } else {
          const openaiKey = Deno.env.get('OPENAI_API_KEY')
          try {
            method = 'gemini'
            jobs = await scanViaGemini(geminiKey, company.name, company.careers_url)
          } catch (geminiErr) {
            const errMsg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr)
            const isQuota = errMsg.includes('429') || errMsg.includes('quota')
            if (isQuota) {
              await sleep(10000)
              try {
                jobs = await scanViaGemini(geminiKey, company.name, company.careers_url)
              } catch {
                logError = 'Rate limited'
                errors.push(`${company.name}: rate limited`)
              }
            } else if (openaiKey) {
              method = 'openai'
              jobs = await scanViaOpenAI(openaiKey, company.name, company.careers_url)
            } else {
              logError = simplifyError(errMsg)
              errors.push(`${company.name}: ${logError}`)
            }
          }
        }

        let newCount = 0
        for (const job of jobs) {
          if (!passesFilter(job.title, positive, negative)) continue
          if (existingUrls.has(job.url)) continue
          const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`
          if (existingKeys.has(key)) continue
          results.push(job)
          existingUrls.add(job.url)
          existingKeys.add(key)
          newCount++
        }

        scanLog.push({
          company: company.name,
          url: company.careers_url,
          status: logError ? 'error' : 'ok',
          method,
          found: jobs.length,
          new: newCount,
          ...(logError && { error: logError }),
        })
      } catch (e) {
        const msg = simplifyError(e instanceof Error ? e.message : String(e))
        errors.push(`${company.name}: ${msg}`)
        scanLog.push({ company: company.name, url: company.careers_url, status: 'error', method: 'unknown', found: 0, new: 0, error: msg })
      }
    }

    await supabase.from('scan_runs').update({
      finished_at: new Date().toISOString(),
      status: 'completed',
      new_count: results.length,
      log: errors.length ? errors.join('\n') : null,
    }).eq('id', scanRunId)

    return new Response(JSON.stringify({ results, scan_run_id: scanRunId, total: results.length, errors, scan_log: scanLog }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

// ── Gemini scraper ────────────────────────────────────────────────────────────

async function scanViaGemini(apiKey: string, companyName: string, careersUrl: string): Promise<JobListing[]> {
  const prompt = buildScrapePrompt(companyName, careersUrl)

  // Try with url_context tool (Gemini 2.0 flash supports it)
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ urlContext: {} }],
        generationConfig: { maxOutputTokens: 4096, temperature: 0 },
      }),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini API error: ${err.slice(0, 300)}`)
  }

  const data = await res.json()
  // Concatenate all text parts (url_context may split response)
  const parts = data.candidates?.[0]?.content?.parts ?? []
  const text: string = parts.map((p: Record<string, unknown>) => p.text ?? '').join('')

  return parseJobsFromText(text, companyName, careersUrl)
}

async function scanViaOpenAI(apiKey: string, companyName: string, careersUrl: string): Promise<JobListing[]> {
  // Fetch page content first, then ask OpenAI to parse it
  const pageRes = await fetch(careersUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(15000),
  })
  if (!pageRes.ok) throw new Error(`Could not fetch ${careersUrl}: ${pageRes.status}`)

  const html = await pageRes.text()
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{3,}/g, '\n')
    .slice(0, 12000)

  const prompt = `${buildScrapePrompt(companyName, careersUrl)}\n\nPage content:\n---\n${text}\n---`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 4096,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`OpenAI API error: ${await res.text()}`)
  const data = await res.json()
  return parseJobsFromText(data.choices[0].message.content, companyName, careersUrl)
}

function buildScrapePrompt(companyName: string, careersUrl: string): string {
  return `Extract ALL job listings from the careers page of ${companyName}: ${careersUrl}

Return ONLY a valid JSON array, no markdown fences, no explanation:
[{"title":"...","url":"...","location":"..."}]

- Every job must have a title
- url must be absolute (https://...); if unavailable use ${careersUrl}
- If no jobs found return []
- Output ONLY the JSON array, nothing else`
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function simplifyError(msg: string): string {
  if (msg.includes('429') || msg.includes('quota') || msg.includes('rate')) return 'Rate limited'
  if (msg.includes('404') || msg.includes('not found')) return 'Page not found (404)'
  if (msg.includes('timed out') || msg.includes('timeout')) return 'Timed out'
  if (msg.includes('fetch') || msg.includes('network') || msg.includes('ECONNREFUSED')) return 'Could not reach page'
  if (msg.includes('JSON') || msg.includes('parse')) return 'Unexpected page format'
  return msg.slice(0, 80)
}

function parseJobsFromText(text: string, companyName: string, careersUrl: string): JobListing[] {
  // Strip markdown code fences if present
  const cleaned = text.replace(/```[a-z]*\n?/gi, '').trim()
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return []
  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{ title: string; url: string; location?: string }>
    return parsed
      .filter(j => j.title && typeof j.title === 'string')
      .map(j => ({
        title: j.title.trim(),
        company: companyName,
        url: (j.url && j.url.startsWith('http')) ? j.url : careersUrl,
        source: 'ai-scrape',
        posted_at: '',
      }))
  } catch {
    return []
  }
}

// ── ATS API auto-detection ────────────────────────────────────────────────────

interface DetectedApi { type: string; url: string }

function detectApi(company: { careers_url: string; api_url?: string; api_provider?: string }): DetectedApi | null {
  // Explicit api_url set by user
  if (company.api_url) {
    const provider = company.api_provider ?? detectProvider(company.api_url)
    return { type: provider ?? 'generic', url: company.api_url }
  }

  const url = company.careers_url ?? ''

  const ashby = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/)
  if (ashby) return { type: 'ashby', url: `https://api.ashbyhq.com/posting-api/job-board/${ashby[1]}` }

  const lever = url.match(/jobs\.lever\.co\/([^/?#]+)/)
  if (lever) return { type: 'lever', url: `https://api.lever.co/v0/postings/${lever[1]}` }

  const gh = url.match(/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/)
  if (gh) return { type: 'greenhouse', url: `https://boards-api.greenhouse.io/v1/boards/${gh[1]}/jobs` }

  return null
}

async function scanViaDetectedApi(api: DetectedApi, companyName: string): Promise<JobListing[]> {
  if (api.type === 'greenhouse') return scanGreenhouse({ name: companyName, api_url: api.url })
  if (api.type === 'ashby') return scanAshby({ name: companyName, api_url: api.url, careers_url: '' })
  if (api.type === 'lever') return scanLever({ name: companyName, api_url: api.url, careers_url: '' })

  const res = await fetch(api.url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) return []
  const data = await res.json()
  return extractGenericJobs(data, companyName, api.url)
}

async function scanGreenhouse(company: { name: string; api_url: string }): Promise<JobListing[]> {
  const res = await fetch(company.api_url)
  if (!res.ok) return []
  const data = await res.json()
  const jobs = data.jobs ?? data.greenhouse_jobs ?? data ?? []
  return Array.isArray(jobs) ? jobs.map((j: Record<string, unknown>) => ({
    title: String(j.title ?? ''),
    company: company.name,
    url: String(j.absolute_url ?? j.url ?? ''),
    source: 'greenhouse-api',
    posted_at: String(j.updated_at ?? j.created_at ?? ''),
  })).filter(j => j.url) : []
}

async function scanAshby(company: { name: string; api_url: string; careers_url: string }): Promise<JobListing[]> {
  // Derive board identifier from careers URL or api_url
  const boardMatch = (company.api_url + company.careers_url).match(/ashbyhq\.com\/([^/?#]+)/)
  if (!boardMatch) return []
  const board = boardMatch[1]

  const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${board}`)
  if (!res.ok) return []
  const data = await res.json()
  const jobs = data.jobs ?? []
  return jobs.map((j: Record<string, unknown>) => ({
    title: String(j.title ?? ''),
    company: company.name,
    url: String(j.jobUrl ?? j.applyUrl ?? ''),
    source: 'ashby-api',
    posted_at: String(j.publishedDate ?? ''),
  })).filter((j: JobListing) => j.url)
}

async function scanLever(company: { name: string; api_url: string; careers_url: string }): Promise<JobListing[]> {
  const boardMatch = (company.api_url + company.careers_url).match(/lever\.co\/([^/?#]+)/)
  if (!boardMatch) return []
  const board = boardMatch[1]

  const res = await fetch(`https://api.lever.co/v0/postings/${board}?mode=json`)
  if (!res.ok) return []
  const jobs = await res.json()
  return Array.isArray(jobs) ? jobs.map((j: Record<string, unknown>) => ({
    title: String(j.text ?? ''),
    company: company.name,
    url: String(j.hostedUrl ?? j.applyUrl ?? ''),
    source: 'lever-api',
    posted_at: j.createdAt ? new Date(Number(j.createdAt)).toISOString() : '',
  })).filter(j => j.url) : []
}

async function scanTeamtailor(company: { name: string; api_url: string }): Promise<JobListing[]> {
  const res = await fetch(company.api_url, {
    headers: { 'Authorization': `Token token=${Deno.env.get('TEAMTAILOR_API_KEY') ?? ''}` }
  })
  if (!res.ok) return []
  const data = await res.json()
  const jobs = data.data ?? []
  return jobs.map((j: Record<string, unknown>) => {
    const attrs = j.attributes as Record<string, unknown> ?? {}
    const links = j.links as Record<string, unknown> ?? {}
    return {
      title: String(attrs.title ?? ''),
      company: company.name,
      url: String(links['careersite-job-url'] ?? links.self ?? ''),
      source: 'teamtailor-api',
    }
  }).filter((j: JobListing) => j.url)
}

function extractGenericJobs(data: unknown, companyName: string, baseUrl: string): JobListing[] {
  const arr = Array.isArray(data) ? data
    : (data as Record<string, unknown>)?.jobs ?? (data as Record<string, unknown>)?.postings ?? []
  if (!Array.isArray(arr)) return []
  return arr.slice(0, 50).map((j: Record<string, unknown>) => ({
    title: String(j.title ?? j.name ?? ''),
    company: companyName,
    url: String(j.url ?? j.absolute_url ?? j.link ?? baseUrl),
    source: 'api',
  })).filter(j => j.title)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectProvider(url: string): string | null {
  if (url.includes('greenhouse.io')) return 'greenhouse'
  if (url.includes('ashbyhq.com')) return 'ashby'
  if (url.includes('lever.co')) return 'lever'
  if (url.includes('teamtailor.com')) return 'teamtailor'
  return null
}


function passesFilter(title: string, positive: string[], negative: string[]): boolean {
  const t = title.toLowerCase()
  if (positive.length > 0 && !positive.some(p => t.includes(p.toLowerCase()))) return false
  if (negative.some(n => t.includes(n.toLowerCase()))) return false
  return true
}
