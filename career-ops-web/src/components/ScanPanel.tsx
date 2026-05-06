import { useState } from 'react'
import { Loader2, Search, CheckCircle2, AlertCircle, Plus, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import { useScan, useEvaluate } from '@/hooks/useActions.ts'
import { Button } from '@/components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.tsx'
import { cn } from '@/lib/utils.ts'

interface JobListing {
  title: string
  company: string
  url: string
  source: string
  posted_at?: string
}

interface ScanLogEntry {
  company: string
  url: string
  status: 'ok' | 'error' | 'skipped'
  method: string
  found: number
  new: number
  error?: string
}

const METHOD_LABEL: Record<string, string> = {
  'greenhouse-api': 'Greenhouse API',
  'ashby-api': 'Ashby API',
  'lever-api': 'Lever API',
  'gemini': 'AI scrape',
  'openai': 'AI scrape',
  'generic-api': 'API',
}

export function ScanPanel({ onClose }: { onClose: () => void }) {
  const scan = useScan()
  const evaluate = useEvaluate()
  const [results, setResults] = useState<JobListing[]>([])
  const [scanLog, setScanLog] = useState<ScanLogEntry[]>([])
  const [evaluated, setEvaluated] = useState<Set<string>>(new Set())
  const [evaluating, setEvaluating] = useState<string | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [logExpanded, setLogExpanded] = useState(false)

  const handleScan = async () => {
    setResults([])
    setScanLog([])
    setEvaluated(new Set())
    const data = await scan.mutateAsync()
    setResults(data.results ?? [])
    setScanLog(data.scan_log ?? [])
    setTotal(data.total ?? 0)
  }

  const handleEvaluate = async (job: JobListing) => {
    setEvaluating(job.url)
    try {
      await evaluate.mutateAsync({ url: job.url })
      setEvaluated(e => new Set([...e, job.url]))
    } catch {
      // error shown inline
    } finally {
      setEvaluating(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center p-4">
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <Search className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-semibold">Scan Portals</h2>
          </div>
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-600">Close</button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {/* Trigger */}
          {total === null && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">ATS API Scanner</CardTitle>
                <CardDescription>
                  Scans your tracked companies via Greenhouse, Ashby, Lever APIs.
                  Results are filtered by your title filters and deduplicated against existing applications.
                  Playwright scans require the CLI — use <code className="font-mono text-xs bg-gray-100 px-1 rounded">node scan.mjs</code> for those.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={handleScan} disabled={scan.isPending} className="gap-1.5">
                  {scan.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Scanning...</>
                  ) : (
                    <><Search className="h-4 w-4" /> Start scan</>
                  )}
                </Button>
                {scan.isError && (
                  <div className="mt-3 flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3">
                    <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-red-700">
                      {scan.error instanceof Error ? scan.error.message : 'Scan failed'}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Results */}
          {total !== null && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <p className="text-sm font-medium text-gray-700">
                    {total} new job{total !== 1 ? 's' : ''} found
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={handleScan} disabled={scan.isPending} className="gap-1">
                  {scan.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  Rescan
                </Button>
              </div>

              {/* Scan log */}
              {scanLog.length > 0 && (
                <div className="mb-4 rounded-lg border border-gray-100 bg-gray-50 overflow-hidden">
                  <button
                    className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-gray-500 hover:bg-gray-100"
                    onClick={() => setLogExpanded(e => !e)}
                  >
                    <span>Scan log — {scanLog.length} companies</span>
                    {logExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                  {logExpanded && (
                    <div className="divide-y divide-gray-100 max-h-52 overflow-y-auto">
                      {scanLog.map((entry, i) => (
                        <div key={i} className="flex items-center gap-3 px-3 py-2">
                          <span className={cn('shrink-0 h-1.5 w-1.5 rounded-full', entry.status === 'ok' ? 'bg-green-400' : 'bg-red-400')} />
                          <span className="text-xs font-medium text-gray-700 w-28 shrink-0 truncate">{entry.company}</span>
                          <span className="text-xs text-gray-400 w-20 shrink-0">{METHOD_LABEL[entry.method] ?? entry.method}</span>
                          {entry.status === 'ok' ? (
                            <span className="text-xs text-gray-500">
                              {entry.found} found{entry.new > 0 ? `, ${entry.new} new` : ''}
                            </span>
                          ) : (
                            <span className="text-xs text-red-500">{entry.error}</span>
                          )}
                          <a href={entry.url} target="_blank" rel="noopener noreferrer" className="ml-auto text-gray-300 hover:text-blue-400">
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {results.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">
                  No new matching jobs found. All results are already in your pipeline or filtered out.
                </p>
              ) : (
                <div className="space-y-2">
                  {results.map(job => {
                    const isEvaluated = evaluated.has(job.url)
                    const isEvaluating = evaluating === job.url
                    return (
                      <div
                        key={job.url}
                        className={cn(
                          'flex items-start gap-3 rounded-lg border p-3 transition-colors',
                          isEvaluated ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-gray-900 truncate">{job.title}</p>
                          <p className="text-xs text-gray-500">{job.company}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{job.source}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <a href={job.url} target="_blank" rel="noopener noreferrer">
                            <button className="text-gray-300 hover:text-blue-500 transition-colors">
                              <ExternalLink className="h-4 w-4" />
                            </button>
                          </a>
                          {isEvaluated ? (
                            <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                              <CheckCircle2 className="h-3.5 w-3.5" /> In pipeline
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              className="h-7 text-xs gap-1"
                              disabled={isEvaluating || evaluate.isPending}
                              onClick={() => handleEvaluate(job)}
                            >
                              {isEvaluating ? (
                                <><Loader2 className="h-3 w-3 animate-spin" /> Evaluating...</>
                              ) : (
                                <><Plus className="h-3 w-3" /> Evaluate</>
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 px-6 py-3 flex justify-end">
          <Button variant="outline" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  )
}
