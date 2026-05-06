import { useState } from 'react'
import { Loader2, Search, CheckCircle2, AlertCircle, Plus, ExternalLink } from 'lucide-react'
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

export function ScanPanel({ onClose }: { onClose: () => void }) {
  const scan = useScan()
  const evaluate = useEvaluate()
  const [results, setResults] = useState<JobListing[]>([])
  const [evaluated, setEvaluated] = useState<Set<string>>(new Set())
  const [evaluating, setEvaluating] = useState<string | null>(null)
  const [total, setTotal] = useState<number | null>(null)

  const handleScan = async () => {
    const data = await scan.mutateAsync()
    setResults(data.results ?? [])
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
