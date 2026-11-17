import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtDate, fmtDateTime, type Any } from '../api'
import { useAuth } from '../auth'
import { Card, ErrorBox, Loading, Pill, useApi } from '../components/ui'

const PR: Record<number, [string, string]> = { 1: ['високий', 'bad'], 2: ['середній', 'warn'], 3: ['низький', 'grey'] }
const ST: Record<string, string> = { proposed: 'info', accepted: 'gold', rejected: 'grey', done: 'ok' }

export default function Recommendations() {
  const { period } = useAuth()
  const { data, error, reload } = useApi<Any>(period ? `recommendations?period=${period}` : null, [period])
  const units = useApi<Any[]>('units')
  if (error) return <ErrorBox msg={error} />
  if (!data) return <Loading />
  return <>
    <h1>Управлінські рекомендації · {data.period}</h1>
    <div className="hint">Рекомендації формуються автоматично за явними правилами (<code>rules.yaml</code>) з поясненням підстав.
      Система лише пропонує: рішення ухвалює уповноважена особа, а кожна прийнята рекомендація отримує відповідального і строк.
      Виконання перевіряється в наступному звітному періоді.</div>
    {data.items.map((r: Any) => <Rec key={r.id} r={r} units={units.data || []} canDecide={data.can_decide} onDone={reload} />)}
    {!data.items.length && <p className="muted">Рекомендацій немає.</p>}
  </>
}

function Rec({ r, units, canDecide, onDone }: { r: Any; units: Any[]; canDecide: boolean; onDone: () => void }) {
  const [f, setF] = useState<Any>({ responsible_unit: r.target_unit?.code || '' })
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState('')
  const decide = async (state: string) => {
    setErr('')
    try { await api(`recommendations/${r.id}/decide`, { body: { state, ...f } }); setOpen(false); onDone() } catch (x) { setErr((x as Error).message) }
  }
  return <Card title={<><Pill tone={PR[r.priority][1]}>{PR[r.priority][0]} пріоритет</Pill> {r.proposed_action}</>}>
    <div className="row"><Pill tone={ST[r.state]}>{r.state_name}</Pill>
      {r.responsible_unit && <small>Відповідальний: <b>{r.responsible_unit.code} {r.responsible_unit.name}</b>, строк <b>{fmtDate(r.due_date)}</b></small>}
      {r.decided_by && <small className="muted">рішення: {r.decided_by}, {fmtDateTime(r.decided_at)}</small>}
      {!r.still_relevant && <Pill tone="ok">підстава більше не діє</Pill>}
    </div>
    {r.decision_comment && <p><small>Коментар: {r.decision_comment}</small></p>}
    <details style={{ marginTop: '.5rem' }}><summary className="muted">Підстави ({r.basis.flags?.length || 0} сигналів): {r.title}</summary>
      <ul>{r.basis.flags?.map((f: Any, i: number) => <li key={i}><small><b>{f.code}</b> {f.object === 'zakhid' ? <Link to={`/program/measures/${f.id}`}>{f.id}</Link> : f.id}: {f.explanation}</small></li>)}</ul>
    </details>
    {canDecide && (r.state === 'proposed' || r.state === 'accepted') && <div style={{ marginTop: '.5rem' }}>
      {!open ? <div className="row">
        {r.state === 'proposed' && <button className="btn small" onClick={() => setOpen(true)}>Прийняти рішення</button>}
        {r.state === 'accepted' && <button className="btn small gold" onClick={() => decide('done')}>Позначити виконаною</button>}
      </div> : <div className="grid g4" style={{ alignItems: 'end' }}>
        <label className="f">Відповідальний<select value={f.responsible_unit} onChange={e => setF({ ...f, responsible_unit: e.target.value })}>
          <option value="">—</option>{units.map(u => <option key={u.code} value={u.code}>{u.code} {u.name}</option>)}</select></label>
        <label className="f">Строк<input type="date" onChange={e => setF({ ...f, due_date: e.target.value })} /></label>
        <label className="f">Коментар<input onChange={e => setF({ ...f, comment: e.target.value })} /></label>
        <div className="row" style={{ marginBottom: '.75rem' }}><button className="btn small" onClick={() => decide('accepted')}>Прийняти</button>
          <button className="btn small danger" onClick={() => decide('rejected')}>Відхилити</button></div>
      </div>}
      {err && <div className="alert danger">{err}</div>}
    </div>}
  </Card>
}
