import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext.tsx'

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

async function invokeFunction(name: string, body: Record<string, unknown>, token: string) {
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? `Function ${name} failed`)
  return data
}

export function useEvaluate() {
  const { session, user } = useAuth()
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ url, jd_text }: { url?: string; jd_text?: string }) => {
      if (!session || !user) throw new Error('Not authenticated')
      return invokeFunction('evaluate', { url, jd_text, user_id: user.id }, session.access_token)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['applications'] })
    },
  })
}

export function useScan() {
  const { session, user } = useAuth()
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      if (!session || !user) throw new Error('Not authenticated')
      return invokeFunction('scan', { user_id: user.id }, session.access_token)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['applications'] })
    },
  })
}

export function useGeneratePdf() {
  const { session, user } = useAuth()
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (applicationId: string) => {
      if (!session || !user) throw new Error('Not authenticated')
      return invokeFunction('generate-pdf', { application_id: applicationId, user_id: user.id }, session.access_token)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['applications'] })
    },
  })
}
