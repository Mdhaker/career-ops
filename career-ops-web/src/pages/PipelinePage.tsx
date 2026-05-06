import { useState } from 'react'
import { Plus, ExternalLink, FileText, Loader2, ChevronDown, Sparkles, Search } from 'lucide-react'
import { EvaluateModal } from '@/components/EvaluateModal.tsx'
import { ScanPanel } from '@/components/ScanPanel.tsx'
import { useApplications, useUpdateApplicationStatus, useDeleteApplication, useCreateApplication } from '@/hooks/useApplications.ts'
import { Button } from '@/components/ui/button.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Label } from '@/components/ui/label.tsx'
import { Textarea } from '@/components/ui/textarea.tsx'
import type { Application, ApplicationStatus } from '@/types/database.ts'
import { scoreColor, scoreLabel, formatDate, cn } from '@/lib/utils.ts'

const STATUSES: ApplicationStatus[] = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Discarded', 'SKIP']

const STATUS_COLORS: Record<ApplicationStatus, string> = {
  Evaluated: 'bg-gray-100 text-gray-700',
  Applied: 'bg-blue-100 text-blue-700',
  Responded: 'bg-purple-100 text-purple-700',
  Interview: 'bg-indigo-100 text-indigo-700',
  Offer: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-700',
  Discarded: 'bg-gray-100 text-gray-500',
  SKIP: 'bg-yellow-100 text-yellow-700',
}

const KANBAN_COLUMNS: ApplicationStatus[] = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer']

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return null
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold', scoreColor(score))}>
      {score.toFixed(1)}/5
    </span>
  )
}

function StatusSelect({ currentStatus, onUpdate }: { currentStatus: ApplicationStatus; onUpdate: (s: ApplicationStatus) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', STATUS_COLORS[currentStatus])}
      >
        {currentStatus}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 w-36 rounded-md border border-gray-200 bg-white shadow-lg">
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={(e) => { e.stopPropagation(); onUpdate(s); setOpen(false) }}
              className="block w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AddApplicationModal({ onClose }: { onClose: () => void }) {
  const create = useCreateApplication()
  const [form, setForm] = useState({ company: '', role: '', url: '', score: '', notes: '' })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await create.mutateAsync({
      company: form.company,
      role: form.role,
      url: form.url || null,
      score: form.score ? parseFloat(form.score) : null,
      status: 'Evaluated',
      notes: form.notes || null,
      pdf_url: null,
      report_url: null,
      report_content: null,
      archetype: null,
      legitimacy: null,
      seq_num: Date.now(),
      date: new Date().toISOString().split('T')[0],
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">Add Application</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label>Company *</Label>
            <Input required value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} placeholder="Anthropic" />
          </div>
          <div className="space-y-1">
            <Label>Role *</Label>
            <Input required value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} placeholder="Senior AI Engineer" />
          </div>
          <div className="space-y-1">
            <Label>Job URL</Label>
            <Input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://..." />
          </div>
          <div className="space-y-1">
            <Label>Score (1–5)</Label>
            <Input type="number" min="1" max="5" step="0.1" value={form.score} onChange={e => setForm(f => ({ ...f, score: e.target.value }))} placeholder="4.2" />
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="flex-1" disabled={create.isPending}>
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Add
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ApplicationCard({ app }: { app: Application }) {
  const updateStatus = useUpdateApplicationStatus()
  const deleteApp = useDeleteApplication()
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className="cursor-pointer rounded-lg border border-gray-200 bg-white p-3 shadow-sm hover:border-blue-200 hover:shadow-md transition-all"
      onClick={() => setExpanded(e => !e)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-gray-900 text-sm">{app.company}</p>
          <p className="truncate text-xs text-gray-500">{app.role}</p>
        </div>
        <ScoreBadge score={app.score} />
      </div>

      <div className="mt-2 flex items-center justify-between">
        <StatusSelect
          currentStatus={app.status}
          onUpdate={(s) => updateStatus.mutate({ id: app.id, status: s })}
        />
        <span className="text-xs text-gray-400">{formatDate(app.date)}</span>
      </div>

      {app.archetype && (
        <p className="mt-1 text-xs text-gray-400 truncate">{app.archetype}</p>
      )}

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3" onClick={e => e.stopPropagation()}>
          {app.score !== null && (
            <p className="text-xs text-gray-500">
              <span className="font-medium">Recommendation:</span> {scoreLabel(app.score)}
            </p>
          )}
          {app.legitimacy && (
            <p className="text-xs text-gray-500">
              <span className="font-medium">Legitimacy:</span> {app.legitimacy}
            </p>
          )}
          {app.notes && <p className="text-xs text-gray-500">{app.notes}</p>}
          <div className="flex gap-2 pt-1">
            {app.url && (
              <a href={app.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                  <ExternalLink className="h-3 w-3" /> Job
                </Button>
              </a>
            )}
            {app.report_url && (
              <a href={app.report_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                  <FileText className="h-3 w-3" /> Report
                </Button>
              </a>
            )}
            {app.pdf_url && (
              <a href={app.pdf_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                  PDF
                </Button>
              </a>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-red-500 hover:text-red-700 ml-auto"
              onClick={() => deleteApp.mutate(app.id)}
            >
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export function PipelinePage() {
  const { data: applications = [], isLoading } = useApplications()
  const [showAdd, setShowAdd] = useState(false)
  const [showEvaluate, setShowEvaluate] = useState(false)
  const [showScan, setShowScan] = useState(false)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'kanban' | 'list'>('kanban')

  const filtered = applications.filter(a =>
    !search ||
    a.company.toLowerCase().includes(search.toLowerCase()) ||
    a.role.toLowerCase().includes(search.toLowerCase())
  )

  const byStatus = (status: ApplicationStatus) => filtered.filter(a => a.status === status)

  const stats = {
    total: applications.length,
    applied: applications.filter(a => ['Applied', 'Responded', 'Interview', 'Offer'].includes(a.status)).length,
    interviews: applications.filter(a => a.status === 'Interview').length,
    offers: applications.filter(a => a.status === 'Offer').length,
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pipeline</h1>
          <p className="text-sm text-gray-500 mt-1">
            {stats.total} total · {stats.applied} applied · {stats.interviews} interviews · {stats.offers} offers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView('kanban')}
            className={cn('rounded px-3 py-1.5 text-sm', view === 'kanban' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-100')}
          >
            Kanban
          </button>
          <button
            onClick={() => setView('list')}
            className={cn('rounded px-3 py-1.5 text-sm', view === 'list' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-100')}
          >
            List
          </button>
          <Button size="sm" variant="outline" onClick={() => setShowScan(true)} className="gap-1.5">
            <Search className="h-4 w-4" /> Scan
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowEvaluate(true)} className="gap-1.5">
            <Sparkles className="h-4 w-4" /> Evaluate
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </div>

      <div className="mb-4">
        <Input
          placeholder="Search company or role..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      ) : view === 'kanban' ? (
        <div className="grid grid-cols-5 gap-4 overflow-x-auto">
          {KANBAN_COLUMNS.map(status => (
            <div key={status} className="min-w-[220px]">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">{status}</h3>
                <span className="text-xs text-gray-400">{byStatus(status).length}</span>
              </div>
              <div className="space-y-2">
                {byStatus(status).map(app => (
                  <ApplicationCard key={app.id} app={app} />
                ))}
                {byStatus(status).length === 0 && (
                  <p className="rounded-lg border border-dashed border-gray-200 p-4 text-center text-xs text-gray-400">
                    No {status.toLowerCase()} applications
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">All applications</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-gray-100">
              {filtered.length === 0 && (
                <p className="p-6 text-center text-sm text-gray-400">No applications yet</p>
              )}
              {filtered.map(app => (
                <div key={app.id} className="flex items-center gap-4 px-6 py-3 hover:bg-gray-50">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-gray-900 truncate">{app.company}</p>
                    <p className="text-xs text-gray-500 truncate">{app.role}</p>
                  </div>
                  <ScoreBadge score={app.score} />
                  <Badge variant="secondary" className={cn('text-xs', STATUS_COLORS[app.status])}>
                    {app.status}
                  </Badge>
                  <span className="text-xs text-gray-400 hidden md:block">{formatDate(app.date)}</span>
                  {app.url && (
                    <a href={app.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3.5 w-3.5 text-gray-400 hover:text-blue-500" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rejected / Discarded / SKIP section */}
      {view === 'list' && (
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-gray-500 uppercase tracking-wide">Closed</h2>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-gray-100">
                {['Rejected', 'Discarded', 'SKIP'].flatMap(s => filtered.filter(a => a.status === s)).length === 0 && (
                  <p className="p-6 text-center text-sm text-gray-400">None</p>
                )}
                {(['Rejected', 'Discarded', 'SKIP'] as ApplicationStatus[]).flatMap(s => filtered.filter(a => a.status === s)).map(app => (
                  <div key={app.id} className="flex items-center gap-4 px-6 py-3 opacity-60">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-gray-900 truncate">{app.company}</p>
                      <p className="text-xs text-gray-500 truncate">{app.role}</p>
                    </div>
                    <Badge variant="secondary" className={cn('text-xs', STATUS_COLORS[app.status])}>
                      {app.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {showAdd && <AddApplicationModal onClose={() => setShowAdd(false)} />}
      {showEvaluate && <EvaluateModal onClose={() => setShowEvaluate(false)} />}
      {showScan && <ScanPanel onClose={() => setShowScan(false)} />}
    </div>
  )
}
