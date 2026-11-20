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
  const sections = data.by_section.map((s: Any) => {
    const num = s.code.replace(/\D/g, '') || s.code.slice(1)
    const fullName = `Розділ ${num} (${s.name})`
    return {
      code: s.code,
      name: `Розділ ${num}`,
      fullName,
      total: s.total,
      done: s.counts?.vykonano || 0,
      percentDone: s.percent?.vykonano || 0,
      ...Object.fromEntries(Object.keys(STATUS).map(k => [STATUS[k].label, s.counts[k] || 0])),
    }
  })
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
                Показати ще {Math.min(10, data.reminders.length - remLimit)} (показано {remLimit} із {data.reminders.length})
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
    <div className="card two-level-progress-card">
      <div className="two-level-card-header">
        <div className="two-level-card-title-group">
          <Layers size={20} className="two-level-icon" />
          <div style={{ minWidth: 0 }}>
            <h2 className="two-level-title">
              Дворівневий прогрес: Формальне закриття vs Зниження ризиків
            </h2>
            <div className="muted two-level-subtitle">
              Порівняльний аналіз звітних статусів та фактичного впливу на корупційні фактори за Методологією НАЗК № 830/21
            </div>
          </div>
        </div>
        <div className="pill info two-level-rules-badge">
          Рушій правил: {rulesVer}
        </div>
      </div>

      <div className="two-level-grid">
        {/* Рівень 1: Формальне виконання */}
        <div className="two-level-box">
          <div className="two-level-metric-head">
            <span className="two-level-metric-label">
              <CheckCircle2 size={17} style={{ color: 'var(--ok)', flexShrink: 0 }} />
              <span>1. Виконання заходів (формальне)</span>
            </span>
            <span className="two-level-metric-percent ok">
              {twoLevel.formal_execution_percent}%
            </span>
          </div>
          <div className="two-level-bar-track">
            <div
              className="two-level-bar-fill ok"
              style={{ width: `${Math.min(100, Math.max(0, twoLevel.formal_execution_percent))}%` }}
            />
          </div>
          <div className="two-level-metric-sub">
            <span>Закрито: <b>{twoLevel.formal_execution_done}</b> з <b>{twoLevel.formal_execution_total}</b> заходів</span>
            <span className="two-level-status-tag">Звітний статус програми</span>
          </div>
        </div>

        {/* Рівень 2: Зниження корупційних ризиків */}
        <div className="two-level-box">
          <div className="two-level-metric-head">
            <span className="two-level-metric-label">
              <Target size={17} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span>2. Зниження корупційних ризиків</span>
            </span>
            <span className="two-level-metric-percent accent">
              {twoLevel.risk_achievement_percent}%
            </span>
          </div>
          <div className="two-level-bar-track">
            <div
              className="two-level-bar-fill accent"
              style={{ width: `${Math.min(100, Math.max(0, twoLevel.risk_achievement_percent))}%` }}
            />
          </div>
          <div className="two-level-metric-sub">
            <span>Зменшуються: <b>{twoLevel.risks_reducing_count}</b> з <b>{twoLevel.risks_total}</b> ризиків</span>
            <span className="two-level-status-tag">За індикаторами результативності</span>
          </div>
        </div>
      </div>

      {/* Gap аналіз */}
      <div className={`two-level-gap-box ${twoLevel.gap > 15 ? 'warning' : ''}`}>
        <div className="two-level-gap-text">
          <b>Розрив змістовної ефективності (Gap):</b>{' '}
          <span className={`two-level-gap-val ${twoLevel.gap > 0 ? 'gap-warn' : 'gap-ok'}`}>
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
          className="btn secondary small two-level-gap-btn"
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
        <div style={{ height: narrow ? 180 : 200 }}>
          <ResponsiveContainer>
            <BarChart data={sections} layout="vertical" margin={{ left: 2, right: 6, top: 4, bottom: 4 }}>
              <XAxis type="number" allowDecimals={false} fontSize={11} stroke={C.muted} />
              <YAxis type="category" dataKey="name" width={narrow ? 60 : 72} fontSize={11} stroke={C.muted} />
              <Tooltip
                contentStyle={{
                  ...CHART_TOOLTIP_STYLE,
                  maxWidth: 320,
                  whiteSpace: 'normal',
                  wordBreak: 'break-word',
                  lineHeight: 1.35,
                }}
                itemStyle={CHART_ITEM_STYLE}
                labelStyle={{
                  ...CHART_LABEL_STYLE,
                  fontWeight: 700,
                  marginBottom: 6,
                  lineHeight: 1.3,
                }}
                labelFormatter={(_label, payload) => {
                  const item = payload?.[0]?.payload
                  return item?.fullName || _label
                }}
                cursor={{ fill: 'var(--surface-2)', opacity: 0.5 }}
              />
              {Object.keys(STATUS).map(k => <RBar key={k} dataKey={STATUS[k].label} stackId="a" fill={STATUS[k].color} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="public-portal-sections-progress" style={{ marginTop: '.85rem' }}>
          {sections.map((sec: Any) => (
            <div
              key={sec.code}
              className="public-portal-sec-prog-item"
              onClick={() => go(`section=${sec.code}`)}
              title={`Фільтрувати за розділом: ${sec.fullName}`}
              style={{ cursor: 'pointer' }}
            >
              <div className="public-portal-sec-prog-head">
                <span className="public-portal-sec-prog-name">{sec.fullName}</span>
                <span className="public-portal-sec-prog-val">
                  <b>{sec.done}</b>/{sec.total} ({sec.percentDone}%)
                </span>
              </div>
              <div className="public-portal-sec-prog-bar-bg">
                <div
                  className="public-portal-sec-prog-bar-fill"
                  style={{
                    width: `${sec.percentDone}%`,
                    backgroundColor: sec.percentDone >= 80 ? '#16a34a' : sec.percentDone >= 40 ? '#2563eb' : '#eab308',
                  }}
                />
              </div>
            </div>
          ))}
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
