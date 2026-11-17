import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import Layout from './components/Layout'
import { AdminPeriods, AdminSystem, AdminUsers } from './pages/Admin'
import Approvals from './pages/Approvals'
import Audit from './pages/Audit'
import CalendarPage from './pages/Calendar'
import Dashboard from './pages/Dashboard'
import FlagsPage from './pages/Flags'
import Login from './pages/Login'
import MeasureDetail from './pages/MeasureDetail'
import Measures from './pages/Measures'
import MyMeasures from './pages/MyMeasures'
import Passport from './pages/Passport'
import Recommendations from './pages/Recommendations'
import Reports from './pages/Reports'
import Risks from './pages/Risks'
import Surveys from './pages/Surveys'

function Home() {
  const { profile } = useAuth()
  if (!profile) return <Navigate to="/login" />
  const to = profile.role === 'VYK' ? '/my' : profile.role === 'ADMIN' ? '/admin/users' : '/program/dashboard'
  return <Navigate to={to} replace />
}

function Guard() {
  const { profile, ready } = useAuth()
  if (!ready) return <div className="card muted" style={{ margin: '2rem' }}>Завантаження…</div>
  if (!profile) return <Navigate to="/login" replace />
  return <Layout />
}

export default function App() {
  return <AuthProvider><BrowserRouter><Routes>
    <Route path="/login" element={<Login />} />
    <Route element={<Guard />}>
      <Route path="/" element={<Home />} />
      <Route path="/surveys" element={<Surveys />} />
      <Route path="/my" element={<MyMeasures />} />
      <Route path="/my/calendar" element={<CalendarPage />} />
      <Route path="/program" element={<Navigate to="/program/dashboard" replace />} />
      <Route path="/program/dashboard" element={<Dashboard />} />
      <Route path="/program/measures" element={<Measures />} />
      <Route path="/program/measures/:code" element={<MeasureDetail />} />
      <Route path="/program/approvals" element={<Approvals />} />
      <Route path="/program/flags" element={<FlagsPage />} />
      <Route path="/program/risks" element={<Risks />} />
      <Route path="/program/recommendations" element={<Recommendations />} />
      <Route path="/program/calendar" element={<CalendarPage />} />
      <Route path="/program/reports" element={<Reports />} />
      <Route path="/program/audit" element={<Audit />} />
      <Route path="/program/passport" element={<Passport />} />
      <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
      <Route path="/admin/users" element={<AdminUsers />} />
      <Route path="/admin/periods" element={<AdminPeriods />} />
      <Route path="/admin/system" element={<AdminSystem />} />
      <Route path="*" element={<Home />} />
    </Route>
  </Routes></BrowserRouter></AuthProvider>
}
