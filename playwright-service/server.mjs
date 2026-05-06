/**
 * Playwright Scraping Microservice
 * Scrapes careers pages and extracts job listings.
 *
 * Usage:
 *   node server.mjs
 *
 * Exposes:
 *   POST /scrape  { url, company }  → { jobs: [{ title, url, company, location }] }
 *   GET  /health                    → { status: "ok" }
 *
 * Keep this running locally, then expose via ngrok:
 *   npx ngrok http 3001
 * Set the HTTPS ngrok URL as PLAYWRIGHT_SERVICE_URL in Supabase secrets.
 */

import { createServer } from 'http'
import { chromium } from 'playwright'

const PORT = process.env.PORT || 3001
const AUTH_TOKEN = process.env.AUTH_TOKEN || null  // optional — set to secure the endpoint

async function scrapeJobs(pageUrl, companyName) {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  })
  const page = await context.newPage()

  try {
    await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 30_000 })
    await page.waitForTimeout(2000)

    const jobs = await page.evaluate((company) => {
      const results = []
      const seen = new Set()

      // Common job link patterns across ATS and careers pages
      const selectors = [
        'a[href*="/jobs/"]',
        'a[href*="/careers/"]',
        'a[href*="/job/"]',
        'a[href*="/opening"]',
        'a[href*="/position"]',
        'a[href*="greenhouse.io"]',
        'a[href*="ashbyhq.com"]',
        'a[href*="lever.co"]',
        'a[href*="workday.com"]',
        'a[href*="myworkdayjobs.com"]',
        'a[href*="bamboohr.com"]',
        'a[href*="teamtailor"]',
      ]

      for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) {
          const href = el.href
          const text = el.textContent?.trim()
          if (!href || !text || text.length < 3 || text.length > 150) continue
          if (seen.has(href)) continue
          seen.add(href)

          // Skip navigation links, homepage links
          if (/^(home|about|blog|contact|team|company|culture|benefits|apply now)$/i.test(text)) continue

          // Try to find a location near the link
          const parent = el.closest('li, tr, div[class*="job"], div[class*="position"], div[class*="opening"], article') || el.parentElement
          const locationEl = parent?.querySelector('[class*="location"], [class*="city"], [class*="office"]')
          const location = locationEl?.textContent?.trim() || ''

          results.push({ title: text, url: href, company, location })
        }
      }

      // Deduplicate by title+url
      const unique = []
      const titlesSeen = new Set()
      for (const job of results) {
        const key = `${job.title.toLowerCase()}::${job.url}`
        if (!titlesSeen.has(key)) {
          titlesSeen.add(key)
          unique.push(job)
        }
      }

      return unique.slice(0, 200)
    }, companyName)

    return jobs
  } finally {
    await browser.close()
  }
}

const server = createServer(async (req, res) => {
  // Auth check
  if (AUTH_TOKEN) {
    const authHeader = req.headers['authorization'] ?? ''
    if (!authHeader.endsWith(AUTH_TOKEN)) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }
  }

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok' }))
    return
  }

  if (req.method === 'POST' && req.url === '/scrape') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', async () => {
      try {
        const { url, company } = JSON.parse(body)
        if (!url) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'url is required' }))
          return
        }

        console.log(`[scrape] ${company ?? 'unknown'} → ${url}`)
        const jobs = await scrapeJobs(url, company ?? 'Unknown')
        console.log(`[scrape] found ${jobs.length} jobs`)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jobs }))
      } catch (err) {
        console.error('[scrape] error:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  res.writeHead(404)
  res.end()
})

server.listen(PORT, () => {
  console.log(`\n🎭 Playwright scraping service running on http://localhost:${PORT}`)
  console.log(`   POST /scrape  { url, company }`)
  console.log(`   GET  /health`)
  if (AUTH_TOKEN) console.log(`   Auth token: ${AUTH_TOKEN}`)
  console.log(`\n   To expose publicly: npx ngrok http ${PORT}`)
  console.log(`   Then set in Supabase: PLAYWRIGHT_SERVICE_URL=https://xxxx.ngrok.io\n`)
})
