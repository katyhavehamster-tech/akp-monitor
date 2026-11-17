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

export class ApiError extends Error {
  status: number
  data: Any
  constructor(status: number, data: Any) {
    super(typeof data === 'object' && data ? (data.detail || Object.values(data).flat().join(' ')) : String(data))
    this.status = status
    this.data = data
  }
}

export async function api<T = Any>(path: string, opts: { method?: string; body?: Any; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const t = getToken()
  if (t) headers.Authorization = `Token ${t}`
  let body: BodyInit | undefined
  if (opts.form) body = opts.form
  else if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body) }
  const r = await fetch(`/api/${path}`, { method: opts.method || (body ? 'POST' : 'GET'), headers, body })
  if (r.status === 204) return undefined as T
  const ct = r.headers.get('content-type') || ''
  const data = ct.includes('json') ? await r.json() : await r.text()
  if (!r.ok) {
    if (r.status === 401) setToken(null)
    throw new ApiError(r.status, data)
  }
  return data as T
}

/** Завантаження файлу з авторизацією (експорт CSV/XLSX/MD). */
export async function download(path: string, filename: string) {
  const t = getToken()
  const r = await fetch(`/api/${path}`, { headers: t ? { Authorization: `Token ${t}` } : {} })
  if (!r.ok) {
    const msg = `Не вдалося завантажити файл (${r.status}).`
    alertBox(msg)
    throw new ApiError(r.status, msg)
  }
  const blob = await r.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
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
  el.textContent = text
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 5000)
}
