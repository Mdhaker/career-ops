import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/contexts/AuthContext.tsx'
import { AppLayout } from '@/components/layout/AppLayout.tsx'
import { AuthPage } from '@/pages/AuthPage.tsx'
import { PipelinePage } from '@/pages/PipelinePage.tsx'
import { PortalsPage } from '@/pages/PortalsPage.tsx'
import { ProfilePage } from '@/pages/ProfilePage.tsx'
import { ReportsPage } from '@/pages/ReportsPage.tsx'
import { FollowUpsPage } from '@/pages/FollowUpsPage.tsx'
import { Loader2 } from 'lucide-react'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    )
  }
  if (!session) return <Navigate to="/auth" replace />
  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/pipeline" replace />} />
        <Route path="pipeline" element={<PipelinePage />} />
        <Route path="portals" element={<PortalsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="followups" element={<FollowUpsPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
