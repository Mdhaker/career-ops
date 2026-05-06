/**
 * sync-to-web.mjs
 * Syncs local CLI data to Supabase so the web UI reflects CLI work.
 *
 * Usage:
 *   node sync-to-web.mjs              # sync all
 *   node sync-to-web.mjs --tracker    # sync applications.md only
 *   node sync-to-web.mjs --reports    # sync reports/ only
 *   node sync-to-web.mjs --pdfs       # sync output/ PDFs only
 *
 * Requires .env with:
 *   SUPABASE_URL=https://xxx.supabase.co
 *   SUPABASE_SERVICE_KEY=your_service_role_key   (NOT the anon key)
 *   SUPABASE_USER_ID=your_user_uuid              (from Supabase Auth dashboard)
 */

import { readFileSync, readdirSync, existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join, basename } from 'path'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_USER_ID } = process.env

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_USER_ID) {
  console.error('❌ Missing env vars. Check SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_USER_ID in .env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const args = process.argv.slice(2)
const runAll = args.length === 0
const runTracker = runAll || args.includes('--tracker')
const runReports = runAll || args.includes('--reports')
const runPdfs = runAll || args.includes('--pdfs')

// ── Parse applications.md ─────────────────────────────────────────────────────

function parseApplicationsMd(content) {
  const rows = []
  const lines = content.split('\n')
  let seqNum = 1

  for (const line of lines) {
    if (!line.startsWith('|') || line.startsWith('| #') || line.startsWith('|---') || line.startsWith('| ---')) continue
    const cols = line.split('|').map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1)
    if (cols.length < 5) continue

    const [num, date, company, role, score, status, pdf, report, ...notesParts] = cols
    if (!company || company === 'Company') continue

    const parsedScore = parseFloat(score)
    rows.push({
      user_id: SUPABASE_USER_ID,
      seq_num: parseInt(num) || seqNum,
      date: parseDate(date),
      company: company || '',
      role: role || '',
      score: isNaN(parsedScore) ? null : parsedScore,
      status: normalizeStatus(status),
      pdf_url: pdf && pdf !== '—' && pdf !== '-' ? pdf : null,
      report_url: report && report !== '—' && report !== '-' ? report : null,
      notes: notesParts.join(' | ').trim() || null,
    })
    seqNum++
  }
  return rows
}

function parseDate(raw) {
  if (!raw) return new Date().toISOString().split('T')[0]
  const cleaned = raw.trim()
  // Try ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned
  // Try DD/MM/YYYY
  const ddmm = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (ddmm) return `${ddmm[3]}-${ddmm[2].padStart(2,'0')}-${ddmm[1].padStart(2,'0')}`
  // Try YYYY/MM/DD
  const yyyymm = cleaned.match(/^(\d{4})\/(\d{2})\/(\d{2})$/)
  if (yyyymm) return `${yyyymm[1]}-${yyyymm[2]}-${yyyymm[3]}`
  return new Date().toISOString().split('T')[0]
}

const STATUS_MAP = {
  'evaluated': 'Evaluated', 'eval': 'Evaluated',
  'applied': 'Applied', 'apply': 'Applied',
  'responded': 'Responded', 'response': 'Responded',
  'interview': 'Interview', 'interviewing': 'Interview',
  'offer': 'Offer',
  'rejected': 'Rejected', 'reject': 'Rejected',
  'discarded': 'Discarded', 'discard': 'Discarded',
  'skip': 'SKIP',
}

function normalizeStatus(raw) {
  if (!raw) return 'Evaluated'
  const key = raw.trim().toLowerCase()
  return STATUS_MAP[key] ?? 'Evaluated'
}

// ── Sync tracker ──────────────────────────────────────────────────────────────

async function syncTracker() {
  const trackerPath = join(process.cwd(), 'data', 'applications.md')
  if (!existsSync(trackerPath)) {
    console.log('⚠️  data/applications.md not found, skipping tracker sync')
    return
  }

  const content = readFileSync(trackerPath, 'utf8')
  const rows = parseApplicationsMd(content)

  if (rows.length === 0) {
    console.log('ℹ️  No application rows found in applications.md')
    return
  }

  console.log(`📋 Syncing ${rows.length} applications...`)

  let upserted = 0
  for (const row of rows) {
    const { error } = await supabase
      .from('applications')
      .upsert(row, { onConflict: 'user_id,seq_num' })
    if (error) {
      console.error(`  ❌ Failed to upsert ${row.company} #${row.seq_num}: ${error.message}`)
    } else {
      upserted++
    }
  }

  console.log(`  ✅ ${upserted}/${rows.length} applications synced`)
}

// ── Sync reports ──────────────────────────────────────────────────────────────

async function syncReports() {
  const reportsDir = join(process.cwd(), 'reports')
  if (!existsSync(reportsDir)) {
    console.log('⚠️  reports/ directory not found, skipping report sync')
    return
  }

  const files = readdirSync(reportsDir).filter(f => f.endsWith('.md'))
  console.log(`📄 Syncing ${files.length} reports...`)

  let synced = 0
  for (const file of files) {
    const filePath = join(reportsDir, file)
    const content = await readFile(filePath, 'utf8')

    // Parse company slug from filename: {###}-{company-slug}-{YYYY-MM-DD}.md
    const match = file.match(/^(\d+)-(.+)-(\d{4}-\d{2}-\d{2})\.md$/)
    if (!match) {
      console.log(`  ⚠️  Skipping ${file} (unexpected filename format)`)
      continue
    }

    const [, seqStr, , date] = match
    const seqNum = parseInt(seqStr)

    // Upload to storage
    const storagePath = `${SUPABASE_USER_ID}/reports/${file}`
    const { error: uploadError } = await supabase.storage
      .from('reports')
      .upload(storagePath, content, { contentType: 'text/markdown', upsert: true })

    if (uploadError) {
      console.error(`  ❌ Storage upload failed for ${file}: ${uploadError.message}`)
      continue
    }

    const { data: { publicUrl } } = supabase.storage.from('reports').getPublicUrl(storagePath)

    // Extract score from report content
    const scoreMatch = content.match(/\*\*Score[^:]*:\*\*\s*([\d.]+)/i)
      ?? content.match(/Score[^:]*:\s*([\d.]+)\s*\/\s*5/i)
    const score = scoreMatch ? parseFloat(scoreMatch[1]) : null

    // Extract legitimacy tier
    const legitMatch = content.match(/\*\*Legitimacy[^:]*:\*\*\s*(.+)/i)
    const legitimacy = legitMatch ? legitMatch[1].trim() : null

    // Update matching application by seq_num
    const { error: updateError } = await supabase
      .from('applications')
      .update({
        report_url: publicUrl,
        report_content: content.slice(0, 50000), // store first 50k chars inline
        ...(score !== null && { score }),
        ...(legitimacy && { legitimacy }),
      })
      .eq('user_id', SUPABASE_USER_ID)
      .eq('seq_num', seqNum)

    if (updateError) {
      console.error(`  ❌ DB update failed for report ${file}: ${updateError.message}`)
    } else {
      synced++
    }
  }

  console.log(`  ✅ ${synced}/${files.length} reports synced`)
}

// ── Sync PDFs ─────────────────────────────────────────────────────────────────

async function syncPdfs() {
  const outputDir = join(process.cwd(), 'output')
  if (!existsSync(outputDir)) {
    console.log('⚠️  output/ directory not found, skipping PDF sync')
    return
  }

  const files = readdirSync(outputDir).filter(f => f.endsWith('.pdf'))
  console.log(`📎 Syncing ${files.length} PDFs...`)

  let synced = 0
  for (const file of files) {
    const filePath = join(outputDir, file)
    const buffer = await readFile(filePath)

    const storagePath = `${SUPABASE_USER_ID}/pdfs/${file}`
    const { error: uploadError } = await supabase.storage
      .from('pdfs')
      .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: true })

    if (uploadError) {
      console.error(`  ❌ PDF upload failed for ${file}: ${uploadError.message}`)
      continue
    }

    const { data: { publicUrl } } = supabase.storage.from('pdfs').getPublicUrl(storagePath)

    // Try to match by filename pattern {###}-{company}-{role}.pdf or {company}-{role}.pdf
    const seqMatch = file.match(/^(\d+)-/)
    if (seqMatch) {
      const seqNum = parseInt(seqMatch[1])
      await supabase
        .from('applications')
        .update({ pdf_url: publicUrl })
        .eq('user_id', SUPABASE_USER_ID)
        .eq('seq_num', seqNum)
    }

    synced++
  }

  console.log(`  ✅ ${synced}/${files.length} PDFs synced`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('🔄 career-ops sync-to-web starting...\n')

if (runTracker) await syncTracker()
if (runReports) await syncReports()
if (runPdfs) await syncPdfs()

console.log('\n✅ Sync complete. Open your web app to see the results.')
