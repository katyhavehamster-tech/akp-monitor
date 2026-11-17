import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, fmtDateTime, type Any } from '../api'
import { useAuth } from '../auth'
import { APPROVAL_TONE, Card, ErrorBox, Flags, Loading, Pill, StatusPill, Tabs, useApi } from '../components/ui'

export default function Approvals() {
  const { period } = useAuth()
  const nav = useNavigate()
  const [tab, setTab] = useState('submitted')
  const { data, error, reload } = useApi<Any>(period ? `measures?period=${period}` : null, [period])
  if (error) return <ErrorBox msg={error} />
  if (!data) return <Loading />
  const groups: Record<string, Any[]> = { submitted: [], returned: [], approved: [], missing: [] }
  for (const i of data.items) {
    const a = i.execution?.entered_at ? i.execution.approval : 'missing'
    ;(groups[a === 'draft' ? 'missing' : a] ||= []).push(i)
  }
  const approve = async (code: string) => { await api(`measures/${code}/approve`, { body: { period, decision: 'approve' } }); reload() }
  const items = groups[tab] || []
  return <>
    <h1>Погодження інформації виконавців · {period}</h1>
    <p className="muted">Координатор переглядає внесене, звіряє сигнали і погоджує або повертає з зауваженням. Погоджені дані автоматично йдуть у звіт для Порталу.</p>
    <Tabs value={tab} onChange={setTab} tabs={[['submitted', `Очікують погодження (${groups.submitted.length})`], ['returned', `Повернуто (${groups.returned.length})`],
      ['approved', `Погоджено (${groups.approved.length})`], ['missing', `Не внесено (${groups.missing.length})`]]} />
    <Card><div className="table-wrap"><table className="t"><thead><tr>
      <th>Захід</th><th>Підрозділ</th><th>Статус</th><th>Внесено</th><th>Сигнали</th><th>Погодження</th><th></th></tr></thead><tbody>
      {items.map((i: Any) => <tr key={i.code}>
        <td className="click" onClick={() => nav(`/program/measures/${i.code}`)}><b>{i.code}</b><div className="clamp"><small>{i.content}</small></div></td>
        <td><small>{i.unit.code}</small></td><td><StatusPill s={i.status} /></td>
        <td><small>{i.execution?.entered_by || '—'}<br />{fmtDateTime(i.execution?.entered_at)}</small></td>
        <td><Flags flags={i.flags} /></td>
        <td>{i.execution ? <Pill tone={APPROVAL_TONE[i.execution.approval]}>{i.execution.approval_name}</Pill> : '—'}</td>
        <td className="row">
          <button className="btn secondary small" onClick={() => nav(`/program/measures/${i.code}`)}>Відкрити</button>
          {tab === 'submitted' && !i.flags.length && <button className="btn small" onClick={() => approve(i.code)}>Погодити</button>}
        </td>
      </tr>)}
      {!items.length && <tr><td colSpan={7} className="muted">Немає заходів.</td></tr>}
    </tbody></table></div>
    {tab === 'submitted' && <small className="muted">Швидке погодження доступне лише для заходів без сигналів; решту відкрийте і перегляньте.</small>}
    </Card>
  </>
}
