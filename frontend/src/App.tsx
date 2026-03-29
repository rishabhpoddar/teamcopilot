import { useEffect, useState } from 'react'
import { AxiosError } from 'axios'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { axiosInstance } from './utils'
import Login from './pages/Login'
import Home from './pages/Home'
import WorkflowEditorPage from './pages/WorkflowEditorPage'
import SkillEditorPage from './pages/SkillEditorPage'
import WorkflowApprovalReviewPage from './pages/WorkflowApprovalReviewPage'
import SkillApprovalReviewPage from './pages/SkillApprovalReviewPage'
import RunDetailsPage from './pages/RunDetailsPage'
import ManualRunPage from './pages/ManualRunPage'
import OpencodeAuthSetup from './pages/OpencodeAuthSetup'
import OpencodeAuthComplete from './pages/OpencodeAuthComplete'
import './App.css'

type OpencodeAuthStatus = {
  has_credentials: boolean
}

function useOpencodeCredentialStatus(token: string | null) {
  const [resolvedToken, setResolvedToken] = useState<string | null>(null)
  const [hasCredentials, setHasCredentials] = useState(false)

  useEffect(() => {
    if (!token) {
      return
    }

    axiosInstance.get<OpencodeAuthStatus>('/api/opencode-auth/status', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((response) => {
        setHasCredentials(response.data.has_credentials)
        setResolvedToken(token)
      })
      .catch((err: unknown) => {
        const errorMessage = err instanceof AxiosError ? err.response?.data?.message || err.response?.data || err.message : 'Failed to check opencode auth status'
        console.error(errorMessage)
        setHasCredentials(false)
        setResolvedToken(token)
      })
  }, [token])

  if (!token) {
    return { loading: false, hasCredentials: false }
  }

  return {
    loading: resolvedToken !== token,
    hasCredentials
  }
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
  const { loading, hasCredentials } = useOpencodeCredentialStatus(token)

  if (loading) return null
  if (!hasCredentials) return <Navigate to="/opencode-auth" replace />
  return <>{children}</>
}

function OpencodeSetupRoute() {
  const auth = useAuth()
  const token = auth.loading ? null : auth.token
  const { loading } = useOpencodeCredentialStatus(token)

  if (loading) return null
  return <OpencodeAuthSetup />
}

function OpencodeSetupCompleteRoute() {
  const auth = useAuth()
  const token = auth.loading ? null : auth.token
  const { loading, hasCredentials } = useOpencodeCredentialStatus(token)

  if (loading) return null
  if (!hasCredentials) return <Navigate to="/opencode-auth" replace />
  return <OpencodeAuthComplete />
}

function GuestRoute({ children }: { children: React.ReactNode }) {
  const auth = useAuth()
  if (auth.loading) return null
  if (auth.user) return <Navigate to="/" replace />
  return <>{children}</>
}

function AppShell() {
  const auth = useAuth()
  const [workspaceDir, setWorkspaceDir] = useState<string | null>(null)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)

  useEffect(() => {
    axiosInstance.get<{ workspace_dir: string }>('/api/workspace')
      .then((response) => {
        setWorkspaceDir(response.data.workspace_dir)
        setWorkspaceError(null)
      })
      .catch((err: unknown) => {
        const errorMessage = err instanceof AxiosError ? err.response?.data?.message || err.response?.data || err.message : 'Failed to load workspace path'
        setWorkspaceError(errorMessage)
      })
  }, [])

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-top">
            <div className="app-brand-block">
                <div className="app-brand">
                  <img src="/logo.svg" alt="TeamCopilot logo" className="app-brand-logo" />
                  <div className="app-brand-copy">
                    <div className="app-brand-text">TeamCopilot</div>
                    <div className="app-version">v{__APP_VERSION__}</div>
                  </div>
                </div>
                <div className="app-workspace">
              <span className="app-workspace-label">Workspace</span>
              <span className="app-workspace-value">
                {workspaceError ?? workspaceDir ?? 'Loading...'}
              </span>
            </div>
          </div>
          <div className="app-header-meta">
            {!auth.loading && auth.user && (
              <div className="app-user">
                <span className="app-user-name">{auth.user.name}</span>
                <span className="app-user-email">{auth.user.email}</span>
              </div>
            )}
            {!auth.loading && auth.user && (
              <button className="app-signout" onClick={auth.logout}>Sign Out</button>
            )}
          </div>
        </div>
      </header>
      <Routes>
        <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
        <Route path="/opencode-auth" element={<ProtectedRoute><OpencodeSetupRoute /></ProtectedRoute>} />
        <Route path="/opencode-auth/complete" element={<ProtectedRoute><OpencodeSetupCompleteRoute /></ProtectedRoute>} />
        <Route path="/" element={<ProtectedRoute><CredentialedRoute><Home /></CredentialedRoute></ProtectedRoute>} />
        <Route path="/runs/:id" element={<ProtectedRoute><CredentialedRoute><RunDetailsPage /></CredentialedRoute></ProtectedRoute>} />
        <Route path="/workflows/:slug/manual-run" element={<ProtectedRoute><CredentialedRoute><ManualRunPage /></CredentialedRoute></ProtectedRoute>} />
        <Route path="/workflows/:slug" element={<ProtectedRoute><CredentialedRoute><WorkflowEditorPage /></CredentialedRoute></ProtectedRoute>} />
        <Route path="/skills/:slug" element={<ProtectedRoute><CredentialedRoute><SkillEditorPage /></CredentialedRoute></ProtectedRoute>} />
        <Route path="/workflows/:slug/approval-review" element={<ProtectedRoute><CredentialedRoute><WorkflowApprovalReviewPage /></CredentialedRoute></ProtectedRoute>} />
        <Route path="/skills/:slug/approval-review" element={<ProtectedRoute><CredentialedRoute><SkillApprovalReviewPage /></CredentialedRoute></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  )
}

export default App
