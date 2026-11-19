import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import Layout from './components/Layout'
import { Loading } from './components/ui'
import Login from './pages/Login'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Measures = lazy(() => import('./pages/Measures'))
const MeasureDetail = lazy(() => import('./pages/MeasureDetail'))
const Approvals = lazy(() => import('./pages/Approvals'))
const FlagsPage = lazy(() => import('./pages/Flags'))
const Risks = lazy(() => import('./pages/Risks'))
const Recommendations = lazy(() => import('./pages/Recommendations'))
const CalendarPage = lazy(() => import('./pages/Calendar'))
const Reports = lazy(() => import('./pages/Reports'))
const Audit = lazy(() => import('./pages/Audit'))
const Passport = lazy(() => import('./pages/Passport'))
const Surveys = lazy(() => import('./pages/Surveys'))
const MyMeasures = lazy(() => import('./pages/MyMeasures'))
const AdminUsers = lazy(() => import('./pages/Admin').then(m => ({ default: m.AdminUsers })))
const AdminPeriods = lazy(() => import('./pages/Admin').then(m => ({ default: m.AdminPeriods })))
const AdminSystem = lazy(() => import('./pages/Admin').then(m => ({ default: m.AdminSystem })))
const Verify = lazy(() => import('./pages/Verify'))
const PublicPortal = lazy(() => import('./pages/PublicPortal'))

function Home() {
  const { profile } = useAuth()
  if (!profile) return <Navigate to="/public" replace />
  const to = profile.role === 'VYK' ? '/my' : profile.role === 'ADMIN' ? '/admin/users' : '/program/dashboard'
  return <Navigate to={to} replace />
}

function Guard() {
  const { profile, ready } = useAuth()
  if (!ready) return <div className="boot-loader" role="status">Завантаження АКП-Монітор…</div>
  if (!profile) return <Navigate to="/login" replace />
  return <Layout />
}

export default function App() {
  return <AuthProvider><BrowserRouter>
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/public" element={<PublicPortal />} />
        <Route path="/verify" element={<Verify />} />
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
      </Routes>
    </Suspense>
  </BrowserRouter></AuthProvider>
}
