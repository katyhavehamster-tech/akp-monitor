import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, download, fmtDate, fmtDateTime, num, safeUrl, type Any } from '../api'
import { useAuth } from '../auth'
import { APPROVAL_TONE, C, Card, CHART_ITEM_STYLE, CHART_LABEL_STYLE, CHART_TOOLTIP_STYLE, ErrorBox, FilePicker, Loading, Pill, PORTAL_TONE, RISK_TONE, STATUS, StatusPill, useApi } from '../components/ui'

export default function MeasureDetail() {
  const { code } = useParams()
  const { period, profile } = useAuth()
  const { data: m, error, reload } = useApi<Any>(period ? `measures/${code}?period=${period}` : null, [period, code])
  if (error) return <ErrorBox msg={error} />
  if (!m) return <Loading />
  const isKoord = profile?.role === 'KOORD'
  const back = profile?.role === 'VYK' ? '/my' : '/program/measures'

  return <>
    <p><Link to={back}>← до переліку заходів</Link></p>
    <Card>
      <div className="row"><h1 style={{ margin: 0 }}>{m.code}</h1>
        <StatusPill s={m.status} /><Pill tone={PORTAL_TONE[m.portal_state]}>Портал: {m.portal_state}</Pill>
        {m.execution && <Pill tone={APPROVAL_TONE[m.execution.approval]}>{m.execution.approval_name}</Pill>}
        <Pill tone={RISK_TONE[m.nonexecution_risk.level]}>ризик невиконання: {m.nonexecution_risk.level}</Pill>
      </div>
      <p style={{ fontSize: '1.05rem', marginTop: '.6rem' }}>{m.content}</p>
      <dl className="kv">
        <dt>Розділ</dt><dd>{m.section_name}</dd>
        <dt>Відповідальний підрозділ</dt><dd>{m.unit.code} {m.unit.name}{m.co_units.length ? <small className="muted"> · співвиконавці: {m.co_units.join(', ')}</small> : null}</dd>
        <dt>Строк за програмою</dt><dd>{m.strok_text}{m.strok_date && <> (до {fmtDate(m.strok_date)})</>}{m.postponed > 0 && <> · <Pill tone="warn">внутрішній строк перенесено ×{m.postponed} → {fmtDate(m.current_deadline)}</Pill></>}</dd>
        <dt>Індикатор виконання</dt><dd>{m.indicator}{m.indicator_target !== null && <> · ціль <b>{num(m.indicator_target)} {m.indicator_unit}</b></>}</dd>
        <dt>Потрібні підтвердження</dt><dd>{m.required_evidence || '—'}</dd>
      </dl>
    </Card>

    {m.flags.length > 0 && <Card title={`Сигнали (${m.flags.length})`}>
      {m.flags.map((f: Any, i: number) => <div key={i} className={`alert ${f.severity === 'high' ? 'danger' : 'warning'}`}>
        <b>{f.code} · {f.title}.</b> {f.explanation}<br /><small>Правило: {f.rule}</small></div>)}
    </Card>}
    {m.nonexecution_risk.reasons.length > 0 && <Card title={`Ризик невиконання: ${m.nonexecution_risk.level} (${m.nonexecution_risk.score} б.)`}>
      <p className="muted">Розраховано за явними правилами, без моделі ШІ:</p>
      <ul>{m.nonexecution_risk.reasons.map((r: Any, i: number) => <li key={i}>+{r.points} — {r.text}</li>)}</ul>
    </Card>}

    <div className="grid g2" style={{ alignItems: 'start' }}>
      <div>
        <ExecutionForm m={m} period={period} onSaved={reload} />
        {isKoord && m.execution && <ApprovalPanel m={m} period={period} onDone={reload} />}
        {isKoord && m.strok_type === 'data' && <DeadlinePanel m={m} onDone={reload} />}
      </div>
      <div>
        <EvidencePanel m={m} period={period} onDone={reload} />
        {m.risk_detail && <RiskPanel r={m.risk_detail} />}
        <CommentsPanel m={m} period={period} onDone={reload} canComment={profile?.role === 'KOORD' || profile?.role === 'VYK'} />
      </div>
    </div>

    <div className="grid g2" style={{ alignItems: 'start' }}>
      <Card title="Історія за періодами">
        <div className="table-wrap"><table className="t"><thead><tr><th>Період</th><th>Статус</th><th>Внесено</th><th>Погодження</th></tr></thead><tbody>
          {m.history[0].executions.map((e: Any) => <tr key={e.period}>
            <td>{e.period}</td><td><StatusPill s={e.status} /></td>
            <td><small>{e.entered_by || '—'}<br />{fmtDateTime(e.entered_at)}</small></td>
            <td><Pill tone={APPROVAL_TONE[e.approval]}>{e.approval_name}</Pill></td></tr>)}
        </tbody></table></div>
      </Card>
      <Card title="Журнал дій щодо заходу">
        <ul className="timeline">{m.audit.map((a: Any) => <li key={a.id}>
          <b>{fmtDateTime(a.ts)}</b> · {a.actor} <small className="muted">({a.actor_role})</small><br />
          {a.action}{a.field && <> — <code>{a.field}</code>: {a.old && <><s>{a.old.slice(0, 80)}</s> → </>}{a.new.slice(0, 120)}</>}
          <div className="hash">#{a.hash.slice(0, 16)}…</div>
        </li>)}</ul>
      </Card>
    </div>
  </>
}

function ExecutionForm({ m, period, onSaved }: { m: Any; period: string; onSaved: () => void }) {
  const e = m.execution || {}
  const [f, setF] = useState<Any>({})
  const [res, setRes] = useState<Any>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    setF({ status: e.status || 'ne_rozpochato', fact_date: e.fact_date || '', indicator_fact: e.indicator_fact ?? '', result_text: e.result_text || '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.code, period, e.entered_at])
  const allowed = m.can_edit_execution.allowed
  const set = (k: string) => (ev: Any) => setF({ ...f, [k]: ev.target.value })
  const save = async (submit: boolean) => {
    setErr(''); setRes(null)
    try { const r = await api(`measures/${m.code}/execution`, { body: { ...f, period, submit } }); setRes(r); onSaved() }
    catch (x) { setErr((x as Error).message) }
  }
  return <Card title={`Інформація про виконання · ${period}`}>
    <div className={`alert ${allowed ? 'info' : 'warning'}`}>{allowed ? 'Внесення дозволено' : 'Внесення недоступне'}: {m.can_edit_execution.reason}.</div>
    {allowed && <div className="hint">Внесіть один раз — ці дані автоматично потраплять у моніторинг, панелі, внутрішній звіт і звіт для Порталу НАЗК.
      {m.required_evidence && <> Додайте підтвердження: <b>{m.required_evidence}</b>.</>}</div>}
    {!allowed ? <dl className="kv">
      <dt>Статус</dt><dd>{STATUS[e.status || 'ne_rozpochato']?.label}</dd>
      {m.strok_type === 'data' && <><dt>Фактична дата виконання</dt><dd>{fmtDate(e.fact_date)}</dd></>}
      <dt>Факт індикатора</dt><dd>{num(e.indicator_fact)} {m.indicator_unit}{m.indicator_target !== null && <small className="muted"> (ціль {num(m.indicator_target)})</small>}</dd>
      <dt>Опис результату</dt><dd>{e.result_text || <span className="muted">не заповнено</span>}</dd>
      <dt>Внесено</dt><dd>{e.entered_by ? `${e.entered_by}, ${fmtDateTime(e.entered_at)}` : '—'}</dd>
    </dl> : <>
      <div className="grid g3">
        <label className="f">Статус<select value={f.status} onChange={set('status')}>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        {m.strok_type === 'data' && <label className="f">Фактична дата виконання<input type="date" value={f.fact_date || ''} onChange={set('fact_date')} /></label>}
        <label className="f">Факт індикатора{m.indicator_unit && ` (${m.indicator_unit})`}<input type="number" value={f.indicator_fact} onChange={set('indicator_fact')} placeholder={m.indicator_target !== null ? `ціль ${num(m.indicator_target)}` : ''} /></label>
      </div>
      <label className="f">Опис результату виконання або пояснення причин невиконання
        <textarea value={f.result_text} onChange={set('result_text')} placeholder="Вимірюваний результат за індикатором, реквізити документа або посилання. Не повторюйте зміст заходу." /></label>
      {err && <div className="alert danger">{err}</div>}
      <div className="row form-actions">
        <button type="button" className="btn" onClick={() => save(true)}>Зберегти і подати на погодження</button>
        <button type="button" className="btn secondary" onClick={() => save(false)}>Зберегти чернетку</button>
      </div>
    </>}
    {res && <div style={{ marginTop: '.8rem' }}>
      <div className="alert success">Збережено.</div>
      {res.hints.map((h: string, i: number) => <div key={i} className="alert warning">{h}</div>)}
      {res.precheck.length > 0 ? <div className="alert danger"><b>Попередня перевірка:</b> координатор побачить сигнали
        {' '}{res.precheck.map((f: Any) => `${f.code} (${f.title})`).join(', ')}. Виправте до погодження, якщо це помилка.</div>
        : <div className="alert success">Попередня перевірка: сигналів немає.</div>}
    </div>}
  </Card>
}

function ApprovalPanel({ m, period, onDone }: { m: Any; period: string; onDone: () => void }) {
  const [comment, setComment] = useState('')
  const [err, setErr] = useState('')
  const act = async (decision: string) => {
    setErr('')
    try { await api(`measures/${m.code}/approve`, { body: { period, decision, comment } }); setComment(''); onDone() }
    catch (x) { setErr((x as Error).message) }
  }
  return <Card title="Погодження координатором">
    <p>Поточний стан: <Pill tone={APPROVAL_TONE[m.execution.approval]}>{m.execution.approval_name}</Pill>
      {m.execution.approved_by && <small className="muted"> · {m.execution.approved_by}, {fmtDateTime(m.execution.approved_at)}</small>}</p>
    {m.flags.length > 0 && <div className="hint">Перед погодженням перегляньте сигналів: {m.flags.length}.</div>}
    <label className="f">Зауваження для виконавця<textarea value={comment} onChange={e => setComment(e.target.value)} style={{ minHeight: 70 }} /></label>
    {err && <div className="alert danger">{err}</div>}
    <div className="row form-actions"><button type="button" className="btn" onClick={() => act('approve')}>Погодити</button>
      <button type="button" className="btn danger" onClick={() => act('return')}>Повернути на доопрацювання</button></div>
  </Card>
}

function DeadlinePanel({ m, onDone }: { m: Any; onDone: () => void }) {
  const [f, setF] = useState<Any>({})
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(false)
  const save = async () => {
    setErr('')
    try { await api(`measures/${m.code}/deadline`, { body: f }); setOpen(false); onDone() } catch (x) { setErr((x as Error).message) }
  }
  return <Card title="Внутрішній строк" actions={!open && <button className="btn secondary small" onClick={() => setOpen(true)}>Перенести строк</button>}>
    <p className="muted">Строк у затвердженій програмі не змінюється; перенесення фіксується як внутрішнє рішення і впливає на сигнал RF6.</p>
    {m.deadline_changes.map((d: Any, i: number) => <div key={i}><small>{fmtDate(d.decision_date)}: {fmtDate(d.old_date)} → <b>{fmtDate(d.new_date)}</b> — {d.reason} ({d.approved_by})</small></div>)}
    {open && <div style={{ marginTop: '.6rem' }}>
      <div className="grid g2"><label className="f">Новий строк<input type="date" onChange={e => setF({ ...f, new_date: e.target.value })} /></label>
        <label className="f">Причина<input onChange={e => setF({ ...f, reason: e.target.value })} /></label></div>
      {err && <div className="alert danger">{err}</div>}
      <button className="btn" onClick={save}>Зафіксувати рішення</button>
    </div>}
  </Card>
}

function EvidencePanel({ m, period, onDone }: { m: Any; period: string; onDone: () => void }) {
  const [f, setF] = useState<Any>({ type: 'наказ' })
  const [file, setFile] = useState<File | null>(null)
  const [err, setErr] = useState('')
  const allowed = m.can_edit_execution.allowed
  const save = async () => {
    setErr('')
    const fd = new FormData()
    Object.entries({ ...f, period }).forEach(([k, v]) => fd.append(k, String(v ?? '')))
    if (file) fd.append('file', file)
    try { await api(`measures/${m.code}/evidence`, { form: fd, method: 'POST' }); setF({ type: 'наказ' }); setFile(null); onDone() }
    catch (x) { setErr((x as Error).message) }
  }
  return <Card title={`Підтвердні матеріали (${m.evidence.length})`}>
    <p className="muted">Матеріали незмінні: після завантаження їх не можна змінити чи видалити. Цілісність фіксує контрольна сума SHA-256.</p>
    {m.evidence.map((e: Any) => {
      const safeLink = safeUrl(e.link)
      return <div key={e.code} style={{ borderBottom: '1px solid var(--line)', padding: '.45rem 0' }}>
        <b>{e.code}</b> · {e.type} · {fmtDate(e.doc_date)} — {e.file
          ? <button type="button" className="link-btn" onClick={() => download(e.file, e.filename || `${e.code}`)}>{e.title}</button>
          : e.title}
        {safeLink && <> · <a href={safeLink} target="_blank" rel="noopener noreferrer">посилання</a></>}
        <div className="hash">SHA-256 {e.sha256} · завантажив {e.uploaded_by} {fmtDateTime(e.uploaded_at)}</div>
      </div>
    })}
    {!m.evidence.length && <div className="alert warning">Підтвердних матеріалів немає.</div>}
    {allowed && <div style={{ marginTop: '.7rem' }}>
      <div className="grid g3">
        <label className="f">Тип<select value={f.type} onChange={e => setF({ ...f, type: e.target.value })}>
          {['наказ', 'протокол', 'акт', 'звіт', 'реєстр', 'журнал', 'лист', 'посилання'].map(t => <option key={t}>{t}</option>)}</select></label>
        <label className="f">Дата документа<input type="date" value={f.doc_date || ''} onChange={e => setF({ ...f, doc_date: e.target.value })} /></label>
        <div className="f">Файл<FilePicker file={file} accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.odt,.ods,.png,.jpg,.jpeg,.webp,.zip,.p7s,.sig" onChange={setFile} /></div>
      </div>
      <label className="f">Назва / реквізити<input value={f.title || ''} onChange={e => setF({ ...f, title: e.target.value })} placeholder="Наказ від 12.05.2026 № 45 (умовний)" /></label>
      <label className="f">Посилання на відкрите джерело (https://…)<input type="url" value={f.link || ''} onChange={e => setF({ ...f, link: e.target.value })} placeholder="https://..." /></label>
      {err && <div className="alert danger">{err}</div>}
      <button className="btn secondary" onClick={save}>Додати підтвердження</button>
    </div>}
  </Card>
}

function RiskPanel({ r }: { r: Any }) {
  const data = r.history.map((h: Any) => ({ date: fmtDate(h.date), value: h.value }))
  return <Card title={`Корупційний ризик ${r.code}`}>
    <p><b>{r.name}</b> · <Pill tone={RISK_TONE[r.level]}>{r.level}</Pill></p>
    <p className="muted">{r.indicator}: базове {num(r.baseline)}, зараз <b>{num(r.current)}</b>, ціль {num(r.target)} {r.unit}
      {r.progress !== null && <> — пройдено <b>{Math.round(r.progress * 100)}%</b> шляху</>}.</p>
    <div style={{ height: 170 }}><ResponsiveContainer><LineChart data={data}>
      <CartesianGrid stroke={C.grid} /><XAxis dataKey="date" fontSize={11} stroke={C.muted} /><YAxis fontSize={11} stroke={C.muted} domain={['auto', 'auto']} />
      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} itemStyle={CHART_ITEM_STYLE} labelStyle={CHART_LABEL_STYLE} />
      <ReferenceLine y={r.target} stroke={C.ok} strokeDasharray="4 4" label={{ value: 'ціль', fontSize: 11, fill: C.ok }} />
      <Line dataKey="value" stroke="#3b4fd8" strokeWidth={2} />
    </LineChart></ResponsiveContainer></div>
  </Card>
}

function CommentsPanel({ m, period, onDone, canComment }: { m: Any; period: string; onDone: () => void; canComment: boolean }) {
  const [t, setT] = useState('')
  const add = async () => { if (!t.trim()) return; await api(`measures/${m.code}/comments`, { body: { text: t, period } }); setT(''); onDone() }
  return <Card title="Коментарі та зауваження координатора">
    {m.comments.map((c: Any) => <div key={c.id} className={`alert ${c.is_remark ? 'warning' : 'info'}`}>
      <small><b>{c.author}</b> ({c.author_role}) · {fmtDateTime(c.created_at)}{c.is_remark && ' · зауваження'}</small><br />{c.text}</div>)}
    {!m.comments.length && <p className="muted">Коментарів немає.</p>}
    {canComment && <div className="row comment-bar"><input style={{ flex: '1 1 160px' }} value={t} onChange={e => setT(e.target.value)} placeholder="Коментар…" onKeyDown={e => e.key === 'Enter' && add()} />
      <button type="button" className="btn secondary" onClick={add}>Додати</button></div>}
  </Card>
}
