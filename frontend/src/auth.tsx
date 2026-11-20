import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ensureCsrf, getToken, setToken, type Any } from './api'
import { decryptAndSignChallenge, type KeyFileContainer } from './keyFileCrypto'

export type Role = 'KOORD' | 'ADMIN' | 'KER' | 'VYK' | 'AUDIT'
export interface Profile { code: string; role: Role; role_name: string; unit: { code: string; name: string } | null; position: string }

interface Ctx {
  profile: Profile | null
  today: string | null
  periods: Any[]
  period: string
  setPeriod: (p: string) => void
  login: (u: string, p: string) => Promise<void>
  loginWithKey: (keyContainer: KeyFileContainer, password: string, loginOverride?: string) => Promise<void>
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

  // Фоновий heartbeat перевірки валідності сесії (кожні 5 сек, а також на focus / visibilitychange)
  useEffect(() => {
    if (!profile) return

    let cancelled = false
    const checkSession = async () => {
      if (!getToken() || cancelled) return
      try {
        await api('auth/heartbeat')
      } catch (e: any) {
        if (cancelled) return
        if (e && (e.status === 401 || e.status === 403)) {
          setToken(null)
          setProfile(null)
          let reason = 'session_terminated'
          const detail = typeof e.data === 'object' && e.data ? String(e.data.detail || '') : String(e.data || '')
          if (detail.includes('відкликано') || detail.includes('revoked')) {
            reason = 'key_revoked'
          } else if (detail.includes('заблоковано') || detail.includes('inactive')) {
            reason = 'account_disabled'
          }
          try {
            sessionStorage.setItem('auth_redirect_reason', reason)
          } catch {
            /* ignore */
          }
          if (typeof window !== 'undefined' && !['/login', '/public', '/verify'].includes(window.location.pathname)) {
            window.location.href = `/login?reason=${reason}`
          }
        }
      }
    }

    const intervalId = window.setInterval(checkSession, 5000)
    const onFocus = () => { checkSession() }
    const onVisibility = () => {
      if (!document.hidden) checkSession()
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [profile])

  const login = async (username: string, password: string) => {
    await ensureCsrf()
    const r = await api('auth/login', { body: { username, password } })
    setToken(r.token)
    setPeriod('')
    await reloadMe()
  }

  const loginWithKey = async (keyContainer: KeyFileContainer, password: string, loginOverride?: string) => {
    await ensureCsrf()
    const userLogin = (loginOverride || keyContainer.user_login).trim().toLowerCase()
    if (!userLogin) {
      throw new Error('Вкажіть логін користувача.')
    }

    // 1. Отримання одноразового виклику (challenge) від сервера
    const chal = await api('auth/challenge', {
      body: {
        login: userLogin,
        fingerprint: keyContainer.fingerprint,
      },
    })

    // 2. Локальне розшифрування приватного ключа та підпис виклику через Web Crypto API
    const signature = await decryptAndSignChallenge(keyContainer, password, chal.challenge)

    // 3. Відправка підпису на сервер
    const r = await api('auth/login-key', {
      body: {
        login: userLogin,
        challenge_id: chal.challenge_id,
        signature,
      },
    })

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

  return <AuthCtx.Provider value={{ profile, today, periods, period, setPeriod, login, loginWithKey, logout, reloadMe, ready }}>

    {children}
  </AuthCtx.Provider>
}

export const can = {
  edit: (r?: Role) => r === 'KOORD' || r === 'ADMIN',
  manageMeasures: (r?: Role) => r === 'KOORD' || r === 'ADMIN',
  surveys: (r?: Role) => r === 'KOORD' || r === 'ADMIN' || r === 'AUDIT',
  surveysEdit: (r?: Role) => r === 'KOORD' || r === 'ADMIN',
  tech: (r?: Role) => r === 'ADMIN',
  viewAll: (r?: Role) => !!r && r !== 'VYK',
}
