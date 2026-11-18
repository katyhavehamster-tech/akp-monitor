import { Link } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtDate, num, type Any } from '../api'
import { useAuth } from '../auth'
import { Bar, C, Card, CHART_ITEM_STYLE, CHART_LABEL_STYLE, CHART_TOOLTIP_STYLE, ErrorBox, Loading, Pill, progressColor, RISK_TONE, useApi } from '../components/ui'

export default function Risks() {
  const { period } = useAuth()
  const { data, error } = useApi<Any[]>(period ? `risks?period=${period}` : null, [period])
  if (error) return <ErrorBox msg={error} />
  if (!data) return <Loading />
  return <>
    <h1>Корупційні ризики і їх зміна</h1>
    <p className="muted">Реєстр ризиків за Методологією НАЗК № 830/21: бал = імовірність × наслідки. Для кожного ризику — індикатор стану,
      за яким видно, чи ризик зменшується. Саме він, а не кількість закритих заходів, показує результат програми.</p>
    <div className="grid g2">{data.map(r => <Card key={r.code} title={<>{r.code} · {r.name}</>}>
      <div className="row"><Pill tone={RISK_TONE[r.level]}>{r.level} ({r.score} б.)</Pill><small className="muted">{r.process}</small>
        <span className="spacer" /><Pill tone={r.verdict === 'зменшується' ? 'ok' : r.verdict === 'повільно зменшується' ? 'warn' : 'bad'}>{r.verdict}</Pill></div>
      <p style={{ marginTop: '.5rem' }}>{r.indicator} ({r.direction === 'менше' ? 'має зменшуватися' : 'має зростати'})</p>
      <div className="row"><small>Базове {num(r.baseline)} → зараз <b>{num(r.current)}</b> → ціль {num(r.target)} {r.unit}</small><span className="spacer" />
        <small>{r.progress === null ? '—' : `${Math.round(r.progress * 100)}% шляху`}</small></div>
      {r.progress !== null && <Bar value={r.progress * 100} color={progressColor(r.progress)} />}
      <div style={{ height: 140, marginTop: '.5rem' }}><ResponsiveContainer><LineChart data={r.history.map((h: Any) => ({ ...h, date: fmtDate(h.date) }))}>
        <CartesianGrid stroke={C.grid} /><XAxis dataKey="date" fontSize={11} stroke={C.muted} /><YAxis fontSize={11} stroke={C.muted} domain={['auto', 'auto']} />
        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} itemStyle={CHART_ITEM_STYLE} labelStyle={CHART_LABEL_STYLE} />
        <ReferenceLine y={r.target} stroke={C.ok} strokeDasharray="4 4" /><Line dataKey="value" stroke="#3b4fd8" strokeWidth={2} />
      </LineChart></ResponsiveContainer></div>
      <small>Заходи: {r.measures.length ? r.measures.map((c: string) => <Link key={c} to={`/program/measures/${c}`} style={{ marginRight: '.4rem' }}>{c}</Link>) : <b style={{ color: 'var(--bad)' }}>немає жодного заходу</b>}
        {' '}· виконано {r.measures_done}/{r.measures_total} · власник {r.owner_unit}</small>
    </Card>)}</div>
  </>
}
