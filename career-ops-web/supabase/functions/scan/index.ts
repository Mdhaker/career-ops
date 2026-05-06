/**
 * Edge Function: scan
 *
 * POST /functions/v1/scan
 * Body: { user_id: string }
 *
 * Reads tracked_companies + search_queries from DB,
 * hits ATS APIs directly (Greenhouse, Ashby, Lever),
 * filters by title_filters, deduplicates against existing applications,
 * returns new job listings (does NOT auto-evaluate — user reviews first).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
    const { user_id } = await req.json()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Load config from DB
    const [
      { data: companies },
      { data: titleFilter },
      { data: existingApps },
    ] = await Promise.all([
      supabase.from('tracked_companies').select('*').eq('user_id', user_id).eq('enabled', true),
      supabase.from('title_filters').select('*').eq('user_id', user_id).maybeSingle(),
      supabase.from('applications').select('url, company, role').eq('user_id', user_id),
    ])

    const positive = titleFilter?.positive ?? []
    const negative = titleFilter?.negative ?? []

    // Build dedup set from existing apps
    const existingUrls = new Set((existingApps ?? []).map(a => a.url).filter(Boolean))
    const existingKeys = new Set(
      (existingApps ?? []).map(a => `${a.company?.toLowerCase()}::${a.role?.toLowerCase()}`)
    )

    const results: JobListing[] = []
    const scanRunId = crypto.randomUUID()

    // Insert scan run record
    await supabase.from('scan_runs').insert({
      id: scanRunId,
      user_id,
      status: 'running',
    })

    for (const company of (companies ?? [])) {
      try {
        let jobs: JobListing[] = []

        if (company.scan_method === 'api' && company.api_url) {
          jobs = await scanViaApi(company)
        } else if (company.scan_method === 'playwright') {
          // Playwright not available in Edge Functions — skip with note
          console.log(`⚠️  ${company.name}: playwright scan requires CLI. Skipping in edge function.`)
          continue
        } else {
          continue
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
        console.error(`Error scanning ${company.name}: ${e}`)
      }
    }

    // Update scan run
    await supabase.from('scan_runs').update({
      finished_at: new Date().toISOString(),
      status: 'completed',
      new_count: results.length,
    }).eq('id', scanRunId)

    return new Response(JSON.stringify({ results, scan_run_id: scanRunId, total: results.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

// ── ATS API scanners ──────────────────────────────────────────────────────────

async function scanViaApi(company: { name: string; api_url: string; careers_url: string; api_provider: string | null }): Promise<JobListing[]> {
  const provider = company.api_provider ?? detectProvider(company.api_url)

  if (provider === 'greenhouse') return scanGreenhouse(company)
  if (provider === 'ashby') return scanAshby(company)
  if (provider === 'lever') return scanLever(company)
  if (provider === 'teamtailor') return scanTeamtailor(company)

  // Generic JSON fetch — try to extract jobs array
  const res = await fetch(company.api_url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) return []
  const data = await res.json()
  return extractGenericJobs(data, company.name, company.careers_url)
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
