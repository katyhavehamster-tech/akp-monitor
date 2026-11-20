import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bar as RBar, BarChart, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtDate, num, type Any } from '../api'
import { useAuth } from '../auth'
import { ArrowUpRight, Bell, CheckCircle2, Layers, Target } from 'lucide-react'
import { Bar, C, Card, CHART_ITEM_STYLE, CHART_LABEL_STYLE, CHART_TOOLTIP_STYLE, Empty, ErrorBox, Flags, Loading, PageHead, Pill, progressColor, RISK_TONE, STATUS, StatusLegend, StatusPill, StatusStack, Stat, useApi, useIsMobile } from '../components/ui'

export default function Dashboard() {
  const { period, profile } = useAuth()
  const { data, error } = useApi<Any>(period ? `dashboard?period=${period}` : null, [period])
  const [remLimit, setRemLimit] = useState(8)
  const narrow = useIsMobile(380)
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
  const twoLevel = m.two_level_progress || {
    formal_execution_percent: p.vykonano || 0,
    formal_execution_done: c.vykonano || 0,
    formal_execution_total: m.total || 0,
    risk_achievement_percent: 0,
    risks_reducing_count: 0,
    risks_total: 0,
    gap: 0,
    rules_version: data.rules_version || 'v1.2.0',
  }
  const rulesVer = data.rules_version || m.rules_version || twoLevel.rules_version || 'v1.2.0'

  return <>
    <PageHead title="Моніторинг виконання програми"
      sub={<>Період {data.period.code} · {fmtDate(data.period.start)}–{fmtDate(data.period.end)}</>}>
      <button className="btn secondary" onClick={() => nav('/program/measures')}>Реєстр заходів</button>
      <button className="btn" onClick={() => nav('/program/reports')}>Сформувати звіт</button>
    </PageHead>

    {data.reminders.length > 0 && <Card title={<span className="row" style={{ gap: '.45rem' }}><Bell size={16} />Нагадування <Pill tone="grey">{data.reminders.length}</Pill></span>}>
      {data.reminders.slice(0, remLimit).map((r: Any, i: number) =>
        <div key={i} className={`alert ${r.level}`}>{r.measure ? <a href={`/program/measures/${r.measure}`} onClick={e => { e.preventDefault(); nav(`/program/measures/${r.measure}`) }}>{r.text}</a> : r.text}</div>)}
      {data.reminders.length > 8 && (
        <div className="row" style={{ marginTop: '.5rem' }}>
          {remLimit < data.reminders.length ? (
            <>
              <button className="btn secondary small" onClick={() => setRemLimit(prev => prev + 10)}>
                Показати ще ({Math.min(10, data.reminders.length - remLimit)} із {data.reminders.length - remLimit})
              </button>
              <button className="btn ghost small" onClick={() => setRemLimit(data.reminders.length)}>
                Показати всі ({data.reminders.length})
              </button>
            </>
          ) : (
            <button className="btn ghost small" onClick={() => setRemLimit(8)}>Згорнути список</button>
          )}
        </div>
      )}
    </Card>}

    {/* Дворівневий прогрес: Формальне виконання vs Реальне зниження ризиків */}
    <div className="card two-level-progress-card" style={{ marginBottom: '1.25rem', padding: '1.2rem 1.4rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.6rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <Layers size={20} style={{ color: 'var(--accent)' }} />
          <div>
            <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>
              Дворівневий прогрес: Формальне закриття vs Зниження ризиків
            </h2>
            <div className="muted" style={{ fontSize: '.8rem', marginTop: '.15rem' }}>
              Порівняльний аналіз звітних статусів та фактичного впливу на корупційні фактори за Методологією НАЗК № 830/21
            </div>
          </div>
        </div>
        <div className="pill info" style={{ fontSize: '.78rem', fontWeight: 600 }}>
          Рушій правил: {rulesVer}
        </div>
      </div>

      <div className="grid g2" style={{ gap: '1.25rem' }}>
        {/* Рівень 1: Формальне виконання */}
        <div style={{ background: 'var(--surface-2)', padding: '1rem', borderRadius: 'var(--radius)', border: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontWeight: 600, fontSize: '.92rem' }}>
              <CheckCircle2 size={17} style={{ color: 'var(--ok)' }} />
              1. Виконання заходів (формальне)
            </span>
            <span style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--ok)' }}>
              {twoLevel.formal_execution_percent}%
            </span>
          </div>
          <div style={{ height: 10, borderRadius: 5, background: 'var(--line)', overflow: 'hidden', margin: '.6rem 0' }}>
            <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, twoLevel.formal_execution_percent))}%`, background: 'var(--ok)', transition: 'width .3s' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8rem', color: 'var(--muted)' }}>
            <span>Закрито: <b>{twoLevel.formal_execution_done}</b> з <b>{twoLevel.formal_execution_total}</b> заходів</span>
            <span>Звітний статус програми</span>
          </div>
        </div>

        {/* Рівень 2: Зниження корупційних ризиків */}
        <div style={{ background: 'var(--surface-2)', padding: '1rem', borderRadius: 'var(--radius)', border: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontWeight: 600, fontSize: '.92rem' }}>
              <Target size={17} style={{ color: 'var(--accent)' }} />
              2. Зниження корупційних ризиків
            </span>
            <span style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--accent)' }}>
              {twoLevel.risk_achievement_percent}%
            </span>
          </div>
          <div style={{ height: 10, borderRadius: 5, background: 'var(--line)', overflow: 'hidden', margin: '.6rem 0' }}>
            <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, twoLevel.risk_achievement_percent))}%`, background: 'var(--accent)', transition: 'width .3s' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8rem', color: 'var(--muted)' }}>
            <span>Зменшуються: <b>{twoLevel.risks_reducing_count}</b> з <b>{twoLevel.risks_total}</b> ризиків</span>
            <span>За індикаторами результативності</span>
          </div>
        </div>
      </div>

      {/* Gap аналіз */}
      <div style={{
        marginTop: '1rem',
        padding: '.75rem 1rem',
        borderRadius: 'var(--radius)',
        background: twoLevel.gap > 15 ? 'rgba(234, 88, 12, 0.08)' : 'var(--surface-2)',
        border: `1px solid ${twoLevel.gap > 15 ? 'rgba(234, 88, 12, 0.3)' : 'var(--line)'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '.6rem'
      }}>
        <div style={{ fontSize: '.84rem', lineHeight: 1.45, flex: 1, minWidth: 260 }}>
          <b>Розрив змістовної ефективності (Gap):</b>{' '}
          <span style={{ fontWeight: 700, color: twoLevel.gap > 0 ? '#ea580c' : 'var(--ok)' }}>
            {twoLevel.gap > 0 ? `+${twoLevel.gap}%` : `${twoLevel.gap}%`}
          </span>
          {' · '}
          <span className="muted">
            {twoLevel.gap > 15
              ? 'Формальне закриття заходів суттєво випереджає зниження ризиків. Зверніть увагу на якість та змістовність підтвердних документів.'
              : 'Показники формального закриття та зниження ризиків збалансовані.'}
          </span>
        </div>
        <button
          className="btn secondary small"
          style={{ fontSize: '.8rem' }}
          onClick={() => nav('/program/risks')}
        >
          Теплова карта ризиків 5×5 <ArrowUpRight size={13} style={{ marginLeft: '.25rem' }} />
        </button>
      </div>
    </div>

    <div className="stats">
      <Stat v={`${p.vykonano}%`} l="Виконано" s={`${c.vykonano} з ${m.total} заходів`} tone="ok" onClick={() => go('status=vykonano')} />
      <Stat v={`${p.ne_vykonano}%`} l="Не виконано" s={`${c.portal_not_done} (строк минув або не виконано)`} tone="bad" onClick={() => go('status=Не виконано')} />
      <Stat v={`${p.v_roboti}%`} l="На стадії виконання" s={`${c.v_roboti} у роботі`} onClick={() => go('status=v_roboti')} />
      <Stat v={`${p.postponed}%`} l="Строк перенесено" s={`${c.postponed} заходів`} tone="warn" onClick={() => go('postponed=1')} />
      <Stat v={p.on_time_of_dated_done !== null && p.on_time_of_dated_done !== undefined ? `${p.on_time_of_dated_done}%` : '—'} l="Виконано вчасно" s={`${c.done_on_time} вчасно · ${c.done_late} із запізненням`} tone="ok" />
      <Stat v={`${p.overdue}%`} l="Прострочено" s={`${c.overdue} заходів за строком програми`} tone="bad" onClick={() => go('flag=RF1')} />
      <Stat v={`${p.chastkovo}%`} l="Частково виконано" s={`${c.chastkovo} заходів`} tone="warn" onClick={() => go('status=chastkovo')} />
      <Stat v={`${p.not_due}%`} l="Строк не настав" s={`${c.not_due} заходів`} tone="grey" />
    </div>

    <div className="grid g3">
      <Card title="Розподіл за статусами">
        <div style={{ height: narrow ? 195 : 230 }}>
          <ResponsiveContainer><PieChart>
            <Pie data={pie} stroke="var(--surface)" strokeWidth={2} dataKey="value" nameKey="name" innerRadius={narrow ? 42 : 55} outerRadius={narrow ? 72 : 90} paddingAngle={1}>
              {pie.map((x, i) => <Cell key={i} fill={x.color} />)}
            </Pie><Tooltip contentStyle={CHART_TOOLTIP_STYLE} itemStyle={CHART_ITEM_STYLE} labelStyle={CHART_LABEL_STYLE} />
          </PieChart></ResponsiveContainer>
        </div>
        <StatusLegend />
      </Card>
      <Card title="Виконання за розділами">
        <div style={{ height: narrow ? 215 : 250 }}>
          <ResponsiveContainer><BarChart data={sections} layout="vertical" margin={{ left: 2, right: 6 }}>
            <XAxis type="number" allowDecimals={false} fontSize={11} stroke={C.muted} /><YAxis type="category" dataKey="name" width={narrow ? 60 : 72} fontSize={11} stroke={C.muted} /><Tooltip contentStyle={CHART_TOOLTIP_STYLE} itemStyle={CHART_ITEM_STYLE} labelStyle={CHART_LABEL_STYLE} cursor={{ fill: 'var(--surface-2)' }} />
            {Object.keys(STATUS).map(k => <RBar key={k} dataKey={STATUS[k].label} stackId="a" fill={STATUS[k].color} />)}
          </BarChart></ResponsiveContainer>
        </div>
      </Card>
      <Card title="Повнота звітування">
        <p style={{ marginBottom: '.35rem' }}>Інформацію внесено: <b>{c.entered}</b> з {m.total} ({p.entered}%)</p>
        <Bar value={p.entered} />
        <p style={{ margin: '1rem 0 .35rem' }}>Погоджено координатором: <b>{c.approved}</b> ({p.approved}%)</p>
        <Bar value={p.approved} color={C.ok} />
        <p style={{ margin: '1rem 0 .4rem' }}>Сигналів Risk Flags: <b>{data.flags.total}</b></p>
        <div>{Object.entries(data.flags.by_code).map(([k, v]) =>
          <a key={k} href="#" onClick={e => { e.preventDefault(); go(`flag=${k}`) }} title={data.flags.catalog[k]}>
            <span className="flag medium">{k}: {String(v)}</span></a>)}
          {!Object.keys(data.flags.by_code).length && <span className="muted">Сигналів немає</span>}</div>
      </Card>
    </div>

    <Card title="Стан корупційних ризиків" actions={<a className="btn secondary small" href="/program/risks" onClick={e => { e.preventDefault(); nav('/program/risks') }}>Детальніше <ArrowUpRight size={14} /></a>}>
      <p className="muted">Оцінюємо не кількість закритих заходів, а зміну індикатора стану ризику: скільки шляху пройдено від базового значення до цільового.</p>
      <div className="table-wrap"><table className="t"><thead><tr>
        <th>Ризик</th><th>Рівень</th><th>Індикатор</th><th style={{ width: 200 }}>Шлях до цілі</th><th>Заходи</th><th>Висновок</th>
      </tr></thead><tbody>
        {data.risks.map((r: Any) => <tr key={r.code}>
          <td><b>{r.code}</b> {r.name}</td>
          <td><Pill tone={RISK_TONE[r.level]}>{r.level}</Pill></td>
          <td><small>{num(r.baseline)} → <b>{num(r.current)}</b> (ціль {num(r.target)} {r.unit})</small></td>
          <td>{r.progress === null ? '—' : <><Bar value={r.progress * 100} color={progressColor(r.progress)} /><small>{Math.round(r.progress * 100)}%</small></>}</td>
          <td>{r.measures_done}/{r.measures_total}</td>
          <td><Pill tone={r.verdict === 'зменшується' ? 'ok' : r.verdict === 'повільно зменшується' ? 'warn' : 'bad'}>{r.verdict}</Pill></td>
        </tr>)}
      </tbody></table></div>
    </Card>

    {profile?.role !== 'VYK' && <Card title="Карта ризику невиконання за підрозділами">
      <p className="muted">Без рейтингування: підрозділи впорядковано за кодом. Колір — найвищий рівень ризику невиконання серед заходів підрозділу; натисніть, щоб відкрити заходи.</p>
      <div className="tiles">{data.by_unit.map((u: Any) => {
        const lvl = u.nonexecution['високий'] ? 'high' : u.nonexecution['середній'] ? 'medium' : 'low'
        return <div key={u.code} className={`tile ${lvl}`} role="button" tabIndex={0} onClick={() => go(`unit=${u.code}`)}
          onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), go(`unit=${u.code}`))}>
          <b>{u.code}</b> <span className="n">· {u.total} заход.</span>
          <div className="clamp" style={{ fontSize: '.82rem', minHeight: '2.5em', margin: '.15rem 0 .45rem', color: 'var(--ink-2)' }}>{u.name}</div>
          <StatusStack counts={u.counts} total={u.total} />
          <div className="n" style={{ marginTop: '.3rem' }}>
            ризик невиконання: {u.nonexecution['високий'] || 0} вис. · {u.nonexecution['середній'] || 0} сер. · сигналів {u.flags}
          </div>
        </div>
      })}</div>
    </Card>}

    <div className="grid g2" style={{ alignItems: 'start' }}>
      <Card title="Критичні заходи">
        <div className="table-wrap"><table className="t"><thead><tr><th>Захід</th><th>Статус</th><th>Сигнали</th><th>Ризик невик.</th></tr></thead><tbody>
          {data.critical.map((b: Any) => <tr key={b.code} className="click" onClick={() => nav(`/program/measures/${b.code}`)}>
            <td><b>{b.code}</b> <small className="muted">{b.unit.code}</small><div className="clamp"><small>{b.content}</small></div></td>
            <td><StatusPill s={b.status} /></td><td><Flags flags={b.flags} /></td>
            <td><Pill tone={RISK_TONE[b.nonexecution_risk.level]}>{b.nonexecution_risk.level} ({b.nonexecution_risk.score})</Pill></td>
          </tr>)}
          {!data.critical.length && <tr><td colSpan={4}><Empty>Критичних заходів немає</Empty></td></tr>}
        </tbody></table></div>
      </Card>
      <Card title="Найближчі контрольні строки · 120 днів">
        <div className="table-wrap"><table className="t"><thead><tr><th>Строк</th><th>Захід</th><th>Статус</th></tr></thead><tbody>
          {data.upcoming.map((b: Any) => <tr key={b.code} className="click" onClick={() => nav(`/program/measures/${b.code}`)}>
            <td>{fmtDate(b.current_deadline)}{b.postponed ? <><br /><Pill tone="warn">перенесено ×{b.postponed}</Pill></> : null}</td>
            <td><b>{b.code}</b> <small className="muted">{b.unit.code}</small><div className="clamp"><small>{b.content}</small></div></td>
            <td><StatusPill s={b.status} /></td>
          </tr>)}
          {!data.upcoming.length && <tr><td colSpan={3}><Empty>У найближчі 120 днів строків немає</Empty></td></tr>}
        </tbody></table></div>
      </Card>
    </div>
  </>
}

export { Legend }
