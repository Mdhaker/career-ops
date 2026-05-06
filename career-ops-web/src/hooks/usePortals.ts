import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase.ts'
import { useAuth } from '@/contexts/AuthContext.tsx'
import type { TrackedCompany, SearchQuery, TitleFilter } from '@/types/database.ts'

export function useTrackedCompanies() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['tracked_companies', user?.id],
    queryFn: async () => {
      if (!user) return []
      const { data, error } = await supabase
        .from('tracked_companies')
        .select('*')
        .eq('user_id', user.id)
        .order('name')
      if (error) throw error
      return (data ?? []) as TrackedCompany[]
    },
    enabled: !!user,
  })
}

export function useUpsertCompany() {
  const { user } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (values: Partial<TrackedCompany> & { name: string; careers_url: string }) => {
      if (!user) throw new Error('Not authenticated')
      const payload = { ...values, user_id: user.id }
      const { data, error } = values.id
        ? await supabase.from('tracked_companies').update(payload).eq('id', values.id).select().single()
        : await supabase.from('tracked_companies').insert(payload).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tracked_companies', user?.id] }),
  })
}

export function useDeleteCompany() {
  const { user } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      if (!user) throw new Error('Not authenticated')
      const { error } = await supabase.from('tracked_companies').delete().eq('id', id).eq('user_id', user.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tracked_companies', user?.id] }),
  })
}

export function useSearchQueries() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['search_queries', user?.id],
    queryFn: async () => {
      if (!user) return []
      const { data, error } = await supabase
        .from('search_queries')
        .select('*')
        .eq('user_id', user.id)
        .order('name')
      if (error) throw error
      return (data ?? []) as SearchQuery[]
    },
    enabled: !!user,
  })
}

export function useUpsertSearchQuery() {
  const { user } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (values: Partial<SearchQuery> & { name: string; query: string }) => {
      if (!user) throw new Error('Not authenticated')
      const payload = { ...values, user_id: user.id }
      const { data, error } = values.id
        ? await supabase.from('search_queries').update(payload).eq('id', values.id).select().single()
        : await supabase.from('search_queries').insert(payload).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['search_queries', user?.id] }),
  })
}

export function useDeleteSearchQuery() {
  const { user } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      if (!user) throw new Error('Not authenticated')
      const { error } = await supabase.from('search_queries').delete().eq('id', id).eq('user_id', user.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['search_queries', user?.id] }),
  })
}

export function useTitleFilter() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['title_filter', user?.id],
    queryFn: async () => {
      if (!user) return null
      const { data, error } = await supabase
        .from('title_filters')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle()
      if (error) throw error
      return data as TitleFilter | null
    },
    enabled: !!user,
  })
}

export function useUpsertTitleFilter() {
  const { user } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (values: Partial<TitleFilter>) => {
      if (!user) throw new Error('Not authenticated')
      const { data, error } = await supabase
        .from('title_filters')
        .upsert({ ...values, user_id: user.id }, { onConflict: 'user_id' })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['title_filter', user?.id] }),
  })
}
