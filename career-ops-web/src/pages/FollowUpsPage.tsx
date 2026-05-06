import { useState } from 'react'
import { Plus, Loader2, Clock, AlertCircle, CheckCircle2, MinusCircle } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase.ts'
import { useAuth } from '@/contexts/AuthContext.tsx'
import { useApplications } from '@/hooks/useApplications.ts'
import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Label } from '@/components/ui/label.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import type { FollowUp, Application } from '@/types/database.ts'
import { formatDate, cn } from '@/lib/utils.ts'

function daysSince(dateStr: string) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function getUrgency(app: Application): { label: string; color: string; icon: typeof Clock } {
  const days = daysSince(app.date)
  if (app.status === 'Responded' || app.status === 'Interview') {
    return { label: 'URGENT', color: 'text-red-600 bg-red-50', icon: AlertCircle }
  }
  if (app.status === 'Applied' && days >= 7) {
    return { label: 'OVERDUE', color: 'text-orange-600 bg-orange-50', icon: AlertCircle }
  }
  if (app.status === 'Applied' && days >= 4) {
    return { label: 'DUE SOON', color: 'text-yellow-600 bg-yellow-50', icon: Clock }
  }
  if (app.status === 'Applied') {
    return { label: 'WAITING', color: 'text-gray-500 bg-gray-50', icon: Clock }
  }
  return { label: 'COLD', color: 'text-gray-400 bg-gray-50', icon: MinusCircle }
}

function useFollowUps() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['follow_ups', user?.id],
    queryFn: async () => {
      if (!user) return []
      const { data, error } = await supabase
        .from('follow_ups')
        .select('*')
        .eq('user_id', user.id)
        .order('date', { ascending: false })
      if (error) throw error
      return (data ?? []) as FollowUp[]
    },
    enabled: !!user,
  })
}

function useCreateFollowUp() {
  const { user } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (values: Omit<FollowUp, 'id' | 'user_id' | 'created_at'>) => {
      if (!user) throw new Error('Not authenticated')
      const { data, error } = await supabase
        .from('follow_ups')
        .insert({ ...values, user_id: user.id })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['follow_ups', user?.id] }),
  })
}

function AddFollowUpModal({ applications, onClose }: { applications: Application[]; onClose: () => void }) {
  const create = useCreateFollowUp()
  const [form, setForm] = useState({
    application_id: '',
    channel: 'Email' as FollowUp['channel'],
    contact: '',
    notes: '',
    date: new Date().toISOString().split('T')[0],
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await create.mutateAsync(form)
    onClose()
  }

  const activeApps = applications.filter(a =>
    ['Applied', 'Responded', 'Interview'].includes(a.status)
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">Log Follow-up</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label>Application *</Label>
            <select
              required
              value={form.application_id}
              onChange={e => setForm(f => ({ ...f, application_id: e.target.value }))}
              className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
            >
              <option value="">Select application...</option>
              {activeApps.map(a => (
                <option key={a.id} value={a.id}>{a.company} — {a.role}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Channel *</Label>
            <select
              value={form.channel}
              onChange={e => setForm(f => ({ ...f, channel: e.target.value as FollowUp['channel'] }))}
              className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
            >
              <option value="Email">Email</option>
              <option value="LinkedIn">LinkedIn</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label>Contact (name or email)</Label>
            <Input value={form.contact} onChange={e => setForm(f => ({ ...f, contact: e.target.value }))} placeholder="hiring@company.com" />
          </div>
          <div className="space-y-1">
            <Label>Date</Label>
            <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Referenced project X, asked about timeline..." />
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="flex-1" disabled={create.isPending}>
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Log follow-up
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function FollowUpsPage() {
  const { data: applications = [], isLoading: loadingApps } = useApplications()
  const { data: followUps = [], isLoading: loadingFU } = useFollowUps()
  const [showAdd, setShowAdd] = useState(false)

  const isLoading = loadingApps || loadingFU

  const activeApplications = applications.filter(a =>
    ['Applied', 'Responded', 'Interview'].includes(a.status)
  )

  const followUpCountByApp = followUps.reduce<Record<string, number>>((acc, fu) => {
    acc[fu.application_id] = (acc[fu.application_id] ?? 0) + 1
    return acc
  }, {})

  const actionable = activeApplications
    .map(app => ({
      app,
      urgency: getUrgency(app),
      followUpCount: followUpCountByApp[app.id] ?? 0,
      daysSince: daysSince(app.date),
    }))
    .sort((a, b) => {
      const order = { 'URGENT': 0, 'OVERDUE': 1, 'DUE SOON': 2, 'WAITING': 3, 'COLD': 4 }
      return (order[a.urgency.label as keyof typeof order] ?? 5) - (order[b.urgency.label as keyof typeof order] ?? 5)
    })

  const stats = {
    urgent: actionable.filter(a => a.urgency.label === 'URGENT').length,
    overdue: actionable.filter(a => a.urgency.label === 'OVERDUE').length,
    dueSoon: actionable.filter(a => a.urgency.label === 'DUE SOON').length,
    total: actionable.length,
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Follow-ups</h1>
          <p className="text-sm text-gray-500 mt-1">Cadence tracker for active applications</p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Log follow-up
        </Button>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Active applications', value: stats.total, color: 'text-gray-900' },
          { label: 'Urgent (respond today)', value: stats.urgent, color: 'text-red-600' },
          { label: 'Overdue', value: stats.overdue, color: 'text-orange-600' },
          { label: 'Due soon', value: stats.dueSoon, color: 'text-yellow-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg border border-gray-200 bg-white p-4">
            <p className={cn('text-2xl font-bold', color)}>{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Cadence dashboard */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Active Pipeline Cadence</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {actionable.length === 0 ? (
                <p className="p-6 text-center text-sm text-gray-400">
                  No active applications. Apply to some roles first.
                </p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {actionable.map(({ app, urgency, followUpCount, daysSince: days }) => {
                    const UrgencyIcon = urgency.icon
                    return (
                      <div key={app.id} className="flex items-center gap-4 px-6 py-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm text-gray-900 truncate">{app.company}</p>
                            <Badge variant="secondary" className={cn('text-xs shrink-0', urgency.color)}>
                              <UrgencyIcon className="h-3 w-3 mr-1" />
                              {urgency.label}
                            </Badge>
                          </div>
                          <p className="text-xs text-gray-500 truncate">{app.role}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs text-gray-500">{days}d since application</p>
                          <p className="text-xs text-gray-400">{followUpCount} follow-up{followUpCount !== 1 ? 's' : ''} sent</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Follow-up history */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Follow-up History</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {followUps.length === 0 ? (
                <p className="p-6 text-center text-sm text-gray-400">
                  No follow-ups logged yet.
                </p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {followUps.map(fu => {
                    const app = applications.find(a => a.id === fu.application_id)
                    return (
                      <div key={fu.id} className="flex items-start gap-4 px-6 py-3">
                        <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">
                            {app ? `${app.company} — ${app.role}` : 'Unknown application'}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-gray-400">{formatDate(fu.date)}</span>
                            <span className="text-xs rounded-full bg-gray-100 text-gray-600 px-2 py-0.5">{fu.channel}</span>
                            {fu.contact && <span className="text-xs text-gray-400">→ {fu.contact}</span>}
                          </div>
                          {fu.notes && <p className="text-xs text-gray-500 mt-0.5">{fu.notes}</p>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {showAdd && <AddFollowUpModal applications={applications} onClose={() => setShowAdd(false)} />}
    </div>
  )
}
