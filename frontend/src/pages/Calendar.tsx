import { useNavigate } from 'react-router-dom'
import { fmtDate, type Any } from '../api'
import { useAuth } from '../auth'
import { Card, ErrorBox, Loading, Pill, StatusPill, useApi } from '../components/ui'

const MONTHS = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень']

export default function CalendarPage() {
  const { period, today } = useAuth()
  const nav = useNavigate()
  const { data, error } = useApi<Any[]>(period ? `calendar?period=${period}` : null, [period])
  if (error) return <ErrorBox msg={error} />
  if (!data) return <Loading />
  const groups: Record<string, Any[]> = {}
  for (const i of data) { const k = i.date.slice(0, 7); (groups[k] ||= []).push(i) }
  return <>
    <h1>Календар строків</h1>
    <p className="muted">Строки заходів (з урахуванням внутрішніх перенесень), вікна внесення інформації і звітні дати. Робоча дата: {fmtDate(today)}.</p>
    <div className="grid g3">{Object.entries(groups).map(([k, items]) => {
      const [y, mm] = k.split('-')
      return <Card key={k} title={`${MONTHS[Number(mm) - 1]} ${y}`}>
        {items.map((i, n) => <div key={n} style={{ padding: '.3rem 0', borderBottom: '1px solid var(--line)' }}
          className={i.measure ? 'click' : ''} onClick={() => i.measure && nav(`/program/measures/${i.measure}`)}>
          <b>{fmtDate(i.date)}</b>{' '}
          {i.type === 'window' ? <Pill tone="info">вікно до {fmtDate(i.window_end)}</Pill> : i.type === 'report' ? <Pill tone="gold">звіт НАЗК</Pill>
            : <><b>{i.measure}</b> <small className="muted">{i.unit}</small> <StatusPill s={i.status} />
              {i.program_date !== i.date && <Pill tone="warn">перенесено з {fmtDate(i.program_date)}</Pill>}</>}
          <div className="clamp"><small>{i.content}</small></div>
        </div>)}
      </Card>
    })}</div>
  </>
}
