/* Тонкий клієнт до REST API. Токен зберігається в localStorage (з запасним варіантом у памʼяті). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Any = any

let memToken: string | null = null

export function getToken(): string | null {
  try { return localStorage.getItem('akp_token') ?? memToken } catch { return memToken }
}
export function setToken(t: string | null) {
  memToken = t
  try { if (t) localStorage.setItem('akp_token', t); else localStorage.removeItem('akp_token') } catch { /* ignore */ }
}

/** Безпечна перевірка зовнішніх URL: дозволяє лише http:// та https:// (захист від javascript:/data:). */
export function safeUrl(u?: string | null): string | null {
  if (!u) return null
  const trimmed = u.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return null
}

export class ApiError extends Error {
  status: number
  data: Any
  constructor(status: number, data: Any) {
    super(typeof data === 'object' && data ? (data.detail || Object.values(data).flat().join(' ')) : String(data))
    this.status = status
    this.data = data
  }
}

/** Отримання CSRF-токену з cookie (Django standard csrftoken). */
export function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

let csrfPromise: Promise<string | null> | null = null

/** Гарантує наявність csrftoken у cookie (викликає /api/auth/csrf при відсутності). */
export async function ensureCsrf(): Promise<string | null> {
  const existing = getCsrfToken()
  if (existing) return existing
  if (!csrfPromise) {
    csrfPromise = (async () => {
      try {
        const r = await fetch('/api/auth/csrf', { credentials: 'include' })
        if (r.ok) {
          const data = await r.json().catch(() => ({}))
          return (data && data.csrfToken) || getCsrfToken()
        }
      } catch {
        /* ignore */
      }
      return getCsrfToken()
    })().finally(() => {
      csrfPromise = null
    })
  }
  return csrfPromise
}

export async function api<T = Any>(path: string, opts: { method?: string; body?: Any; form?: FormData; keepalive?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const t = getToken()
  if (t) headers.Authorization = `Token ${t}`

  const method = (opts.method || (opts.form || opts.body !== undefined ? 'POST' : 'GET')).toUpperCase()
  const isUnsafe = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)

  if (isUnsafe) {
    let csrf = getCsrfToken()
    if (!csrf) {
      csrf = await ensureCsrf()
    }
    if (csrf) {
      headers['X-CSRFToken'] = csrf
    }
  }

  let body: BodyInit | undefined
  if (opts.form) body = opts.form
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }

  const url = path.startsWith('/api/') ? path : `/api/${path}`
  const r = await fetch(url, {
    method,
    headers,
    body,
    credentials: 'include',
    keepalive: opts.keepalive,
  })
  if (r.status === 204) return undefined as T
  const ct = r.headers.get('content-type') || ''
  const data = ct.includes('json') ? await r.json() : await r.text()
  if (!r.ok) {
    if (r.status === 401) {
      setToken(null)
      try {
        sessionStorage.setItem('auth_redirect_reason', 'key_revoked')
      } catch {
        /* ignore */
      }
      if (typeof window !== 'undefined' && !['/login', '/public', '/verify'].includes(window.location.pathname)) {
        window.location.href = '/login?reason=key_revoked'
      }
    }
    throw new ApiError(r.status, data)
  }
  return data as T
}

/** Завантаження файлу з авторизацією (експорт CSV/XLSX/DOCX/MD та файли підтверджень). */
export async function download(path: string, filename: string) {
  const t = getToken()
  const urlPath = path.startsWith('/api/') ? path : `/api/${path}`
  const r = await fetch(urlPath, {
    headers: t ? { Authorization: `Token ${t}` } : {},
    credentials: 'include',
  })
  if (!r.ok) {
    const msg = r.status === 403
      ? 'Недостатньо прав для доступу до цього файлу.'
      : `Не вдалося завантажити файл (${r.status}).`
    alertBox(msg)
    throw new ApiError(r.status, msg)
  }
  const blob = await r.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export const fmtDate = (d?: string | null) => {
  if (!d) return '—'
  const s = d.slice(0, 10).split('-')
  return s.length === 3 ? `${s[2]}.${s[1]}.${s[0]}` : d
}
export const fmtDateTime = (d?: string | null) => {
  if (!d) return '—'
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? d : dt.toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' })
}
export const num = (v: Any) => (v === null || v === undefined || v === '' ? '—' : Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100))

/** Повідомлення без window.alert (у деяких вбудованих браузерах діалоги заблоковано). */
export function alertBox(text: string) {
  const el = document.createElement('div')
  el.className = 'toast'
  el.setAttribute('role', 'status')
  el.textContent = text
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 5000)
}
