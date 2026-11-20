import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth, type Role } from './auth'
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
const AdminKeys = lazy(() => import('./pages/Admin').then(m => ({ default: m.AdminKeys })))
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

function RoleRoute({
  allowed,
  children,
  redirectTo,
}: {
  allowed: Role[]
  children: React.ReactElement
  redirectTo?: string
}) {
  const { profile } = useAuth()
  if (!profile) return <Navigate to="/login" replace />
  if (!allowed.includes(profile.role)) {
    if (redirectTo) {
      return <Navigate to={redirectTo} replace />
    }
    const fallback = profile.role === 'VYK'
      ? '/my'
      : profile.role === 'ADMIN'
      ? '/admin/users'
      : '/program/dashboard'
    return <Navigate to={fallback} replace />
  }
  return children
}

function Guard() {
  const { profile, ready } = useAuth()
  if (!ready) return <div className="boot-loader" role="status">Завантаження АКП-Монітор…</div>
  if (!profile) return <Navigate to="/login" replace />
  return <Layout />
}

export default function App() {
  const PROGRAM_VIEWERS: Role[] = ['KOORD', 'ADMIN', 'KER', 'AUDIT']

  return <AuthProvider><BrowserRouter>
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/public" element={<PublicPortal />} />
        <Route path="/verify" element={<Verify />} />
        <Route element={<Guard />}>
          <Route path="/surveys" element={
            <RoleRoute allowed={['KOORD', 'ADMIN', 'AUDIT']}><Surveys /></RoleRoute>
          } />
          <Route path="/my" element={
            <RoleRoute allowed={['VYK']} redirectTo="/program/dashboard"><MyMeasures /></RoleRoute>
          } />
          <Route path="/my/calendar" element={
            <RoleRoute allowed={['VYK']} redirectTo="/program/dashboard"><CalendarPage /></RoleRoute>
          } />
          <Route path="/program" element={<Navigate to="/program/dashboard" replace />} />
          <Route path="/program/dashboard" element={
            <RoleRoute allowed={PROGRAM_VIEWERS} redirectTo="/my"><Dashboard /></RoleRoute>
          } />
          <Route path="/program/measures" element={
            <RoleRoute allowed={PROGRAM_VIEWERS} redirectTo="/my"><Measures /></RoleRoute>
          } />
          <Route path="/program/measures/:code" element={<MeasureDetail />} />
          <Route path="/program/approvals" element={
            <RoleRoute allowed={['KOORD', 'ADMIN']}><Approvals /></RoleRoute>
          } />
          <Route path="/program/flags" element={
            <RoleRoute allowed={PROGRAM_VIEWERS} redirectTo="/my"><FlagsPage /></RoleRoute>
          } />
          <Route path="/program/risks" element={
            <RoleRoute allowed={PROGRAM_VIEWERS} redirectTo="/my"><Risks /></RoleRoute>
          } />
          <Route path="/program/recommendations" element={
            <RoleRoute allowed={PROGRAM_VIEWERS} redirectTo="/my"><Recommendations /></RoleRoute>
          } />
          <Route path="/program/calendar" element={
            <RoleRoute allowed={PROGRAM_VIEWERS} redirectTo="/my"><CalendarPage /></RoleRoute>
          } />
          <Route path="/program/reports" element={
            <RoleRoute allowed={PROGRAM_VIEWERS} redirectTo="/my"><Reports /></RoleRoute>
          } />
          <Route path="/program/audit" element={
            <RoleRoute allowed={PROGRAM_VIEWERS} redirectTo="/my"><Audit /></RoleRoute>
          } />
          <Route path="/program/passport" element={
            <RoleRoute allowed={PROGRAM_VIEWERS} redirectTo="/my"><Passport /></RoleRoute>
          } />
          <Route path="/admin" element={
            <RoleRoute allowed={['ADMIN']}><Navigate to="/admin/users" replace /></RoleRoute>
          } />
          <Route path="/admin/users" element={
            <RoleRoute allowed={['ADMIN']}><AdminUsers /></RoleRoute>
          } />
          <Route path="/admin/keys" element={
            <RoleRoute allowed={['ADMIN']}><AdminKeys /></RoleRoute>
          } />
          <Route path="/admin/periods" element={
            <RoleRoute allowed={['ADMIN']}><AdminPeriods /></RoleRoute>
          } />
          <Route path="/admin/system" element={
            <RoleRoute allowed={['ADMIN']}><AdminSystem /></RoleRoute>
          } />
          <Route path="*" element={<Home />} />
        </Route>
      </Routes>
    </Suspense>
  </BrowserRouter></AuthProvider>
}
