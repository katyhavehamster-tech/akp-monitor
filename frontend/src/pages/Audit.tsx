import { useState } from 'react'
import { Link } from 'react-router-dom'
import { download, fmtDateTime, type Any } from '../api'
import { Card, ErrorBox, Loading, PageHead, useApi } from '../components/ui'

export default function Audit() {
  const emptyQ = { obj_id: '', actor: '', action: '' }
  const [q, setQ] = useState(emptyQ)
  const [applied, setApplied] = useState(emptyQ)
  const qs = new URLSearchParams(Object.entries(applied).filter(([, v]) => v) as [string, string][]).toString()
  const { data, error } = useApi<Any>(`audit?limit=300&${qs}`, [qs])
  const chain = useApi<Any>('audit/verify')
  if (error) return <ErrorBox msg={error} />
  const hasFilter = !!(applied.obj_id || applied.actor || applied.action)
  return <>
    <PageHead title="Журнал дій">
      <button type="button" className="btn secondary" onClick={() => download('audit/export', 'zhurnal_dii.csv')}>Експорт CSV</button>
    </PageHead>
    {chain.data && <div className={`alert ${chain.data.ok ? 'success' : 'danger'}`}>
      Ланцюжок хешів {chain.data.ok ? `цілісний: перевірено ${chain.data.checked} записів` : `ПОРУШЕНО на записі #${chain.data.broken_at}`}.
      Кожен запис містить SHA-256 попереднього, тож змінити чи видалити запис непомітно неможливо.</div>}
    <Card>
      <form className="filter-bar" onSubmit={e => { e.preventDefault(); setApplied(q) }}>
        <input placeholder="Обʼєкт (Z-17, E-001…)" value={q.obj_id} onChange={e => setQ({ ...q, obj_id: e.target.value })} />
        <input placeholder="Користувач (U-002)" value={q.actor} onChange={e => setQ({ ...q, actor: e.target.value })} />
        <input placeholder="Дія містить…" value={q.action} onChange={e => setQ({ ...q, action: e.target.value })} />
        <button type="submit" className="btn">Фільтрувати</button>
        {hasFilter && <button type="button" className="btn secondary small" onClick={() => { setQ(emptyQ); setApplied(emptyQ) }}>Скинути</button>}
        {data && <span className="muted" style={{ marginLeft: 'auto' }}>записів: <b>{data.total}</b></span>}
      </form>
    </Card>
    {!data ? <Loading /> : <Card><div className="table-wrap"><table className="t"><thead><tr>
      <th style={{ width: 52 }}>#</th><th>Час</th><th>Хто</th><th>Дія</th><th>Обʼєкт</th><th>Поле</th><th>Було → стало</th><th>Хеш</th></tr></thead><tbody>
      {data.items.map((a: Any) => <tr key={a.id}>
        <td className="nowrap">{a.id}</td>
        <td className="nowrap"><small>{fmtDateTime(a.ts)}</small></td>
        <td className="nowrap"><small><b>{a.actor || '—'}</b>{a.actor_role && <><br /><span className="muted">{a.actor_role}</span></>}</small></td>
        <td>{a.action}</td>
        <td className="nowrap">{String(a.obj_id || '').startsWith('Z-') ? <Link to={`/program/measures/${a.obj_id}`}>{a.obj_id}</Link> : a.obj_id}<br /><small className="muted">{a.obj_type}</small></td>
        <td>{a.field ? <code>{a.field}</code> : <span className="muted">—</span>}</td>
        <td style={{ minWidth: 180, maxWidth: 360 }}><small>{a.old && <s>{a.old.slice(0, 100)}</s>}{a.old && ' → '}{a.new.slice(0, 140)}</small></td>
        <td className="nowrap"><span className="hash">{a.hash.slice(0, 12)}…</span></td>
      </tr>)}
    </tbody></table></div></Card>}
  </>
}
