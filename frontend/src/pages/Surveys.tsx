import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import html2canvas from 'html2canvas'
import { api, download, fmtDateTime, type Any } from '../api'
import { useAuth } from '../auth'
import { C, Card, CHART_ITEM_STYLE, CHART_LABEL_STYLE, CHART_TOOLTIP_STYLE, ErrorBox, FilePicker, Loading, Pill, Stat, useApi, useIsMobile } from '../components/ui'
import { Camera, ChevronDown, ChevronUp, FileSpreadsheet, FileText, Filter, Printer, Star } from 'lucide-react'

const CA = '#94a3b8', CB = 'var(--accent)'

export default function Surveys() {
  const { profile } = useAuth()
  const list = useApi<Any[]>('surveys')
  const [delId, setDelId] = useState<number | null>(null)
  const [a, setA] = useState<number | null>(null)
  const [b, setB] = useState<number | null>(null)
  const [filter, setFilter] = useState({ fq: '', fv: '' })

  const isKoord = profile?.role === 'KOORD'

  useEffect(() => {
    if (list.data && list.data.length >= 2 && a === null) {
      setA(list.data[list.data.length - 2].id)
      setB(list.data[list.data.length - 1].id)
    } else if (list.data && list.data.length === 1 && a === null) {
      setA(list.data[0].id)
      setB(list.data[0].id)
    }
  }, [list.data, a])

  const qs = a && b ? `surveys/compare?a=${a}&b=${b}${filter.fq && filter.fv ? `&fq=${encodeURIComponent(filter.fq)}&fv=${encodeURIComponent(filter.fv)}` : ''}` : null
  const cmp = useApi<Any>(qs, [qs])

  const handleUploadDone = async () => {
    await list.reload()
    if (qs) cmp.reload()
  }

  if (list.error) return <ErrorBox msg={list.error} />
  if (!list.data) return <Loading />

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.6rem', marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>Опитування</h1>
        {a && b && cmp.data && !cmp.data.hidden && (
          <div className="survey-export-bar no-print">
            <button
              type="button"
              className="btn secondary small"
              onClick={() => download(`surveys/compare?a=${a}&b=${b}&format=xlsx`, `porivniannia_opytuvan_${a}_vs_${b}.xlsx`)}
              title="Експорт порівняння в Excel"
            >
              <FileSpreadsheet size={15} />
              <span>XLSX звіт</span>
            </button>
            <button
              type="button"
              className="btn gold small"
              onClick={() => download(`surveys/compare?a=${a}&b=${b}&format=docx`, `analitychnyi_zvit_opytuvannia_${a}_vs_${b}.docx`)}
              title="Експорт офіційного аналітичного звіту у Word"
            >
              <FileText size={15} />
              <span>Word (ДСТУ 4163:2020)</span>
            </button>
            <button
              type="button"
              className="btn secondary small"
              onClick={() => {
                api('audit/log-print', {
                  method: 'POST',
                  body: {
                    title: `Порівняння опитувань (${cmp.data?.a?.title || a} vs ${cmp.data?.b?.title || b})`,
                    obj_id: `survey_${a}_${b}`,
                    obj_type: 'opytuvannia',
                  },
                }).catch(() => {})
                window.print()
              }}
              title="Друк сторінки"
            >
              <Printer size={15} />
              <span>Друк</span>
            </button>
          </div>
        )}
      </div>

      <div className="hint no-print">
        Порівняння результатів двох Google Форм або таблиць Excel. Форми не збирають персональні адреси; якщо в експорті трапиться колонка з поштою або позначкою часу, система автоматично відкидає її під час імпорту. Розділ доступний уповноваженому та аналітику.
      </div>

      <div className="grid g2 no-print" style={{ alignItems: 'start', marginBottom: '1rem' }}>
        <Card title="Завантажені опитування">
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Назва</th>
                  <th>Відповідей</th>
                  <th>Питань</th>
                  <th>Завантажено</th>
                  {isKoord && <th></th>}
                </tr>
              </thead>
              <tbody>
                {list.data.map(s => (
                  <tr key={s.id}>
                    <td>
                      <b>{s.title}</b>
                      {s.dropped_columns.length > 0 && (
                        <>
                          <br />
                          <small className="muted">відкинуто: {s.dropped_columns.join(', ')}</small>
                        </>
                      )}
                    </td>
                    <td>{s.n}</td>
                    <td>{s.questions}</td>
                    <td>
                      <small>{fmtDateTime(s.uploaded_at)}</small>
                    </td>
                    {isKoord && (
                      <td>
                        {delId === s.id ? (
                          <span className="row" style={{ flexWrap: 'nowrap' }}>
                            <button
                              type="button"
                              className="btn danger small"
                              onClick={async () => {
                                await api(`surveys/${s.id}`, { method: 'DELETE' })
                                setDelId(null)
                                await list.reload()
                                if (a === s.id || b === s.id) {
                                  setA(null)
                                  setB(null)
                                }
                              }}
                            >
                              Так
                            </button>
                            <button type="button" className="btn secondary small" onClick={() => setDelId(null)}>
                              Ні
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn danger small"
                            title="Видалити опитування"
                            onClick={() => setDelId(s.id)}
                          >
                            Видалити
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {!list.data.length && (
                  <tr>
                    <td colSpan={isKoord ? 5 : 4} className="muted">
                      Немає завантажених опитувань.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {isKoord && <Upload onDone={handleUploadDone} />}
      </div>

      {list.data.length > 0 && (
        <Card title="Параметри порівняння хвиль" className="no-print">
          <div className="grid g4" style={{ alignItems: 'end' }}>
            <label className="f">
              Форма А (базова)
              <select value={a ?? ''} onChange={e => setA(+e.target.value)}>
                {list.data.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="f">
              Форма Б (контрольна)
              <select value={b ?? ''} onChange={e => setB(+e.target.value)}>
                {list.data.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
            {cmp.data?.filters?.length > 0 && (
              <>
                <label className="f">
                  Фільтр за питанням
                  <select value={filter.fq} onChange={e => setFilter({ fq: e.target.value, fv: '' })}>
                    <option value="">усі респонденти</option>
                    {cmp.data.filters.map((f: Any) => (
                      <option key={f.question} value={f.question}>
                        {f.question}
                      </option>
                    ))}
                  </select>
                </label>
                {filter.fq && (
                  <label className="f">
                    Значення фільтра
                    <select value={filter.fv} onChange={e => setFilter({ ...filter, fv: e.target.value })}>
                      <option value="">—</option>
                      {cmp.data.filters
                        .find((f: Any) => f.question === filter.fq)
                        ?.values.map((v: string) => (
                          <option key={v}>{v}</option>
                        ))}
                    </select>
                  </label>
                )}
              </>
            )}
          </div>
        </Card>
      )}

      {cmp.error && <ErrorBox msg={cmp.error} />}
      {cmp.data && <Comparison c={cmp.data} />}
    </>
  )
}

function Upload({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [msg, setMsg] = useState<Any>(null)
  const [loading, setLoading] = useState(false)

  const send = async () => {
    if (!file) return
    setLoading(true)
    setMsg(null)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('title', title || file.name.replace(/\.[^/.]+$/, ''))
    try {
      const r = await api('surveys', { form: fd, method: 'POST' })
      setMsg({ ok: true, ...r })
      setTitle('')
      setFile(null)
      onDone()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card title="Імпорт результатів Google Форми або Excel">
      <ol style={{ paddingLeft: '1.2rem', marginTop: 0 }}>
        <small>
          <li>Підтримуються файли <b>.csv</b> та <b>.xlsx</b> (Excel).</li>
          <li>Кодування визначається автоматично (UTF-8, Windows-1251).</li>
          <li>Для порівняння питання в обох формах мають бути сформульовані однаково.</li>
        </small>
      </ol>
      <label className="f">
        Назва опитування
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Опитування, хвиля 2 (вересень 2026)"
        />
      </label>
      <div className="f">
        Файл відповідей (.xlsx або .csv)
        <FilePicker
          file={file}
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={setFile}
        />
      </div>
      <button type="button" className="btn" disabled={!file || loading} onClick={send}>
        {loading ? 'Завантаження…' : 'Завантажити опитування'}
      </button>
      {msg && (
        <div className={`alert ${msg.ok ? 'success' : 'danger'}`} style={{ marginTop: '.6rem' }}>
          {msg.ok ? (
            <>
              Імпортовано відповідей: <b>{msg.n}</b>.
              {msg.dropped_columns.length > 0 && <> Відкинуто колонки: {msg.dropped_columns.join(', ')}.</>}
            </>
          ) : (
            msg.text
          )}
        </div>
      )}
    </Card>
  )
}

function Comparison({ c }: { c: Any }) {
  const isMobile = useIsMobile(560)
  const isUltraNarrow = useIsMobile(340)

  // Керування розгортанням варіантів відповідей (для довгих списків)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  // Керування видимістю питань
  const [showVisibilityPanel, setShowVisibilityPanel] = useState(false)
  const [hiddenQuestions, setHiddenQuestions] = useState<Record<string, boolean>>({})

  if (c.hidden) {
    return (
      <div className="alert warning" style={{ marginTop: '1rem' }}>
        Відповідей замало для показу (Хвиля А: {c.n_a}, Хвиля Б: {c.n_b}; встановлений поріг анонімності: мінімум {c.min_group}). Так система надійно захищає анонімність малих груп респондентів.
      </div>
    )
  }

  const allQuestions = c.questions || []
  const mandatoryCount = allQuestions.filter((q: Any) => q.is_mandatory).length
  const optionalCount = allQuestions.length - mandatoryCount

  const visibleQuestions = allQuestions.filter((q: Any) => {
    if (q.is_mandatory) return true
    return !hiddenQuestions[q.question]
  })

  const scale = visibleQuestions.filter((q: Any) => q.kind === 'scale')
  const choice = visibleQuestions.filter((q: Any) => q.kind === 'choice')
  const text = visibleQuestions.filter((q: Any) => q.kind === 'text')

  const shifts = choice
    .flatMap((q: Any) => (q.options || []).map((o: Any) => ({ q: q.clean_title || q.question, ...o })))
    .filter((s: Any) => !s.is_summary_other && s.delta_pp !== undefined)
    .sort((x: Any, y: Any) => Math.abs(y.delta_pp) - Math.abs(x.delta_pp))
    .slice(0, 5)

  const yAxisW = isUltraNarrow ? 65 : isMobile ? 85 : 135
  const maxLbl = isUltraNarrow ? 9 : isMobile ? 12 : 22

  const toggleExpand = (qKey: string) => {
    setExpanded(prev => ({ ...prev, [qKey]: !prev[qKey] }))
  }

  const toggleQuestionVisibility = (qKey: string) => {
    setHiddenQuestions(prev => ({ ...prev, [qKey]: !prev[qKey] }))
  }

  const showAll = () => setHiddenQuestions({})
  const showOnlyMandatory = () => {
    const next: Record<string, boolean> = {}
    allQuestions.forEach((q: Any) => {
      if (!q.is_mandatory) next[q.question] = true
    })
    setHiddenQuestions(next)
  }

  const exportChartPng = async (elementId: string, title: string) => {
    const el = document.getElementById(elementId)
    if (!el) return
    try {
      const isDark = document.documentElement.classList.contains('dark')
      const canvas = await html2canvas(el, {
        backgroundColor: isDark ? '#111827' : '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
        ignoreElements: (element) => {
          return element.hasAttribute('data-html2canvas-ignore') || element.classList.contains('no-print')
        },
      })
      const a = document.createElement('a')
      a.download = `${title.slice(0, 40).replace(/[^a-z0-9а-яіїєґ]/gi, '_')}.png`
      a.href = canvas.toDataURL('image/png')
      a.click()
    } catch (e) {
      console.error('Error exporting chart image:', e)
    }
  }

  return (
    <>
      <div className="stats" style={{ marginTop: '1rem' }}>
        <Stat v={c.n_a} l={`відповідей · ${c.a?.title || 'Хвиля А'}`} />
        <Stat v={c.n_b} l={`відповідей · ${c.b?.title || 'Хвиля Б'}`} />
        {scale.map((q: Any) => (
          <Stat
            key={q.question}
            tone={q.delta > 0 ? 'ok' : q.delta < 0 ? 'bad' : ''}
            l={<span className="clamp" title={q.clean_title || q.question}>{q.clean_title || q.question}</span>}
            v={
              <>
                {q.mean_a} → {q.mean_b}{' '}
                <small style={{ fontSize: '.85rem', fontWeight: 500 }}>
                  ({q.delta > 0 ? '+' : ''}
                  {q.delta})
                </small>
              </>
            }
          />
        ))}
      </div>

      {/* Панель керування видимістю питань */}
      <div className="no-print" style={{ margin: '1rem 0' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            type="button"
            className="btn secondary small"
            onClick={() => setShowVisibilityPanel(!showVisibilityPanel)}
          >
            <Filter size={14} />
            <span>
              Керування видимістю питань ({visibleQuestions.length} з {allQuestions.length} відображається)
            </span>
            {showVisibilityPanel ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showVisibilityPanel && (
            <div className="row" style={{ gap: '.4rem' }}>
              <button type="button" className="btn secondary small" onClick={showAll}>
                Показати всі
              </button>
              {optionalCount > 0 && (
                <button type="button" className="btn secondary small" onClick={showOnlyMandatory}>
                  Лише обов'язкові ({mandatoryCount})
                </button>
              )}
            </div>
          )}
        </div>

        {showVisibilityPanel && (
          <div className="survey-visibility-box" style={{ marginTop: '.6rem' }}>
            <div className="muted" style={{ fontSize: '.84rem', marginBottom: '.4rem' }}>
              Обов'язкові питання (позначені <Star size={12} style={{ display: 'inline', color: 'var(--gold)' }} />) відображаються завжди. Решту питань можна вмикати чи вимикати:
            </div>
            <div className="survey-visibility-grid">
              {allQuestions.map((q: Any, idx: number) => {
                const isMand = !!q.is_mandatory
                const isChecked = isMand || !hiddenQuestions[q.question]
                return (
                  <label key={q.question || idx} className="survey-check-label">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={isMand}
                      onChange={() => toggleQuestionVisibility(q.question)}
                    />
                    <span style={{ fontSize: '.85rem', lineHeight: 1.3 }}>
                      {isMand && <Star size={12} style={{ color: 'var(--gold)', marginRight: '.25rem' }} />}
                      {q.clean_title || q.question}
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {shifts.length > 0 && (
        <Card title="Найбільші зсуви у відповідях респондентів">
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Питання</th>
                  <th>Варіант відповіді</th>
                  <th className="nowrap">Хвиля А → Хвиля Б</th>
                  <th className="nowrap">Зміна (п.п.)</th>
                </tr>
              </thead>
              <tbody>
                {shifts.map((s: Any, i: number) => (
                  <tr key={i}>
                    <td style={{ minWidth: 160 }}>{s.q}</td>
                    <td><b>{s.option}</b></td>
                    <td className="nowrap">{s.a.pct}% → {s.b.pct}%</td>
                    <td className="nowrap">
                      <Pill tone={s.delta_pp > 0 ? 'info' : 'gold'}>
                        {s.delta_pp > 0 ? '+' : ''}{s.delta_pp} п.п.
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Діаграми та таблиці за питаннями */}
      <div className="grid g2">
        {[...scale, ...choice].map((q: Any, qIdx: number) => {
          const isExp = !!expanded[q.question]
          const opts = isExp ? q.options : (q.collapsed_options || q.options)
          const chartH = Math.max(160, Math.min(420, opts.length * 36))
          const cardId = `chart-card-${qIdx}`

          return (
            <Card
              key={q.question}
              id={cardId}
              title={
                <div className="survey-card-head">
                  <div className="survey-q-title">
                    {q.is_mandatory && (
                      <span className="pill gold survey-q-badge" style={{ marginRight: '.4rem', fontSize: '.72rem' }}>
                        * Обов'язкове
                      </span>
                    )}
                    {q.clean_title || q.question}
                  </div>
                  <button
                    type="button"
                    className="btn secondary small icon no-print"
                    data-html2canvas-ignore="true"
                    title="Зберегти графік як зображення PNG"
                    onClick={() => exportChartPng(cardId, q.clean_title || q.question)}
                  >
                    <Camera size={14} />
                  </button>
                </div>
              }
            >
              <div className="survey-chart-container" style={{ height: chartH }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={opts.map((o: Any) => ({
                      name: o.option,
                      'А, %': o.a.pct,
                      'Б, %': o.b.pct,
                    }))}
                    layout="vertical"
                    margin={{ left: 2, right: 10, top: 4, bottom: 4 }}
                  >
                    <CartesianGrid stroke={C.grid} />
                    <XAxis type="number" unit="%" fontSize={10} stroke={C.muted} domain={[0, 'auto']} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={yAxisW}
                      fontSize={10}
                      stroke={C.muted}
                      tickFormatter={(v: string) => (v.length > maxLbl ? v.slice(0, maxLbl - 1) + '…' : v)}
                    />
                    <Tooltip
                      contentStyle={CHART_TOOLTIP_STYLE}
                      itemStyle={CHART_ITEM_STYLE}
                      labelStyle={CHART_LABEL_STYLE}
                      cursor={{ fill: 'var(--surface-2)' }}
                    />
                    <Legend wrapperStyle={{ color: 'var(--ink-2)', fontSize: '0.8rem' }} />
                    <Bar dataKey="А, %" fill={CA} radius={[0, 3, 3, 0]} />
                    <Bar dataKey="Б, %" fill={CB} radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Згортання / розгортання варіантів відповідей */}
              {q.has_many_options && (
                <div className="survey-collapse-bar no-print">
                  <span className="muted" style={{ fontSize: '.8rem' }}>
                    {isExp
                      ? `Показано всі ${q.total_options_count} варіантів`
                      : `Показано основні варіанти (${opts.length} з ${q.total_options_count})`}
                  </span>
                  <button
                    type="button"
                    className="btn secondary small"
                    onClick={() => toggleExpand(q.question)}
                  >
                    {isExp ? (
                      <>
                        <ChevronUp size={14} /> <span>Згорнути до основних</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown size={14} /> <span>Показати всі ({q.total_options_count})</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              <div className="table-wrap" style={{ marginTop: '.65rem' }}>
                <table className="t">
                  <thead>
                    <tr>
                      <th>Варіант відповіді</th>
                      <th>Хвиля А</th>
                      <th>Хвиля Б</th>
                      <th>Зміна</th>
                    </tr>
                  </thead>
                  <tbody>
                    {opts.map((o: Any) => (
                      <tr key={o.option} style={o.is_summary_other ? { fontStyle: 'italic', background: 'var(--surface-2)' } : undefined}>
                        <td>
                          {o.option}
                          {o.sub_options_count && (
                            <small className="muted"><br />({o.sub_options_count} інших відповідей)</small>
                          )}
                        </td>
                        <td className="nowrap">
                          {o.a.pct}% <small className="muted">({o.a.n})</small>
                        </td>
                        <td className="nowrap">
                          {o.b.pct}% <small className="muted">({o.b.n})</small>
                        </td>
                        <td className="nowrap">
                          <Pill tone={o.delta_pp > 0 ? 'info' : o.delta_pp < 0 ? 'gold' : 'grey'}>
                            {o.delta_pp > 0 ? '+' : ''}
                            {o.delta_pp} п.п.
                          </Pill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )
        })}
      </div>

      {text.map((q: Any) => (
        <Card key={q.question} title={q.clean_title || q.question}>
          <div className="grid g2">
            <div>
              <b>Хвиля А ({q.answers_a.length} відповідей)</b>
              {q.uninformative_count_a > 0 && (
                <div className="muted" style={{ fontSize: '.8rem', marginBottom: '.4rem' }}>
                  Згруповано неінформативних: {q.uninformative_count_a}
                </div>
              )}
              <ul style={{ maxHeight: 280, overflowY: 'auto' }}>
                {q.answers_a.slice(0, 40).map((t: string, i: number) => (
                  <li key={i}>
                    <small>{t}</small>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <b>Хвиля Б ({q.answers_b.length} відповідей)</b>
              {q.uninformative_count_b > 0 && (
                <div className="muted" style={{ fontSize: '.8rem', marginBottom: '.4rem' }}>
                  Згруповано неінформативних: {q.uninformative_count_b}
                </div>
              )}
              <ul style={{ maxHeight: 280, overflowY: 'auto' }}>
                {q.answers_b.slice(0, 40).map((t: string, i: number) => (
                  <li key={i}>
                    <small>{t}</small>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      ))}

      {(c.only_a.length > 0 || c.only_b.length > 0) && (
        <Card title="Питання, які присутні лише в одній із форм" className="no-print">
          {c.only_a.length > 0 && (
            <p>
              <b>Лише в Хвилі А:</b> {c.only_a.join('; ')}
            </p>
          )}
          {c.only_b.length > 0 && (
            <p>
              <b>Лише в Хвилі Б:</b> {c.only_b.join('; ')}
            </p>
          )}
        </Card>
      )}
    </>
  )
}
