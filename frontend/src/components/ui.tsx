import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api, type Any } from '../api'

/** Завантаження даних з API з повторним запитом за зміною залежностей. */
export function useApi<T = Any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const load = useCallback(async () => {
    if (!path) return
    setLoading(true)
    setError(null)
    try { setData(await api<T>(path)) } catch (e) { setError((e as Error).message) }
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps])
  useEffect(() => { load() }, [load])
  return { data, error, loading, reload: load, setData }
}

export const Loading = () => <div className="card muted">Завантаження…</div>
export const ErrorBox = ({ msg }: { msg: string }) => <div className="alert danger">{msg}</div>

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>
    {(title || actions) && <div className="card-head">{title && <h2>{title}</h2>}{actions && <div className="row">{actions}</div>}</div>}
    {children}
  </section>
}

export function Stat({ v, l, s, tone = '', onClick }: { v: ReactNode; l: ReactNode; s?: ReactNode; tone?: string; onClick?: () => void }) {
  const inner = <><div className="v">{v}</div><div className="l">{l}</div>{s && <div className="s">{s}</div>}</>
  return <div className={`stat ${tone}`}>{onClick ? <button onClick={onClick}>{inner}</button> : inner}</div>
}

export const STATUS: Record<string, { label: string; tone: string; color: string }> = {
  vykonano: { label: 'виконано', tone: 'ok', color: '#1f8a4c' },
  chastkovo: { label: 'частково виконано', tone: 'gold', color: '#e3a812' },
  v_roboti: { label: 'у роботі', tone: 'info', color: '#1d4f9a' },
  ne_vykonano: { label: 'не виконано', tone: 'bad', color: '#b3261e' },
  ne_rozpochato: { label: 'не розпочато', tone: 'grey', color: '#9aa6bd' },
}
export const PORTAL_TONE: Record<string, string> = {
  'Виконано': 'ok', 'Частково виконано': 'gold', 'Не виконано': 'bad', 'Строк виконання заходу не настав': 'grey',
}
export const RISK_TONE: Record<string, string> = { 'низький': 'ok', 'середній': 'warn', 'високий': 'bad', 'критичний': 'bad' }
export const APPROVAL_TONE: Record<string, string> = { draft: 'grey', submitted: 'warn', approved: 'ok', returned: 'bad' }

export const StatusPill = ({ s }: { s: string }) => <span className={`pill ${STATUS[s]?.tone || 'grey'}`}>{STATUS[s]?.label || s}</span>
export const Pill = ({ tone, children }: { tone: string; children: ReactNode }) => <span className={`pill ${tone}`}>{children}</span>

export function Flags({ flags }: { flags: Any[] }) {
  if (!flags?.length) return <span className="muted">—</span>
  return <>{flags.map((f, i) =>
    <span key={i} className={`flag ${f.severity}`} title={`${f.title}: ${f.explanation}\nПравило: ${f.rule}`}>{f.code}</span>)}</>
}

export function Bar({ value, color }: { value: number; color?: string }) {
  const v = Math.max(0, Math.min(100, value))
  return <div className="bar"><span style={{ width: `${v}%`, background: color }} /></div>
}

/** Стрічка розподілу статусів. */
export function StatusStack({ counts, total }: { counts: Record<string, number>; total: number }) {
  const order = ['vykonano', 'chastkovo', 'v_roboti', 'ne_vykonano', 'ne_rozpochato']
  return <div className="stack" title={order.map(k => `${STATUS[k].label}: ${counts[k] || 0}`).join('\n')}>
    {order.map(k => <span key={k} style={{ width: `${total ? (100 * (counts[k] || 0)) / total : 0}%`, background: STATUS[k].color }} />)}
  </div>
}

export function StatusLegend() {
  return <div className="legend">{Object.entries(STATUS).map(([k, v]) =>
    <span key={k}><i style={{ background: v.color }} />{v.label}</span>)}</div>
}

export function Tabs({ tabs, value, onChange }: { tabs: [string, string][]; value: string; onChange: (v: string) => void }) {
  return <div className="tabs">{tabs.map(([k, l]) =>
    <button key={k} className={value === k ? 'active' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>
}

/** Мінімальний рендер Markdown для аналітичної довідки (заголовки, списки, жирний). */
export function Markdown({ text }: { text: string }) {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>)
  const out: ReactNode[] = []
  let list: ReactNode[] = []
  let ordered = false
  const flush = () => { if (list.length) { out.push(ordered ? <ol key={out.length}>{list}</ol> : <ul key={out.length}>{list}</ul>); list = [] } }
  text.split('\n').forEach((line, i) => {
    if (/^\d+\.\s/.test(line)) { if (!ordered) flush(); ordered = true; list.push(<li key={i}>{inline(line.replace(/^\d+\.\s/, ''))}</li>); return }
    if (line.startsWith('- ')) { if (ordered) flush(); ordered = false; list.push(<li key={i}>{inline(line.slice(2))}</li>); return }
    flush()
    if (line.startsWith('## ')) out.push(<h2 key={i}>{inline(line.slice(3))}</h2>)
    else if (line.startsWith('# ')) out.push(<h1 key={i}>{inline(line.slice(2))}</h1>)
    else if (line.trim()) out.push(<p key={i}>{inline(line.replace(/\s\s$/, ''))}</p>)
  })
  flush()
  return <div className="md">{out}</div>
}
