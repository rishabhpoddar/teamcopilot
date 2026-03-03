import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth.tsx'
import Login from './pages/Login.tsx'
import ResetPassword from './pages/ResetPassword.tsx'
import Home from './pages/Home.tsx'
import WorkflowEditorPage from './pages/WorkflowEditorPage.tsx'
import SkillEditorPage from './pages/SkillEditorPage.tsx'
import WorkflowApprovalReviewPage from './pages/WorkflowApprovalReviewPage.tsx'
import RunDetailsPage from './pages/RunDetailsPage.tsx'
import ManualRunPage from './pages/ManualRunPage.tsx'
import './App.css'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const auth = useAuth()
  if (auth.loading) return null
  if (!auth.user) return <Navigate to="/login" replace />
  return <>{children}</>
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
        <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
        <Route path="/runs/:id" element={<ProtectedRoute><RunDetailsPage /></ProtectedRoute>} />
        <Route path="/workflows/:slug/manual-run" element={<ProtectedRoute><ManualRunPage /></ProtectedRoute>} />
        <Route path="/workflows/:slug" element={<ProtectedRoute><WorkflowEditorPage /></ProtectedRoute>} />
        <Route path="/skills/:slug" element={<ProtectedRoute><SkillEditorPage /></ProtectedRoute>} />
        <Route path="/workflows/:slug/approval-review" element={<ProtectedRoute><WorkflowApprovalReviewPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}

export default App
