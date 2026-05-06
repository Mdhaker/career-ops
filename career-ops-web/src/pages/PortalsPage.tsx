import { useState } from 'react'
import { Plus, Trash2, Loader2, Globe, Search, Filter } from 'lucide-react'
import * as Tabs from '@radix-ui/react-tabs'
import {
  useTrackedCompanies, useUpsertCompany, useDeleteCompany,
  useSearchQueries, useUpsertSearchQuery, useDeleteSearchQuery,
  useTitleFilter, useUpsertTitleFilter,
} from '@/hooks/usePortals.ts'
import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Label } from '@/components/ui/label.tsx'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.tsx'
import type { TrackedCompany, SearchQuery } from '@/types/database.ts'
import { cn } from '@/lib/utils.ts'

function CompanyForm({ company, onClose }: { company?: TrackedCompany; onClose: () => void }) {
  const upsert = useUpsertCompany()
  const [form, setForm] = useState({
    name: company?.name ?? '',
    careers_url: company?.careers_url ?? '',
    api_url: company?.api_url ?? '',
    notes: company?.notes ?? '',
    enabled: company?.enabled ?? true,
    scan_method: company?.scan_method ?? 'playwright',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await upsert.mutateAsync({
      ...(company ? { id: company.id } : {}),
      name: form.name,
      careers_url: form.careers_url,
      api_url: form.api_url || null,
      notes: form.notes || null,
      enabled: form.enabled,
      scan_method: form.scan_method as TrackedCompany['scan_method'],
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">{company ? 'Edit Company' : 'Add Company'}</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label>Company name *</Label>
            <Input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Anthropic" />
          </div>
          <div className="space-y-1">
            <Label>Careers URL *</Label>
            <Input required value={form.careers_url} onChange={e => setForm(f => ({ ...f, careers_url: e.target.value }))} placeholder="https://..." />
          </div>
          <div className="space-y-1">
            <Label>API URL (optional, for Greenhouse/Lever/Ashby)</Label>
            <Input value={form.api_url} onChange={e => setForm(f => ({ ...f, api_url: e.target.value }))} placeholder="https://boards-api.greenhouse.io/v1/boards/.../jobs" />
          </div>
          <div className="space-y-1">
            <Label>Scan method</Label>
            <select
              value={form.scan_method}
              onChange={e => setForm(f => ({ ...f, scan_method: e.target.value as TrackedCompany['scan_method'] }))}
              className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
            >
              <option value="playwright">Playwright (live page)</option>
              <option value="api">API (structured JSON)</option>
              <option value="websearch">WebSearch (broad)</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="enabled" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} className="h-4 w-4 rounded border-gray-300" />
            <Label htmlFor="enabled">Enabled</Label>
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="flex-1" disabled={upsert.isPending}>
              {upsert.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function QueryForm({ query, onClose }: { query?: SearchQuery; onClose: () => void }) {
  const upsert = useUpsertSearchQuery()
  const [form, setForm] = useState({ name: query?.name ?? '', query: query?.query ?? '', enabled: query?.enabled ?? true })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await upsert.mutateAsync({ ...(query ? { id: query.id } : {}), ...form })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">{query ? 'Edit Query' : 'Add Search Query'}</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label>Name *</Label>
            <Input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ashby — AI PM" />
          </div>
          <div className="space-y-1">
            <Label>Query *</Label>
            <textarea
              required
              rows={3}
              value={form.query}
              onChange={e => setForm(f => ({ ...f, query: e.target.value }))}
              placeholder='site:jobs.ashbyhq.com "AI Product Manager" remote'
              className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="qenabled" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} className="h-4 w-4 rounded border-gray-300" />
            <Label htmlFor="qenabled">Enabled</Label>
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="flex-1" disabled={upsert.isPending}>
              {upsert.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function TitleFilterPanel() {
  const { data: filter } = useTitleFilter()
  const upsert = useUpsertTitleFilter()
  const [positive, setPositive] = useState(filter?.positive?.join(', ') ?? '')
  const [negative, setNegative] = useState(filter?.negative?.join(', ') ?? '')
  const [boost, setBoost] = useState(filter?.seniority_boost?.join(', ') ?? '')
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    await upsert.mutateAsync({
      positive: positive.split(',').map(s => s.trim()).filter(Boolean),
      negative: negative.split(',').map(s => s.trim()).filter(Boolean),
      seniority_boost: boost.split(',').map(s => s.trim()).filter(Boolean),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Filter className="h-4 w-4" />Title Filters</CardTitle>
        <CardDescription>Comma-separated keywords. At least 1 positive must match; 0 negative must match.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Positive keywords (role must include one)</Label>
          <textarea
            rows={3}
            value={positive}
            onChange={e => setPositive(e.target.value)}
            placeholder="AI, ML, LLM, Agentic, GenAI, Solutions Architect"
            className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Negative keywords (role must exclude all)</Label>
          <textarea
            rows={2}
            value={negative}
            onChange={e => setNegative(e.target.value)}
            placeholder="Junior, Intern, PHP, Java, iOS, Android"
            className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Seniority boost keywords (not required, boost priority)</Label>
          <Input
            value={boost}
            onChange={e => setBoost(e.target.value)}
            placeholder="Senior, Staff, Principal, Lead, Head, Director"
          />
        </div>
        <Button onClick={handleSave} disabled={upsert.isPending} className="gap-1.5">
          {upsert.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {saved ? '✓ Saved' : 'Save filters'}
        </Button>
      </CardContent>
    </Card>
  )
}

export function PortalsPage() {
  const { data: companies = [], isLoading: loadingCompanies } = useTrackedCompanies()
  const { data: queries = [], isLoading: loadingQueries } = useSearchQueries()
  const deleteCompany = useDeleteCompany()
  const deleteQuery = useDeleteSearchQuery()
  const [companyModal, setCompanyModal] = useState<{ open: boolean; company?: TrackedCompany }>({ open: false })
  const [queryModal, setQueryModal] = useState<{ open: boolean; query?: SearchQuery }>({ open: false })

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Portals</h1>
        <p className="text-sm text-gray-500 mt-1">Configure companies to track and search queries for scanning</p>
      </div>

      <Tabs.Root defaultValue="companies" className="space-y-4">
        <Tabs.List className="flex gap-1 rounded-lg bg-gray-100 p-1 w-fit">
          {[
            { value: 'companies', label: 'Tracked Companies', icon: Globe },
            { value: 'queries', label: 'Search Queries', icon: Search },
            { value: 'filters', label: 'Title Filters', icon: Filter },
          ].map(({ value, label, icon: Icon }) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                'data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-sm',
                'data-[state=inactive]:text-gray-500 data-[state=inactive]:hover:text-gray-700'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="companies">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-gray-500">{companies.length} companies tracked</p>
            <Button size="sm" onClick={() => setCompanyModal({ open: true })} className="gap-1.5">
              <Plus className="h-4 w-4" /> Add company
            </Button>
          </div>
          {loadingCompanies ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {companies.map(c => (
                <Card key={c.id} className={cn(!c.enabled && 'opacity-50')}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm text-gray-900 truncate">{c.name}</p>
                        <a href={c.careers_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline truncate block">
                          {c.careers_url}
                        </a>
                        <p className="text-xs text-gray-400 mt-1">{c.scan_method}</p>
                        {c.notes && <p className="text-xs text-gray-400 truncate mt-0.5">{c.notes}</p>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => setCompanyModal({ open: true, company: c })}
                          className="text-xs text-gray-400 hover:text-blue-500 px-1"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteCompany.mutate(c.id)}
                          className="text-gray-300 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-2">
                      <span className={cn('text-xs rounded-full px-2 py-0.5', c.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                        {c.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {companies.length === 0 && (
                <p className="col-span-3 py-12 text-center text-sm text-gray-400">
                  No companies yet. Add your first company to track.
                </p>
              )}
            </div>
          )}
        </Tabs.Content>

        <Tabs.Content value="queries">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-gray-500">{queries.filter(q => q.enabled).length} of {queries.length} queries enabled</p>
            <Button size="sm" onClick={() => setQueryModal({ open: true })} className="gap-1.5">
              <Plus className="h-4 w-4" /> Add query
            </Button>
          </div>
          {loadingQueries ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
          ) : (
            <div className="space-y-2">
              {queries.map(q => (
                <div key={q.id} className={cn('flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3', !q.enabled && 'opacity-50')}>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-gray-900">{q.name}</p>
                    <code className="text-xs text-gray-500 break-all">{q.query}</code>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cn('text-xs rounded-full px-2 py-0.5', q.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                      {q.enabled ? 'On' : 'Off'}
                    </span>
                    <button onClick={() => setQueryModal({ open: true, query: q })} className="text-xs text-gray-400 hover:text-blue-500">Edit</button>
                    <button onClick={() => deleteQuery.mutate(q.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {queries.length === 0 && (
                <p className="py-12 text-center text-sm text-gray-400">No search queries yet.</p>
              )}
            </div>
          )}
        </Tabs.Content>

        <Tabs.Content value="filters">
          <TitleFilterPanel />
        </Tabs.Content>
      </Tabs.Root>

      {companyModal.open && (
        <CompanyForm company={companyModal.company} onClose={() => setCompanyModal({ open: false })} />
      )}
      {queryModal.open && (
        <QueryForm query={queryModal.query} onClose={() => setQueryModal({ open: false })} />
      )}
    </div>
  )
}
