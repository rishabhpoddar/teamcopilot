import { useEffect, useState } from 'react'
import { AxiosError } from 'axios'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { axiosInstance } from './utils'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Home from './pages/Home'
import WorkflowEditorPage from './pages/WorkflowEditorPage'
import SkillEditorPage from './pages/SkillEditorPage'
import WorkflowApprovalReviewPage from './pages/WorkflowApprovalReviewPage'
import SkillApprovalReviewPage from './pages/SkillApprovalReviewPage'
import RunDetailsPage from './pages/RunDetailsPage'
import ManualRunPage from './pages/ManualRunPage'
import OpencodeAuthSetup from './pages/OpencodeAuthSetup'
import './App.css'

type OpencodeAuthStatus = {
  has_credentials: boolean
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const auth = useAuth()
  if (auth.loading) return null
  if (!auth.user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function CredentialedRoute({ children }: { children: React.ReactNode }) {
  const auth = useAuth()
  const token = auth.loading ? null : auth.token
  const [loading, setLoading] = useState(true)
  const [hasCredentials, setHasCredentials] = useState(false)

  useEffect(() => {
    if (!token) {
      setLoading(false)
      setHasCredentials(false)
      return
    }

    setLoading(true)
    axiosInstance.get<OpencodeAuthStatus>('/api/opencode-auth/status', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((response) => {
        setHasCredentials(response.data.has_credentials)
      })
      .catch((_err: unknown) => {
        setHasCredentials(false)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [token])

  if (loading) return null
  if (!hasCredentials) return <Navigate to="/opencode-auth" replace />
  return <>{children}</>
}

function OpencodeSetupRoute() {
  const auth = useAuth()
  const token = auth.loading ? null : auth.token
  const [loading, setLoading] = useState(true)
  const [hasCredentials, setHasCredentials] = useState(false)

  useEffect(() => {
    if (!token) {
      setLoading(false)
      setHasCredentials(false)
      return
    }

    setLoading(true)
    axiosInstance.get<OpencodeAuthStatus>('/api/opencode-auth/status', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((response) => {
        setHasCredentials(response.data.has_credentials)
      })
      .catch((err: unknown) => {
        const errorMessage = err instanceof AxiosError ? err.response?.data?.message || err.response?.data || err.message : 'Failed to check opencode auth status'
        console.error(errorMessage)
        setHasCredentials(false)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [token])

  if (loading) return null
  if (hasCredentials) return <Navigate to="/" replace />
  return <OpencodeAuthSetup />
}

function GuestRoute({ children }: { children: React.ReactNode }) {
  const auth = useAuth()
  if (auth.loading) return null
  if (auth.user) return <Navigate to="/" replace />
  return <>{children}</>
}

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/opencode-auth" element={<ProtectedRoute><OpencodeSetupRoute /></ProtectedRoute>} />
        <Route path="/" element={<ProtectedRoute><CredentialedRoute><Home /></CredentialedRoute></ProtectedRoute>} />
        <Route path="/runs/:id" element={<ProtectedRoute><CredentialedRoute><RunDetailsPage /></CredentialedRoute></ProtectedRoute>} />
        <Route path="/workflows/:slug/manual-run" element={<ProtectedRoute><CredentialedRoute><ManualRunPage /></CredentialedRoute></ProtectedRoute>} />
        <Route path="/workflows/:slug" element={<ProtectedRoute><CredentialedRoute><WorkflowEditorPage /></CredentialedRoute></ProtectedRoute>} />
        <Route path="/skills/:slug" element={<ProtectedRoute><CredentialedRoute><SkillEditorPage /></CredentialedRoute></ProtectedRoute>} />
        <Route path="/workflows/:slug/approval-review" element={<ProtectedRoute><CredentialedRoute><WorkflowApprovalReviewPage /></CredentialedRoute></ProtectedRoute>} />
        <Route path="/skills/:slug/approval-review" element={<ProtectedRoute><CredentialedRoute><SkillApprovalReviewPage /></CredentialedRoute></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}

export default App
