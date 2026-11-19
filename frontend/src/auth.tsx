import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ensureCsrf, getToken, setToken, type Any } from './api'

export type Role = 'KOORD' | 'ADMIN' | 'KER' | 'VYK' | 'ANAL'
export interface Profile { code: string; role: Role; role_name: string; unit: { code: string; name: string } | null; position: string }

interface Ctx {
  profile: Profile | null
  today: string | null
  periods: Any[]
  period: string
  setPeriod: (p: string) => void
  login: (u: string, p: string) => Promise<void>
  logout: () => Promise<void>
  reloadMe: () => Promise<void>
  ready: boolean
}

const AuthCtx = createContext<Ctx>(null as unknown as Ctx)
export const useAuth = () => useContext(AuthCtx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [today, setToday] = useState<string | null>(null)
  const [periods, setPeriods] = useState<Any[]>([])
  const [period, setPeriod] = useState('')
  const [ready, setReady] = useState(false)

  const reloadMe = useCallback(async () => {
    if (!getToken()) { setReady(true); return }
    try {
      const me = await api('auth/me')
      setProfile(me.profile)
      setToday(me.today)
      setPeriod(prev => prev || me.current_period.code)
      setPeriods(await api('periods'))
    } catch { setToken(null); setProfile(null) }
    setReady(true)
  }, [])

  useEffect(() => {
    ensureCsrf().catch(() => {})
    reloadMe()
  }, [reloadMe])

  const login = async (username: string, password: string) => {
    await ensureCsrf()
    const r = await api('auth/login', { body: { username, password } })
    setToken(r.token)
    setPeriod('')
    await reloadMe()
  }
  const logout = async () => {
    if (getToken()) {
      await api('auth/logout', { method: 'POST', keepalive: true }).catch(() => { /* ignore */ })
    }
    setToken(null)
    setProfile(null)
    setPeriod('')
  }

  return <AuthCtx.Provider value={{ profile, today, periods, period, setPeriod, login, logout, reloadMe, ready }}>
    {children}
  </AuthCtx.Provider>
}

export const can = {
  edit: (r?: Role) => r === 'KOORD' || r === 'ADMIN',
  manageMeasures: (r?: Role) => r === 'KOORD' || r === 'ADMIN',
  surveys: (r?: Role) => r === 'KOORD' || r === 'ADMIN' || r === 'ANAL',
  surveysEdit: (r?: Role) => r === 'KOORD' || r === 'ADMIN',
  tech: (r?: Role) => r === 'ADMIN',
  viewAll: (r?: Role) => !!r && r !== 'VYK',
}
