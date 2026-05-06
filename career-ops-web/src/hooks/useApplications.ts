import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase.ts'
import { useAuth } from '@/contexts/AuthContext.tsx'
import type { Application, ApplicationStatus } from '@/types/database.ts'

export function useApplications() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['applications', user?.id],
    queryFn: async () => {
      if (!user) return []
      const { data, error } = await supabase
        .from('applications')
        .select('*')
        .eq('user_id', user.id)
        .order('seq_num', { ascending: false })
      if (error) throw error
      return (data ?? []) as Application[]
    },
    enabled: !!user,
  })
}

export function useApplication(id: string) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['application', id],
    queryFn: async () => {
      if (!user) return null
      const { data, error } = await supabase
        .from('applications')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .single()
      if (error) throw error
      return data as Application
    },
    enabled: !!user && !!id,
  })
}

export function useCreateApplication() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (values: Omit<Application, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
      if (!user) throw new Error('Not authenticated')
      const { data, error } = await supabase
        .from('applications')
        .insert({ ...values, user_id: user.id })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications', user?.id] })
    },
  })
}

export function useUpdateApplicationStatus() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: ApplicationStatus; notes?: string }) => {
      if (!user) throw new Error('Not authenticated')
      const { data, error } = await supabase
        .from('applications')
        .update({ status, notes })
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['applications', user?.id] })
      queryClient.invalidateQueries({ queryKey: ['application', variables.id] })
    },
  })
}

export function useDeleteApplication() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      if (!user) throw new Error('Not authenticated')
      const { error } = await supabase
        .from('applications')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications', user?.id] })
    },
  })
}
