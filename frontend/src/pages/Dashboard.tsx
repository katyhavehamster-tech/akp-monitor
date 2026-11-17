import { useNavigate } from 'react-router-dom'
import { Bar as RBar, BarChart, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtDate, num, type Any } from '../api'
import { useAuth } from '../auth'
import { Bar, Card, ErrorBox, Flags, Loading, Pill, RISK_TONE, STATUS, StatusLegend, StatusPill, StatusStack, Stat, useApi } from '../components/ui'

export default function Dashboard() {
  const { period, profile } = useAuth()
  const { data, error } = useApi<Any>(period ? `dashboard?period=${period}` : null, [period])
  const nav = useNavigate()
  if (error) return <ErrorBox msg={error} />
  if (!data) return <Loading />
  const m = data.monitoring
  const c = m.counts, p = m.percent
  const go = (q: string) => nav(`/program/measures?${q}`)
  const pie = Object.keys(STATUS).map(k => ({ name: STATUS[k].label, value: c[k] || 0, color: STATUS[k].color })).filter(x => x.value)
  const sections = data.by_section.map((s: Any) => ({
    name: `Розділ ${s.code.slice(1)}`, ...Object.fromEntries(Object.keys(STATUS).map(k => [STATUS[k].label, s.counts[k] || 0])),
  }))

  return <>
    <div className="row" style={{ marginBottom: '.75rem' }}>
      <h1 style={{ margin: 0 }}>Моніторинг виконання програми</h1>
      <span className="spacer" />
      <span className="muted">Період {data.period.code} ({fmtDate(data.period.start)}–{fmtDate(data.period.end)})</span>
    </div>

    {data.reminders.length > 0 && <Card title="Нагадування">
      {data.reminders.slice(0, 8).map((r: Any, i: number) =>
        <div key={i} className={`alert ${r.level}`}>{r.measure ? <a href={`/program/measures/${r.measure}`} onClick={e => { e.preventDefault(); nav(`/program/measures/${r.measure}`) }}>{r.text}</a> : r.text}</div>)}
      {data.reminders.length > 8 && <small className="muted">…і ще {data.reminders.length - 8}</small>}
    </Card>}

    <div className="stats">
      <Stat v={`${p.vykonano}%`} l="Виконано" s={`${c.vykonano} з ${m.total} заходів`} tone="ok" onClick={() => go('status=vykonano')} />
      <Stat v={`${p.ne_vykonano}%`} l="Не виконано" s={`${c.portal_not_done} (строк минув або не виконано)`} tone="bad" onClick={() => go('status=Не виконано')} />
      <Stat v={`${p.v_roboti}%`} l="На стадії виконання" s={`${c.v_roboti} у роботі`} onClick={() => go('status=v_roboti')} />
      <Stat v={`${p.postponed}%`} l="Строк перенесено" s={`${c.postponed} заходів`} tone="warn" onClick={() => go('postponed=1')} />
      <Stat v={c.done_on_time} l="Виконано вчасно" s={`${c.done_late} із запізненням${p.on_time_of_dated_done !== null ? ` · ${p.on_time_of_dated_done}% вчасно` : ''}`} tone="ok" />
      <Stat v={`${p.overdue}%`} l="Прострочено" s={`${c.overdue} заходів за строком програми`} tone="bad" onClick={() => go('flag=RF1')} />
      <Stat v={`${p.chastkovo}%`} l="Частково виконано" s={`${c.chastkovo} заходів`} tone="warn" onClick={() => go('status=chastkovo')} />
      <Stat v={`${p.not_due}%`} l="Строк не настав" s={`${c.not_due} заходів`} tone="grey" />
    </div>

    <div className="grid g3">
      <Card title="Розподіл за статусами">
        <div style={{ height: 230 }}>
          <ResponsiveContainer><PieChart>
            <Pie data={pie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={1}>
              {pie.map((x, i) => <Cell key={i} fill={x.color} />)}
            </Pie><Tooltip />
          </PieChart></ResponsiveContainer>
        </div>
        <StatusLegend />
      </Card>
      <Card title="Виконання за розділами">
        <div style={{ height: 250 }}>
          <ResponsiveContainer><BarChart data={sections} layout="vertical" margin={{ left: 10 }}>
            <XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="name" width={70} /><Tooltip />
            {Object.keys(STATUS).map(k => <RBar key={k} dataKey={STATUS[k].label} stackId="a" fill={STATUS[k].color} />)}
          </BarChart></ResponsiveContainer>
        </div>
      </Card>
      <Card title="Повнота звітування">
        <p>Інформацію внесено: <b>{c.entered}</b> з {m.total} ({p.entered}%)</p>
        <Bar value={p.entered} />
        <p style={{ marginTop: '.8rem' }}>Погоджено координатором: <b>{c.approved}</b> ({p.approved}%)</p>
        <Bar value={p.approved} color="#1f8a4c" />
        <p style={{ marginTop: '.8rem' }}>Сигналів Risk Flags: <b>{data.flags.total}</b></p>
        <div>{Object.entries(data.flags.by_code).map(([k, v]) =>
          <a key={k} href="#" onClick={e => { e.preventDefault(); go(`flag=${k}`) }} title={data.flags.catalog[k]}>
            <span className="flag medium">{k}: {String(v)}</span></a>)}</div>
      </Card>
    </div>

    <Card title="Стан корупційних ризиків" actions={<a className="btn secondary small" href="/program/risks" onClick={e => { e.preventDefault(); nav('/program/risks') }}>Детальніше</a>}>
      <p className="muted">Оцінюємо не кількість закритих заходів, а зміну індикатора стану ризику: скільки шляху пройдено від базового значення до цільового.</p>
      <div className="table-wrap"><table className="t"><thead><tr>
        <th>Ризик</th><th>Рівень</th><th>Індикатор</th><th style={{ width: 200 }}>Шлях до цілі</th><th>Заходи</th><th>Висновок</th>
      </tr></thead><tbody>
        {data.risks.map((r: Any) => <tr key={r.code}>
          <td><b>{r.code}</b> {r.name}</td>
          <td><Pill tone={RISK_TONE[r.level]}>{r.level}</Pill></td>
          <td><small>{num(r.baseline)} → <b>{num(r.current)}</b> (ціль {num(r.target)} {r.unit})</small></td>
          <td>{r.progress === null ? '—' : <><Bar value={r.progress * 100} color={r.progress < .1 ? '#b3261e' : r.progress < .5 ? '#e3a812' : '#1f8a4c'} /><small>{Math.round(r.progress * 100)}%</small></>}</td>
          <td>{r.measures_done}/{r.measures_total}</td>
          <td><Pill tone={r.verdict === 'зменшується' ? 'ok' : r.verdict === 'повільно зменшується' ? 'warn' : 'bad'}>{r.verdict}</Pill></td>
        </tr>)}
      </tbody></table></div>
    </Card>

    {profile?.role !== 'VYK' && <Card title="Карта ризику невиконання за підрозділами">
      <p className="muted">Без рейтингування: підрозділи впорядковано за кодом. Колір — найвищий рівень ризику невиконання серед заходів підрозділу; натисніть, щоб відкрити заходи.</p>
      <div className="tiles">{data.by_unit.map((u: Any) => {
        const lvl = u.nonexecution['високий'] ? 'high' : u.nonexecution['середній'] ? 'medium' : 'low'
        return <div key={u.code} className={`tile ${lvl}`} onClick={() => go(`unit=${u.code}`)}>
          <b>{u.code}</b> <span className="n">{u.total} заход.</span>
          <div style={{ fontSize: '.84rem', minHeight: '2.4em' }}>{u.name}</div>
          <StatusStack counts={u.counts} total={u.total} />
          <div className="n" style={{ marginTop: '.3rem' }}>
            ризик невиконання: {u.nonexecution['високий'] || 0} вис. · {u.nonexecution['середній'] || 0} сер. · сигналів {u.flags}
          </div>
        </div>
      })}</div>
    </Card>}

    <div className="grid g2">
      <Card title="Критичні заходи">
        <table className="t"><thead><tr><th>Захід</th><th>Статус</th><th>Сигнали</th><th>Ризик невик.</th></tr></thead><tbody>
          {data.critical.map((b: Any) => <tr key={b.code} className="click" onClick={() => nav(`/program/measures/${b.code}`)}>
            <td><b>{b.code}</b> <small className="muted">{b.unit.code}</small><div className="clamp"><small>{b.content}</small></div></td>
            <td><StatusPill s={b.status} /></td><td><Flags flags={b.flags} /></td>
            <td><Pill tone={RISK_TONE[b.nonexecution_risk.level]}>{b.nonexecution_risk.level} ({b.nonexecution_risk.score})</Pill></td>
          </tr>)}
          {!data.critical.length && <tr><td colSpan={4} className="muted">Критичних заходів немає.</td></tr>}
        </tbody></table>
      </Card>
      <Card title="Найближчі контрольні строки (120 днів)">
        <table className="t"><thead><tr><th>Строк</th><th>Захід</th><th>Статус</th></tr></thead><tbody>
          {data.upcoming.map((b: Any) => <tr key={b.code} className="click" onClick={() => nav(`/program/measures/${b.code}`)}>
            <td>{fmtDate(b.current_deadline)}{b.postponed ? <><br /><Pill tone="warn">перенесено ×{b.postponed}</Pill></> : null}</td>
            <td><b>{b.code}</b> <small className="muted">{b.unit.code}</small><div className="clamp"><small>{b.content}</small></div></td>
            <td><StatusPill s={b.status} /></td>
          </tr>)}
          {!data.upcoming.length && <tr><td colSpan={3} className="muted">Немає строків у найближчі 120 днів.</td></tr>}
        </tbody></table>
      </Card>
    </div>
  </>
}

export { Legend }
