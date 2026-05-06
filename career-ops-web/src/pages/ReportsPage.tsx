import { useState } from 'react'
import { FileText, Download, ExternalLink, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { useApplications } from '@/hooks/useApplications.ts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import type { Application } from '@/types/database.ts'
import { scoreColor, scoreLabel, formatDate, cn } from '@/lib/utils.ts'

const LEGITIMACY_COLORS = {
  'High Confidence': 'success',
  'Proceed with Caution': 'warning',
  'Suspicious': 'destructive',
} as const

function ReportRow({ app }: { app: Application }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border-b border-gray-100 last:border-0">
      <div
        className="flex cursor-pointer items-center gap-4 px-6 py-3 hover:bg-gray-50"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-sm text-gray-900">{app.company}</p>
            {app.archetype && (
              <span className="hidden md:inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-xs text-purple-700">
                {app.archetype}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 truncate">{app.role}</p>
        </div>

        <div className="flex items-center gap-3">
          {app.score !== null && (
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', scoreColor(app.score))}>
              {app.score.toFixed(1)}/5
            </span>
          )}
          {app.legitimacy && (
            <Badge variant={LEGITIMACY_COLORS[app.legitimacy] ?? 'secondary'} className="hidden md:flex text-xs">
              {app.legitimacy}
            </Badge>
          )}
          <span className="text-xs text-gray-400 hidden md:block">{formatDate(app.date)}</span>
          {app.report_content || app.report_url ? (
            <FileText className="h-4 w-4 text-blue-400" />
          ) : (
            <FileText className="h-4 w-4 text-gray-200" />
          )}
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-6 pb-4">
          {/* Action buttons */}
          <div className="mb-3 flex flex-wrap gap-2">
            {app.url && (
              <a href={app.url} target="_blank" rel="noopener noreferrer">
                <button className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                  <ExternalLink className="h-3 w-3" /> Job posting
                </button>
              </a>
            )}
            {app.pdf_url && (
              <a href={app.pdf_url} target="_blank" rel="noopener noreferrer">
                <button className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                  <Download className="h-3 w-3" /> Download PDF
                </button>
              </a>
            )}
            {app.report_url && !app.report_content && (
              <a href={app.report_url} target="_blank" rel="noopener noreferrer">
                <button className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                  <FileText className="h-3 w-3" /> Open report
                </button>
              </a>
            )}
          </div>

          {/* Score breakdown */}
          {app.score !== null && (
            <div className="mb-3 flex items-center gap-2 rounded-md bg-gray-50 px-3 py-2">
              <span className={cn('rounded-full px-2.5 py-0.5 text-sm font-bold', scoreColor(app.score))}>
                {app.score.toFixed(1)}/5
              </span>
              <span className="text-sm text-gray-600">{scoreLabel(app.score)}</span>
              {app.legitimacy && (
                <>
                  <span className="text-gray-300">·</span>
                  <span className="text-sm text-gray-500">Legitimacy: {app.legitimacy}</span>
                </>
              )}
            </div>
          )}

          {/* Report content */}
          {app.report_content ? (
            <div className="max-h-96 overflow-y-auto rounded-md border border-gray-200 bg-white p-4">
              <pre className="whitespace-pre-wrap font-mono text-xs text-gray-700 leading-relaxed">
                {app.report_content}
              </pre>
            </div>
          ) : (
            <p className="rounded-md bg-gray-50 p-4 text-center text-xs text-gray-400">
              No report content stored. Reports generated via CLI are stored in <code className="font-mono">reports/</code> locally.
              {app.report_url && ' Use the "Open report" button above.'}
            </p>
          )}

          {app.notes && (
            <p className="mt-2 text-xs text-gray-500">
              <span className="font-medium">Notes:</span> {app.notes}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function ReportsPage() {
  const { data: applications = [], isLoading } = useApplications()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'with-report' | 'with-pdf'>('all')

  const withReports = applications.filter(a => a.report_content || a.report_url || a.pdf_url)

  const filtered = applications
    .filter(a => {
      if (filter === 'with-report') return a.report_content || a.report_url
      if (filter === 'with-pdf') return !!a.pdf_url
      return true
    })
    .filter(a =>
      !search ||
      a.company.toLowerCase().includes(search.toLowerCase()) ||
      a.role.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  const avgScore = applications.filter(a => a.score !== null).reduce((acc, a, _, arr) =>
    acc + (a.score ?? 0) / arr.length, 0
  )

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="text-sm text-gray-500 mt-1">Evaluation reports and generated CVs</p>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Total evaluated', value: applications.length },
          { label: 'With reports', value: withReports.length },
          { label: 'With PDF', value: applications.filter(a => a.pdf_url).length },
          { label: 'Avg score', value: applications.some(a => a.score !== null) ? `${avgScore.toFixed(1)}/5` : '—' },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          placeholder="Search company or role..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
          {(['all', 'with-report', 'with-pdf'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                filter === f ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              )}
            >
              {f === 'all' ? 'All' : f === 'with-report' ? 'Has report' : 'Has PDF'}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{filtered.length} applications</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {filtered.length === 0 ? (
              <p className="p-8 text-center text-sm text-gray-400">
                No applications match the current filter.
              </p>
            ) : (
              filtered.map(app => <ReportRow key={app.id} app={app} />)
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
