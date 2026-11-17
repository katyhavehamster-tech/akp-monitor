import { useNavigate } from 'react-router-dom'
import { fmtDate, type Any } from '../api'
import { useAuth } from '../auth'
import { APPROVAL_TONE, Card, ErrorBox, Flags, Loading, Pill, Stat, StatusPill, useApi } from '../components/ui'

export default function MyMeasures() {
  const { period, profile, periods } = useAuth()
  const nav = useNavigate()
  const dash = useApi<Any>(period ? `dashboard?period=${period}` : null, [period])
  const list = useApi<Any>(period ? `measures?period=${period}` : null, [period])
  if (dash.error || list.error) return <ErrorBox msg={(dash.error || list.error)!} />
  if (!dash.data || !list.data) return <Loading />
  const per = periods.find(p => p.code === period)
  const c = dash.data.monitoring.counts, pc = dash.data.monitoring.percent
  const todo = list.data.items.filter((i: Any) => !i.execution?.entered_at || i.execution?.approval === 'returned')

  return <>
    <h1>Кабінет виконавця · {profile?.unit?.name}</h1>
    <p className="muted">{profile?.position}. Ви бачите і заповнюєте лише заходи, де виконавцем є ваш підрозділ ({profile?.unit?.code}).</p>
    {per && <div className={`alert ${per.is_open ? 'success' : 'warning'}`}>
      Звітування — 4 рази на рік, протягом {Math.round((new Date(per.window_end).getTime() - new Date(per.window_start).getTime()) / 864e5) + 1} днів після завершення кварталу.
      {' '}Вікно за {per.code}: <b>{fmtDate(per.window_start)}–{fmtDate(per.window_end)}</b> — {per.is_open ? 'відкрите, можна вносити інформацію' : 'закрите, доступний лише перегляд'}.
    </div>}
    <div className="stats">
      <Stat v={dash.data.monitoring.total} l="Моїх заходів" />
      <Stat v={todo.length} l="Потребують внесення" tone={todo.length ? 'warn' : 'ok'} />
      <Stat v={`${pc.vykonano}%`} l="Виконано" tone="ok" s={`${c.vykonano} заходів`} />
      <Stat v={c.overdue} l="Прострочено" tone={c.overdue ? 'bad' : 'ok'} />
      <Stat v={dash.data.flags.total} l="Сигналів до виправлення" tone={dash.data.flags.total ? 'bad' : 'ok'} />
    </div>
    {dash.data.reminders.length > 0 && <Card title="Нагадування">
      {dash.data.reminders.map((r: Any, i: number) => <div key={i} className={`alert ${r.level}`}>{r.text}</div>)}
    </Card>}
    <Card title="Мої заходи">
      <div className="table-wrap"><table className="t"><thead><tr>
        <th>Код</th><th>Захід</th><th>Строк</th><th>Статус</th><th>Погодження</th><th>Підтв.</th><th>Сигнали</th><th></th>
      </tr></thead><tbody>
        {list.data.items.map((i: Any) => <tr key={i.code} className="click" onClick={() => nav(`/program/measures/${i.code}`)}>
          <td><b>{i.code}</b></td>
          <td style={{ maxWidth: 460 }}><div className="clamp">{i.content}</div><small className="muted">Підтвердження: {i.required_evidence}</small></td>
          <td><small>{i.strok_text}</small></td>
          <td><StatusPill s={i.status} /></td>
          <td>{i.execution?.entered_at ? <Pill tone={APPROVAL_TONE[i.execution.approval]}>{i.execution.approval_name}</Pill> : <Pill tone="warn">не внесено</Pill>}</td>
          <td>{i.evidence_count}</td>
          <td><Flags flags={i.flags} /></td>
          <td><button className="btn small">{per?.is_open ? 'Заповнити' : 'Переглянути'}</button></td>
        </tr>)}
      </tbody></table></div>
    </Card>
  </>
}
