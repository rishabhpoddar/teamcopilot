import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Home from './pages/Home'
import WorkflowEditorPage from './pages/WorkflowEditorPage'
import SkillEditorPage from './pages/SkillEditorPage'
import WorkflowApprovalReviewPage from './pages/WorkflowApprovalReviewPage'
import SkillApprovalReviewPage from './pages/SkillApprovalReviewPage'
import RunDetailsPage from './pages/RunDetailsPage'
import ManualRunPage from './pages/ManualRunPage'
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
        <Route path="/skills/:slug/approval-review" element={<ProtectedRoute><SkillApprovalReviewPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}

export default App
