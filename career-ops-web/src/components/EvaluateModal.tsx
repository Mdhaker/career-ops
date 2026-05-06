import { useState } from 'react'
import { Loader2, Sparkles, X, ExternalLink, AlertCircle } from 'lucide-react'
import { useEvaluate } from '@/hooks/useActions.ts'
import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Label } from '@/components/ui/label.tsx'
import { Textarea } from '@/components/ui/textarea.tsx'
import { scoreColor, scoreLabel } from '@/lib/utils.ts'
import type { Application } from '@/types/database.ts'

interface Props {
  onClose: () => void
  onDone?: (app: Application) => void
}

export function EvaluateModal({ onClose, onDone }: Props) {
  const evaluate = useEvaluate()
  const [mode, setMode] = useState<'url' | 'text'>('url')
  const [url, setUrl] = useState('')
  const [jdText, setJdText] = useState('')
  const [result, setResult] = useState<{ application: Application; report: string } | null>(null)
  const [reportExpanded, setReportExpanded] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const data = await evaluate.mutateAsync({
      url: mode === 'url' ? url : undefined,
      jd_text: mode === 'text' ? jdText : undefined,
    })
    setResult(data)
    if (onDone) onDone(data.application)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-semibold">Evaluate Job Offer</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4">
          {!result ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Mode toggle */}
              <div className="flex gap-1 rounded-lg bg-gray-100 p-1 w-fit">
                {(['url', 'text'] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      mode === m ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {m === 'url' ? 'Job URL' : 'Paste JD'}
                  </button>
                ))}
              </div>

              {mode === 'url' ? (
                <div className="space-y-1.5">
                  <Label>Job posting URL</Label>
                  <Input
                    required
                    type="url"
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    placeholder="https://jobs.ashbyhq.com/anthropic/..."
                  />
                  <p className="text-xs text-gray-400">
                    The page will be fetched and the text extracted automatically.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>Job description text</Label>
                  <Textarea
                    required
                    rows={10}
                    value={jdText}
                    onChange={e => setJdText(e.target.value)}
                    placeholder="Paste the full job description here..."
                    className="font-mono text-xs"
                  />
                </div>
              )}

              {evaluate.isError && (
                <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3">
                  <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-red-700">
                    {evaluate.error instanceof Error ? evaluate.error.message : 'Evaluation failed'}
                  </p>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1 gap-1.5" disabled={evaluate.isPending}>
                  {evaluate.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Evaluating… (30–60s)
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Evaluate with AI
                    </>
                  )}
                </Button>
              </div>

              {evaluate.isPending && (
                <p className="text-center text-xs text-gray-400 animate-pulse">
                  Running A–G evaluation blocks… this takes 30–60 seconds
                </p>
              )}
            </form>
          ) : (
            <div className="space-y-4">
              {/* Result summary */}
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-900">
                      {result.application.company} — {result.application.role}
                    </p>
                    {result.application.archetype && (
                      <p className="text-xs text-purple-600 mt-0.5">{result.application.archetype}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {result.application.score !== null && (
                      <span className={`rounded-full px-3 py-1 text-sm font-bold ${scoreColor(result.application.score)}`}>
                        {result.application.score.toFixed(1)}/5
                      </span>
                    )}
                  </div>
                </div>

                {result.application.score !== null && (
                  <p className="mt-2 text-sm text-gray-600">
                    <span className="font-medium">Recommendation:</span> {scoreLabel(result.application.score)}
                  </p>
                )}
                {result.application.legitimacy && (
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">Legitimacy:</span> {result.application.legitimacy}
                  </p>
                )}
              </div>

              {/* Report */}
              <div>
                <button
                  className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-800 mb-2"
                  onClick={() => setReportExpanded(e => !e)}
                >
                  {reportExpanded ? 'Hide' : 'Show'} full report
                </button>
                {reportExpanded && (
                  <div className="max-h-72 overflow-y-auto rounded-md border border-gray-200 bg-white p-4">
                    <pre className="whitespace-pre-wrap font-mono text-xs text-gray-700 leading-relaxed">
                      {result.report}
                    </pre>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                {result.application.url && (
                  <a href={result.application.url} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <ExternalLink className="h-3.5 w-3.5" /> Open job
                    </Button>
                  </a>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setResult(null); setUrl(''); setJdText('') }}
                >
                  Evaluate another
                </Button>
                <Button size="sm" onClick={onClose} className="ml-auto">
                  Done → Pipeline
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
