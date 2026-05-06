import { useState, useEffect } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import * as Tabs from '@radix-ui/react-tabs'
import { useProfile, useUpsertProfile } from '@/hooks/useProfile.ts'
import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Label } from '@/components/ui/label.tsx'
import { Textarea } from '@/components/ui/textarea.tsx'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.tsx'
import { cn } from '@/lib/utils.ts'
import type { Profile } from '@/types/database.ts'

function TagInput({ label, values, onChange, placeholder }: {
  label: string
  values: string[]
  onChange: (v: string[]) => void
  placeholder?: string
}) {
  const [input, setInput] = useState('')
  const add = () => {
    const v = input.trim()
    if (v && !values.includes(v)) onChange([...values, v])
    setInput('')
  }
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder={placeholder}
        />
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-1">
        {values.map(v => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
            {v}
            <button type="button" onClick={() => onChange(values.filter(x => x !== v))}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}

export function ProfilePage() {
  const { data: profile, isLoading } = useProfile()
  const upsert = useUpsertProfile()
  const [saved, setSaved] = useState(false)

  const [form, setForm] = useState<Partial<Profile>>({
    full_name: '', email: '', phone: '', location: '',
    linkedin: '', portfolio_url: '', github: '',
    headline: '', exit_story: '',
    target_roles: [], superpowers: [],
    comp_target: '', comp_minimum: '', comp_currency: 'USD',
    remote_preference: '', visa_status: '',
    cv_markdown: '',
  })

  useEffect(() => {
    if (profile) setForm(profile)
  }, [profile])

  const set = (key: keyof Profile, value: unknown) => setForm(f => ({ ...f, [key]: value }))

  const handleSave = async () => {
    await upsert.mutateAsync(form)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (isLoading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
    </div>
  )

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
          <p className="text-sm text-gray-500 mt-1">Your candidate identity and targeting configuration</p>
        </div>
        <Button onClick={handleSave} disabled={upsert.isPending} className="gap-1.5">
          {upsert.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {saved ? '✓ Saved' : 'Save changes'}
        </Button>
      </div>

      <Tabs.Root defaultValue="identity" className="space-y-4">
        <Tabs.List className="flex gap-1 rounded-lg bg-gray-100 p-1 w-fit">
          {['identity', 'targeting', 'compensation', 'cv'].map(tab => (
            <Tabs.Trigger
              key={tab}
              value={tab}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors capitalize',
                'data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-sm',
                'data-[state=inactive]:text-gray-500 data-[state=inactive]:hover:text-gray-700'
              )}
            >
              {tab === 'cv' ? 'CV' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* Identity Tab */}
        <Tabs.Content value="identity">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Personal information</CardTitle>
              <CardDescription>Used in CV generation and outreach messages</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Full name</Label>
                <Input value={form.full_name ?? ''} onChange={e => set('full_name', e.target.value)} placeholder="Jane Smith" />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" value={form.email ?? ''} onChange={e => set('email', e.target.value)} placeholder="jane@example.com" />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={form.phone ?? ''} onChange={e => set('phone', e.target.value)} placeholder="+1-555-0123" />
              </div>
              <div className="space-y-1.5">
                <Label>Location</Label>
                <Input value={form.location ?? ''} onChange={e => set('location', e.target.value)} placeholder="San Francisco, CA" />
              </div>
              <div className="space-y-1.5">
                <Label>LinkedIn URL</Label>
                <Input value={form.linkedin ?? ''} onChange={e => set('linkedin', e.target.value)} placeholder="linkedin.com/in/janesmith" />
              </div>
              <div className="space-y-1.5">
                <Label>Portfolio URL</Label>
                <Input value={form.portfolio_url ?? ''} onChange={e => set('portfolio_url', e.target.value)} placeholder="https://janesmith.dev" />
              </div>
              <div className="space-y-1.5">
                <Label>GitHub</Label>
                <Input value={form.github ?? ''} onChange={e => set('github', e.target.value)} placeholder="github.com/janesmith" />
              </div>
              <div className="space-y-1.5">
                <Label>Visa status</Label>
                <Input value={form.visa_status ?? ''} onChange={e => set('visa_status', e.target.value)} placeholder="No sponsorship needed" />
              </div>
            </CardContent>
          </Card>
        </Tabs.Content>

        {/* Targeting Tab */}
        <Tabs.Content value="targeting" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Role targeting</CardTitle>
              <CardDescription>Shapes how offers are evaluated and scored</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <TagInput
                label="Target roles (North Star)"
                values={form.target_roles ?? []}
                onChange={v => set('target_roles', v)}
                placeholder="Senior AI Engineer"
              />
              <TagInput
                label="Your superpowers (top 3–5)"
                values={form.superpowers ?? []}
                onChange={v => set('superpowers', v)}
                placeholder="End-to-end ML pipelines"
              />
              <div className="space-y-1.5">
                <Label>Professional headline</Label>
                <Input value={form.headline ?? ''} onChange={e => set('headline', e.target.value)} placeholder="ML Engineer turned AI product builder" />
              </div>
              <div className="space-y-1.5">
                <Label>Remote preference</Label>
                <Input value={form.remote_preference ?? ''} onChange={e => set('remote_preference', e.target.value)} placeholder="Remote preferred, 1 week/month on-site possible" />
              </div>
              <div className="space-y-1.5">
                <Label>Exit story / what makes you unique</Label>
                <Textarea
                  rows={3}
                  value={form.exit_story ?? ''}
                  onChange={e => set('exit_story', e.target.value)}
                  placeholder="Built and sold my SaaS after 5 years. Now focused on applied AI at scale."
                />
              </div>
            </CardContent>
          </Card>
        </Tabs.Content>

        {/* Compensation Tab */}
        <Tabs.Content value="compensation">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Compensation targets</CardTitle>
              <CardDescription>Used for scoring Block D (comp research) in evaluations</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Target range</Label>
                <Input value={form.comp_target ?? ''} onChange={e => set('comp_target', e.target.value)} placeholder="$150K–200K" />
              </div>
              <div className="space-y-1.5">
                <Label>Walk-away minimum</Label>
                <Input value={form.comp_minimum ?? ''} onChange={e => set('comp_minimum', e.target.value)} placeholder="$120K" />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Input value={form.comp_currency ?? 'USD'} onChange={e => set('comp_currency', e.target.value)} placeholder="USD" />
              </div>
            </CardContent>
          </Card>
        </Tabs.Content>

        {/* CV Tab */}
        <Tabs.Content value="cv">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">CV (Markdown)</CardTitle>
              <CardDescription>
                Your canonical CV in Markdown format. This is the source of truth for all evaluations and PDF generation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                rows={24}
                value={form.cv_markdown ?? ''}
                onChange={e => set('cv_markdown', e.target.value)}
                className="font-mono text-xs"
                placeholder={`# Jane Smith\n\n## Summary\n...\n\n## Experience\n\n### Company — Role (2022–2025)\n- Achievement with metric\n\n## Skills\n...`}
              />
              <p className="mt-2 text-xs text-gray-400">
                Use standard Markdown: headings, bullet points, bold text. This is read directly by the AI during evaluations.
              </p>
            </CardContent>
          </Card>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}
