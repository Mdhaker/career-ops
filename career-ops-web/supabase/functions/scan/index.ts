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
const COMPANY_TIMEOUT_MS = 12000  // max time per company before giving up
const BATCH_SIZE = 1              // sequential (rate limiting requires serialization)
const GEMINI_MIN_GAP_MS = 4000    // ~15 RPM free tier limit (4s between Gemini calls)

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

    console.log(`[scan] Fetching config for user: ${user_id?.slice(0, 8)}...`)

    const [
      { data: companies, error: companiesErr },
      { data: titleFilter, error: filterErr },
      { data: existingApps, error: appsErr },
    ] = await Promise.all([
      companiesQuery,
      supabase.from('title_filters').select('*').eq('user_id', user_id).maybeSingle(),
      supabase.from('applications').select('url, company, role').eq('user_id', user_id),
    ])

    console.log(`[scan] Companies: ${companies?.length ?? 0}, Filter: ${titleFilter ? 'yes' : 'no'}, Existing apps: ${existingApps?.length ?? 0}`)
    if (companiesErr) console.error('[scan] Companies error:', companiesErr)
    if (filterErr) console.error('[scan] Filter error:', filterErr)
    if (appsErr) console.error('[scan] Apps error:', appsErr)

    const positive: string[] = titleFilter?.positive ?? []
    const negative: string[] = titleFilter?.negative ?? []

    const existingUrls = new Set((existingApps ?? []).map((a: Record<string, string>) => a.url).filter(Boolean))
    const existingKeys = new Set(
      (existingApps ?? []).map((a: Record<string, string>) => `${a.company?.toLowerCase()}::${a.role?.toLowerCase()}`)
    )

    type LogEntry = { company: string; url: string; status: 'ok'|'error'; method: string; found: number; new: number; error?: string }
    type ScanResult = { entry: LogEntry; jobs: JobListing[] }

    const scanRunId = crypto.randomUUID()
    const openaiKey = Deno.env.get('OPENAI_API_KEY')

    // Support multiple Gemini keys (comma-separated) for quota rotation
    const geminiKeysRaw = Deno.env.get('GEMINI_API_KEYS') || Deno.env.get('GEMINI_API_KEY') || ''
    const geminiKeys = geminiKeysRaw.split(',').map((k: string) => k.trim()).filter(Boolean)
    let currentKeyIndex = 0
    let lastGeminiCall = 0

    console.log(`[scan] Starting scan run: ${scanRunId.slice(0, 8)}...`)
    const { error: runInsertErr } = await supabase.from('scan_runs').insert({ id: scanRunId, user_id, status: 'running' })
    if (runInsertErr) {
      console.error('[scan] Failed to insert scan run:', runInsertErr)
    } else {
      console.log('[scan] Scan run inserted')
    }

    // Rate-limited Gemini call wrapper with key rotation on 429
    async function callGeminiRateLimited(companyName: string, careersUrl: string): Promise<JobListing[]> {
      const now = Date.now()
      const elapsed = now - lastGeminiCall
      if (elapsed < GEMINI_MIN_GAP_MS) {
        await sleep(GEMINI_MIN_GAP_MS - elapsed)
      }

      while (currentKeyIndex < geminiKeys.length) {
        const key = geminiKeys[currentKeyIndex]
        lastGeminiCall = Date.now()
        try {
          console.log(`[scan:${companyName}] Using Gemini key #${currentKeyIndex + 1}/${geminiKeys.length}`)
          return await scanViaGemini(key, companyName, careersUrl)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (msg.includes('429') || msg.includes('quota')) {
            console.warn(`[scan:${companyName}] Key #${currentKeyIndex + 1} quota exceeded, rotating...`)
            currentKeyIndex++
            if (currentKeyIndex >= geminiKeys.length) break
            // Continue loop with next key
          } else {
            throw e // Non-quota error, propagate it
          }
        }
      }
      throw new Error('All Gemini keys quota exceeded')
    }

    // scanCompany: fetch jobs for one company, return structured result
    async function scanCompany(company: { name: string; careers_url: string; api_url?: string; api_provider?: string; [k: string]: unknown }): Promise<ScanResult> {
      console.log(`[scan:${company.name}] Starting...`)
      let jobs: JobListing[] = []
      let method = 'unknown'
      let logError: string | undefined

      try {
        console.log(`[scan:${company.name}] Detecting API...`)
        const detected = detectApi(company)
        if (detected) {
          method = detected.type + '-api'
          console.log(`[scan:${company.name}] Using ${method}: ${detected.url}`)
          jobs = await withTimeout(scanViaDetectedApi(detected, company.name), COMPANY_TIMEOUT_MS)
          console.log(`[scan:${company.name}] API returned ${jobs.length} jobs`)
        } else if (geminiKey) {
          method = 'gemini'
          console.log(`[scan:${company.name}] Using Gemini to scrape: ${company.careers_url}`)
          jobs = await withTimeout(callGeminiRateLimited(company.name, company.careers_url), COMPANY_TIMEOUT_MS)
          console.log(`[scan:${company.name}] Gemini returned ${jobs.length} jobs`)
        } else {
          console.log(`[scan:${company.name}] No API detected and no Gemini key available`)
        }
      } catch (e) {
        console.error(`[scan:${company.name}] Error:`, e)
        const msg = e instanceof Error ? e.message : String(e)
        const isQuota = msg.includes('429') || msg.includes('quota')
        if (!isQuota && openaiKey) {
          console.log(`[scan:${company.name}] Trying OpenAI fallback...`)
          try {
            method = 'openai'
            jobs = await withTimeout(scanViaOpenAI(openaiKey, company.name, company.careers_url), COMPANY_TIMEOUT_MS)
            console.log(`[scan:${company.name}] OpenAI returned ${jobs.length} jobs`)
          } catch (e2) {
            console.error(`[scan:${company.name}] OpenAI fallback failed:`, e2)
            logError = simplifyError(e2 instanceof Error ? e2.message : String(e2))
          }
        } else {
          logError = simplifyError(msg)
        }
      }

      return {
        jobs,
        entry: { company: company.name, url: company.careers_url, status: logError ? 'error' : 'ok', method, found: jobs.length, new: 0, ...(logError && { error: logError }) },
      }
    }

    // Process companies sequentially to respect Gemini 4s rate limit
    const companiesList = (companies ?? []) as { name: string; careers_url: string; api_url?: string; api_provider?: string; [k: string]: unknown }[]
    console.log(`[scan] Processing ${companiesList.length} companies sequentially (4s gap for Gemini)`)

    const scanResults: ScanResult[] = []
    for (let i = 0; i < companiesList.length; i++) {
      const company = companiesList[i]
      console.log(`[scan] ${i + 1}/${companiesList.length}: ${company.name}`)

      try {
        const result = await scanCompany(company)
        scanResults.push(result)
        console.log(`[scan] ${company.name}: ${result.entry.status} (${result.entry.found} jobs)`)
      } catch (err) {
        console.error(`[scan] ${company.name} crashed:`, err)
        scanResults.push({
          entry: { company: company.name, url: company.careers_url, status: 'error' as const, method: 'unknown', found: 0, new: 0, error: `Crash: ${err instanceof Error ? err.message : String(err)}` },
          jobs: [],
        })
      }
    }

    // Deduplicate and count new
    const results: JobListing[] = []
    for (const { jobs, entry } of scanResults) {
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
      entry.new = newCount
    }

    const scanLog = scanResults.map(r => r.entry)
    const errors = scanLog.filter(e => e.status === 'error').map(e => `${e.company}: ${e.error}`)

    console.log(`[scan] Finished. New jobs: ${results.length}, Errors: ${errors.length}`)

    const { error: runUpdateErr } = await supabase.from('scan_runs').update({
      finished_at: new Date().toISOString(),
      status: errors.length ? 'completed_with_errors' : 'completed',
      new_count: results.length,
      log: errors.length ? errors.join('\n') : null,
    }).eq('id', scanRunId)

    if (runUpdateErr) console.error('[scan] Failed to update scan run:', runUpdateErr)

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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timed out')), ms)),
  ])
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
