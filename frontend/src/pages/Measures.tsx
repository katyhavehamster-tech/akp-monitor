import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, X } from 'lucide-react'
import { api, download, fmtDate, type Any } from '../api'
import { can, useAuth } from '../auth'
import { APPROVAL_TONE, Card, ErrorBox, Flags, Loading, PageHead, Pill, PORTAL_TONE, RISK_TONE, STATUS, StatusPill, useApi } from '../components/ui'

export function MeasureTable({ items, showUnit = true }: { items: Any[]; showUnit?: boolean }) {
  const nav = useNavigate()
  return <div className="table-wrap"><table className="t"><thead><tr>
    <th>Код</th><th>Захід</th>{showUnit && <th>Підрозділ</th>}<th>Строк</th><th>Статус</th><th>Стан для Порталу</th>
    <th>Погодження</th><th>Підтв.</th><th>Сигнали</th><th>Ризик невик.</th>
  </tr></thead><tbody>
    {items.map(i => <tr key={i.code} className="click" onClick={() => nav(`/program/measures/${i.code}`)}>
      <td className="nowrap"><b>{i.code}</b><br /><small className="muted">Р{i.section.slice(1)} №{i.number}</small></td>
      <td style={{ minWidth: 240, maxWidth: 420 }}><div className="clamp">{i.content}</div>{i.risk && <small className="muted">ризик {i.risk}</small>}</td>
      {showUnit && <td style={{ minWidth: 130 }}><small><b>{i.unit.code}</b><br />{i.unit.name}</small></td>}
      <td style={{ minWidth: 120 }}><small>{i.strok_text}{i.postponed ? <><br /><Pill tone="warn">перенесено ×{i.postponed} → {fmtDate(i.current_deadline)}</Pill></> : null}</small></td>
      <td><StatusPill s={i.status} /></td>
      <td><Pill tone={PORTAL_TONE[i.portal_state]}>{i.portal_state}</Pill></td>
      <td>{i.execution ? <Pill tone={APPROVAL_TONE[i.execution.approval]}>{i.execution.approval_name}</Pill> : <Pill tone="grey">не внесено</Pill>}</td>
      <td className="nowrap">{i.evidence_count}</td>
      <td><Flags flags={i.flags} /></td>
      <td><Pill tone={RISK_TONE[i.nonexecution_risk.level]}>{i.nonexecution_risk.level}</Pill></td>
    </tr>)}
    {!items.length && <tr><td colSpan={showUnit ? 10 : 9} className="muted">Заходів за цими умовами немає.</td></tr>}
  </tbody></table></div>
}

export default function Measures() {
  const { period, profile } = useAuth()
  const [sp, setSp] = useSearchParams()
  const [qText, setQText] = useState(sp.get('q') || '')
  useEffect(() => { setQText(sp.get('q') || '') }, [sp])
  const qs = new URLSearchParams(sp)
  qs.set('period', period)
  const { data, error, reload } = useApi<Any>(period ? `measures?${qs}` : null, [period, sp.toString()])
  const units = useApi<Any[]>('units')
  const [adding, setAdding] = useState(false)
  if (error) return <ErrorBox msg={error} />
  if (!data) return <Loading />
  let items = data.items
  if (sp.get('postponed')) items = items.filter((i: Any) => i.postponed > 0)
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n) }

  return <>
    <PageHead title="Реєстр заходів програми">
      <button type="button" className="btn secondary" onClick={() => download(`reports/internal?period=${period}&format=xlsx`, `vnutrishnii_zvit_${period}.xlsx`)}>Експорт XLSX</button>
      <button type="button" className="btn secondary" onClick={() => download(`reports/internal?period=${period}&format=csv`, `vnutrishnii_zvit_${period}.csv`)}>CSV</button>
      {can.edit(profile?.role) && <button type="button" className="btn gold" onClick={() => setAdding(!adding)}>{adding ? 'Закрити форму' : '+ Запланувати захід'}</button>}
    </PageHead>
    {adding && <NewMeasure units={units.data || []} onDone={() => { setAdding(false); reload() }} />}
    <Card>
      <div className="filter-bar">
        <select value={sp.get('section') || ''} onChange={e => set('section', e.target.value)} aria-label="Розділ програми">
          <option value="">Усі розділи</option><option value="R1">Розділ 1</option><option value="R2">Розділ 2</option><option value="R3">Розділ 3</option>
        </select>
        {profile?.role !== 'VYK' && <select value={sp.get('unit') || ''} onChange={e => set('unit', e.target.value)} aria-label="Підрозділ">
          <option value="">Усі підрозділи</option>{units.data?.map(u => <option key={u.code} value={u.code}>{u.code} {u.name}</option>)}
        </select>}
        <select value={sp.get('status') || ''} onChange={e => set('status', e.target.value)} aria-label="Статус">
          <option value="">Будь-який статус</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          <option value="Не виконано">Портал: не виконано</option><option value="Строк виконання заходу не настав">Портал: строк не настав</option>
        </select>
        <select value={sp.get('flag') || ''} onChange={e => set('flag', e.target.value)} aria-label="Сигнал">
          <option value="">Усі сигнали</option>{['RF1', 'RF2', 'RF3', 'RF4', 'RF5', 'RF6', 'RF7a', 'RF7b', 'RF7c', 'RF7e'].map(f => <option key={f}>{f}</option>)}
        </select>
        <div className="search-box">
          <input
            placeholder="Пошук за змістом або кодом…"
            value={qText}
            onChange={e => setQText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && set('q', qText.trim())}
          />
          {qText && (
            <button type="button" className="search-clear" aria-label="Очистити пошук" onClick={() => { setQText(''); set('q', '') }}>
              <X size={14} />
            </button>
          )}
          <button type="button" className="btn secondary small icon" title="Знайти" aria-label="Знайти" onClick={() => set('q', qText.trim())}>
            <Search size={15} />
          </button>
        </div>
        <label className="row check-inline"><input type="checkbox" checked={!!sp.get('postponed')} onChange={e => set('postponed', e.target.checked ? '1' : '')} /> строк перенесено</label>
        <span className="spacer hide-sm" />
        <div className="row" style={{ marginLeft: 'auto' }}>
          <span className="muted">Знайдено: <b>{items.length}</b></span>
          {[...sp.keys()].length > 0 && <button type="button" className="btn secondary small" onClick={() => { setQText(''); setSp(new URLSearchParams()) }}>Скинути</button>}
        </div>
      </div>
    </Card>
    <Card><MeasureTable items={items} /></Card>
  </>
}

function NewMeasure({ units, onDone }: { units: Any[]; onDone: () => void }) {
  const [f, setF] = useState<Any>({ section: 'R2', strok_type: 'data' })
  const [err, setErr] = useState('')
  const risks = useApi<Any[]>('risks')
  const set = (k: string) => (e: Any) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    setErr('')
    try { await api('measures', { body: f }); onDone() } catch (e) { setErr((e as Error).message) }
  }
  return <Card title="Новий захід програми">
    <div className="hint">Кожен захід розділу 2 повʼязується з ризиком із реєстру; зменшення ризику оцінюється за його індикатором стану.</div>
    <div className="grid g3">
      <label className="f">Розділ<select value={f.section} onChange={set('section')}><option value="R1">1</option><option value="R2">2 — усунення ризиків</option><option value="R3">3 — навчання</option></select></label>
      <label className="f">Корупційний ризик<select value={f.risk || ''} onChange={set('risk')}><option value="">—</option>{risks.data?.map(r => <option key={r.code} value={r.code}>{r.code} {r.name}</option>)}</select></label>
      <label className="f">Відповідальний підрозділ<select value={f.unit || ''} onChange={set('unit')}><option value="">—</option>{units.map(u => <option key={u.code} value={u.code}>{u.code} {u.name}</option>)}</select></label>
    </div>
    <label className="f">Зміст заходу<textarea value={f.content || ''} onChange={set('content')} /></label>
    <div className="grid g4">
      <label className="f">Строк (як у програмі)<input value={f.strok_text || ''} onChange={set('strok_text')} placeholder="IV квартал 2026" /></label>
      <label className="f">Тип строку<select value={f.strok_type} onChange={set('strok_type')}><option value="data">до дати</option><option value="postiino">постійно</option><option value="periodychno">періодично</option></select></label>
      <label className="f">Кінцева дата<input type="date" value={f.strok_date || ''} onChange={set('strok_date')} /></label>
      <label className="f">Потрібні підтвердження<input value={f.required_evidence || ''} onChange={set('required_evidence')} /></label>
    </div>
    <div className="grid g3">
      <label className="f">Індикатор виконання<input value={f.indicator || ''} onChange={set('indicator')} /></label>
      <label className="f">Одиниця<input value={f.indicator_unit || ''} onChange={set('indicator_unit')} placeholder="% / шт." /></label>
      <label className="f">Цільове значення<input type="number" value={f.indicator_target || ''} onChange={set('indicator_target')} /></label>
    </div>
    {err && <div className="alert danger">{err}</div>}
    <button type="button" className="btn" onClick={save}>Зберегти захід</button>
  </Card>
}
