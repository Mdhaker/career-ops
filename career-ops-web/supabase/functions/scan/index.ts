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

const GEMINI_MODEL = 'gemini-2.5-flash-preview-04-17'

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
    const scanRunId = crypto.randomUUID()

    await supabase.from('scan_runs').insert({ id: scanRunId, user_id, status: 'running' })

    for (const company of (companies ?? [])) {
      try {
        let jobs: JobListing[] = []

        // Try direct ATS API first (fast, free)
        const api = detectApi(company)
        if (api) {
          jobs = await scanViaDetectedApi(api, company.name)
          console.log(`[api] ${company.name}: ${jobs.length} jobs`)
        } else {
          // Fall back to Gemini scraping
          console.log(`[gemini] ${company.name}: scraping ${company.careers_url}`)
          jobs = await scanViaGemini(geminiKey, company.name, company.careers_url)
          console.log(`[gemini] ${company.name}: ${jobs.length} jobs`)
        }

        for (const job of jobs) {
          if (!passesFilter(job.title, positive, negative)) continue
          if (existingUrls.has(job.url)) continue
          const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`
          if (existingKeys.has(key)) continue
          results.push(job)
          existingUrls.add(job.url)
          existingKeys.add(key)
        }
      } catch (e) {
        const msg = `${company.name}: ${e instanceof Error ? e.message : e}`
        console.error(msg)
        errors.push(msg)
      }
    }

    await supabase.from('scan_runs').update({
      finished_at: new Date().toISOString(),
      status: 'completed',
      new_count: results.length,
      log: errors.length ? errors.join('\n') : null,
    }).eq('id', scanRunId)

    return new Response(JSON.stringify({ results, scan_run_id: scanRunId, total: results.length, errors }), {
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
  const prompt = `You are a job listing extractor.

Fetch the careers page at: ${careersUrl}

Extract ALL job listings currently posted on that page.
Return ONLY a JSON array, no markdown, no explanation:
[
  { "title": "...", "url": "...", "location": "..." },
  ...
]

Rules:
- Include every job you find, do not filter by relevance
- URL must be the direct link to the job posting (absolute URL)
- If no URL is available for a job, use the careers page URL
- If the page has no jobs, return []
- Return ONLY the JSON array, nothing else`

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ url_context: {} }],
        generationConfig: { maxOutputTokens: 4096, temperature: 0 },
      }),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini API error: ${err.slice(0, 200)}`)
  }

  const data = await res.json()
  const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'

  // Extract JSON array from response
  const jsonMatch = text.match(/\[\s*[\s\S]*\]/)
  if (!jsonMatch) return []

  const parsed = JSON.parse(jsonMatch[0]) as Array<{ title: string; url: string; location?: string }>
  return parsed
    .filter(j => j.title)
    .map(j => ({
      title: j.title.trim(),
      company: companyName,
      url: j.url ?? careersUrl,
      source: 'gemini-scrape',
      posted_at: '',
    }))
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
