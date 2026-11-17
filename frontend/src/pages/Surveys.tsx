import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, fmtDateTime, type Any } from '../api'
import { Card, ErrorBox, Loading, Pill, useApi } from '../components/ui'

const CA = '#9aa6bd', CB = '#123a78'

export default function Surveys() {
  const list = useApi<Any[]>('surveys')
  const [delId, setDelId] = useState<number | null>(null)
  const [a, setA] = useState<number | null>(null)
  const [b, setB] = useState<number | null>(null)
  const [filter, setFilter] = useState({ fq: '', fv: '' })
  useEffect(() => {
    if (list.data && list.data.length >= 2 && a === null) { setA(list.data[list.data.length - 2].id); setB(list.data[list.data.length - 1].id) }
  }, [list.data, a])
  const qs = a && b ? `surveys/compare?a=${a}&b=${b}${filter.fq && filter.fv ? `&fq=${encodeURIComponent(filter.fq)}&fv=${encodeURIComponent(filter.fv)}` : ''}` : null
  const cmp = useApi<Any>(qs, [qs])
  if (list.error) return <ErrorBox msg={list.error} />
  if (!list.data) return <Loading />

  return <>
    <h1>Опитування</h1>
    <div className="hint">Порівняння результатів двох Google Форм. Форми не збирають електронні адреси; якщо в експорті трапиться колонка з поштою
      або позначкою часу, система відкидає її під час імпорту і не зберігає. Розділ доступний лише уповноваженому.</div>
    <div className="grid g2" style={{ alignItems: 'start' }}>
      <Card title="Завантажені опитування">
        <table className="t"><thead><tr><th>Назва</th><th>Відповідей</th><th>Питань</th><th>Завантажено</th><th></th></tr></thead><tbody>
          {list.data.map(s => <tr key={s.id}>
            <td>{s.title}{s.dropped_columns.length > 0 && <><br /><small className="muted">відкинуто: {s.dropped_columns.join(', ')}</small></>}</td>
            <td>{s.n}</td><td>{s.questions}</td><td><small>{fmtDateTime(s.uploaded_at)}</small></td>
            <td>{delId === s.id
              ? <span className="row"><button className="btn danger small" onClick={async () => { await api(`surveys/${s.id}`, { method: 'DELETE' }); setDelId(null); list.reload() }}>Так, видалити</button>
                <button className="btn secondary small" onClick={() => setDelId(null)}>Ні</button></span>
              : <button className="btn danger small" title="Видалити результати опитування" onClick={() => setDelId(s.id)}>Видалити</button>}</td>
          </tr>)}
        </tbody></table>
      </Card>
      <Upload onDone={list.reload} />
    </div>

    <Card title="Порівняння">
      <div className="grid g4" style={{ alignItems: 'end' }}>
        <label className="f">Форма А (база)<select value={a ?? ''} onChange={e => setA(+e.target.value)}>{list.data.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
        <label className="f">Форма Б (порівняння)<select value={b ?? ''} onChange={e => setB(+e.target.value)}>{list.data.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
        {cmp.data?.filters?.length > 0 && <>
          <label className="f">Фільтр за питанням<select value={filter.fq} onChange={e => setFilter({ fq: e.target.value, fv: '' })}>
            <option value="">усі респонденти</option>{cmp.data.filters.map((f: Any) => <option key={f.question} value={f.question}>{f.question}</option>)}</select></label>
          {filter.fq && <label className="f">Значення<select value={filter.fv} onChange={e => setFilter({ ...filter, fv: e.target.value })}>
            <option value="">—</option>{cmp.data.filters.find((f: Any) => f.question === filter.fq)?.values.map((v: string) => <option key={v}>{v}</option>)}</select></label>}
        </>}
      </div>
    </Card>
    {cmp.error && <ErrorBox msg={cmp.error} />}
    {cmp.data && <Comparison c={cmp.data} />}
  </>
}

function Upload({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [msg, setMsg] = useState<Any>(null)
  const send = async () => {
    if (!file) return
    const fd = new FormData(); fd.append('file', file); fd.append('title', title || file.name)
    try { const r = await api('surveys', { form: fd, method: 'POST' }); setMsg({ ok: true, ...r }); setTitle(''); setFile(null); onDone() }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }) }
  }
  return <Card title="Завантажити результати Google Форми">
    <ol style={{ paddingLeft: '1.2rem', marginTop: 0 }}><small>
      <li>У Google Формі: «Відповіді» → «⋮» → «Завантажити відповіді (.csv)».</li>
      <li>Розпакуйте архів і завантажте CSV сюди.</li>
      <li>Для порівняння питання в обох формах мають бути сформульовані однаково.</li></small></ol>
    <label className="f">Назва<input value={title} onChange={e => setTitle(e.target.value)} placeholder="Опитування, хвиля 3 (вересень 2026)" /></label>
    <label className="f">CSV-файл<input type="file" accept=".csv,text/csv" onChange={e => setFile(e.target.files?.[0] || null)} /></label>
    <button className="btn" disabled={!file} onClick={send}>Завантажити</button>
    {msg && <div className={`alert ${msg.ok ? 'success' : 'danger'}`} style={{ marginTop: '.6rem' }}>
      {msg.ok ? <>Імпортовано відповідей: {msg.n}.{msg.dropped_columns.length > 0 && <> Відкинуто колонки: {msg.dropped_columns.join(', ')}.</>}</> : msg.text}</div>}
  </Card>
}

function Comparison({ c }: { c: Any }) {
  if (c.hidden) return <div className="alert warning">Відповідей замало для показу (А: {c.n_a}, Б: {c.n_b}; мінімум {c.min_group}). Так захищається анонімність малих груп.</div>
  const scale = c.questions.filter((q: Any) => q.kind === 'scale')
  const choice = c.questions.filter((q: Any) => q.kind === 'choice')
  const text = c.questions.filter((q: Any) => q.kind === 'text')
  const shifts = choice.flatMap((q: Any) => q.options.map((o: Any) => ({ q: q.question, ...o })))
    .sort((x: Any, y: Any) => Math.abs(y.delta_pp) - Math.abs(x.delta_pp)).slice(0, 5)
  return <>
    <div className="stats">
      <div className="stat"><div className="v">{c.n_a}</div><div className="l">відповідей · {c.a.title}</div></div>
      <div className="stat"><div className="v">{c.n_b}</div><div className="l">відповідей · {c.b.title}</div></div>
      {scale.map((q: Any) => <div key={q.question} className={`stat ${q.delta > 0 ? 'ok' : q.delta < 0 ? 'bad' : ''}`}>
        <div className="v">{q.mean_a} → {q.mean_b} <small style={{ fontSize: '.9rem' }}>({q.delta > 0 ? '+' : ''}{q.delta})</small></div>
        <div className="l clamp">{q.question}</div></div>)}
    </div>
    {shifts.length > 0 && <Card title="Найбільші зміни">
      <table className="t"><tbody>{shifts.map((s: Any, i: number) => <tr key={i}>
        <td>{s.q}</td><td><b>{s.option}</b></td><td>{s.a.pct}% → {s.b.pct}%</td>
        <td><Pill tone={s.delta_pp > 0 ? 'info' : 'gold'}>{s.delta_pp > 0 ? '+' : ''}{s.delta_pp} п.п.</Pill></td></tr>)}</tbody></table>
    </Card>}
    <div className="grid g2">{[...scale, ...choice].map((q: Any) => <Card key={q.question} title={<span style={{ fontSize: '1rem' }}>{q.question}</span>}>
      <div style={{ height: Math.max(170, q.options.length * 38) }}><ResponsiveContainer>
        <BarChart data={q.options.map((o: Any) => ({ name: o.option, 'А, %': o.a.pct, 'Б, %': o.b.pct }))} layout="vertical" margin={{ left: 10, right: 10 }}>
          <CartesianGrid stroke="#eef0f4" /><XAxis type="number" unit="%" fontSize={11} /><YAxis type="category" dataKey="name" width={150} fontSize={11} />
          <Tooltip /><Legend /><Bar dataKey="А, %" fill={CA} /><Bar dataKey="Б, %" fill={CB} />
        </BarChart></ResponsiveContainer></div>
      <table className="t"><thead><tr><th>Варіант</th><th>А</th><th>Б</th><th>Δ</th></tr></thead><tbody>
        {q.options.map((o: Any) => <tr key={o.option}><td>{o.option}</td><td>{o.a.pct}% <small className="muted">({o.a.n})</small></td>
          <td>{o.b.pct}% <small className="muted">({o.b.n})</small></td><td>{o.delta_pp > 0 ? '+' : ''}{o.delta_pp} п.п.</td></tr>)}
      </tbody></table>
    </Card>)}</div>
    {text.map((q: Any) => <Card key={q.question} title={q.question}>
      <div className="grid g2"><div><b>А ({q.answers_a.length})</b><ul>{q.answers_a.slice(0, 30).map((t: string, i: number) => <li key={i}><small>{t}</small></li>)}</ul></div>
        <div><b>Б ({q.answers_b.length})</b><ul>{q.answers_b.slice(0, 30).map((t: string, i: number) => <li key={i}><small>{t}</small></li>)}</ul></div></div>
    </Card>)}
    {(c.only_a.length > 0 || c.only_b.length > 0) && <Card title="Питання, які є лише в одній формі">
      {c.only_a.length > 0 && <p><b>Лише в А:</b> {c.only_a.join('; ')}</p>}
      {c.only_b.length > 0 && <p><b>Лише в Б:</b> {c.only_b.join('; ')}</p>}
    </Card>}
  </>
}
