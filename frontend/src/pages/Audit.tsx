import { useState } from 'react'
import { Link } from 'react-router-dom'
import { download, fmtDateTime, type Any } from '../api'
import { Card, ErrorBox, Loading, useApi } from '../components/ui'

export default function Audit() {
  const [q, setQ] = useState({ obj_id: '', actor: '', action: '' })
  const [applied, setApplied] = useState(q)
  const qs = new URLSearchParams(Object.entries(applied).filter(([, v]) => v) as [string, string][]).toString()
  const { data, error } = useApi<Any>(`audit?limit=300&${qs}`, [qs])
  const chain = useApi<Any>('audit/verify')
  if (error) return <ErrorBox msg={error} />
  return <>
    <div className="row" style={{ marginBottom: '.75rem' }}><h1 style={{ margin: 0 }}>Журнал дій</h1><span className="spacer" />
      <button className="btn secondary" onClick={() => download('audit/export', 'zhurnal_dii.csv')}>Експорт CSV</button></div>
    {chain.data && <div className={`alert ${chain.data.ok ? 'success' : 'danger'}`}>
      Ланцюжок хешів {chain.data.ok ? `цілісний: перевірено ${chain.data.checked} записів` : `ПОРУШЕНО на записі #${chain.data.broken_at}`}.
      Кожен запис містить SHA-256 попереднього, тож змінити чи видалити запис непомітно неможливо.</div>}
    <Card><div className="row">
      <input placeholder="Обʼєкт (Z-17, E-001…)" value={q.obj_id} onChange={e => setQ({ ...q, obj_id: e.target.value })} />
      <input placeholder="Користувач (U-002)" value={q.actor} onChange={e => setQ({ ...q, actor: e.target.value })} />
      <input placeholder="Дія містить…" value={q.action} onChange={e => setQ({ ...q, action: e.target.value })} />
      <button className="btn" onClick={() => setApplied(q)}>Фільтрувати</button>
      {data && <span className="muted">записів: {data.total}</span>}
    </div></Card>
    {!data ? <Loading /> : <Card><div className="table-wrap"><table className="t"><thead><tr>
      <th>#</th><th>Час</th><th>Хто</th><th>Дія</th><th>Обʼєкт</th><th>Поле</th><th>Було → стало</th><th>Хеш</th></tr></thead><tbody>
      {data.items.map((a: Any) => <tr key={a.id}>
        <td>{a.id}</td><td><small>{fmtDateTime(a.ts)}</small></td><td><small>{a.actor}<br /><span className="muted">{a.actor_role}</span></small></td>
        <td>{a.action}</td>
        <td>{/^Z-/.test(a.obj_id) ? <Link to={`/program/measures/${a.obj_id}`}>{a.obj_id}</Link> : a.obj_id}<br /><small className="muted">{a.obj_type}</small></td>
        <td><code>{a.field}</code></td>
        <td style={{ maxWidth: 360 }}><small>{a.old && <s>{a.old.slice(0, 100)}</s>}{a.old && ' → '}{a.new.slice(0, 140)}</small></td>
        <td><span className="hash">{a.hash.slice(0, 12)}…</span></td>
      </tr>)}
    </tbody></table></div></Card>}
  </>
}
