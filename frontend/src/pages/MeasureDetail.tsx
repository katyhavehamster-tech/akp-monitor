import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, fmtDate, fmtDateTime, num, safeUrl, type Any } from '../api'
import { can, useAuth } from '../auth'
import { APPROVAL_TONE, C, Card, CHART_ITEM_STYLE, CHART_LABEL_STYLE, CHART_TOOLTIP_STYLE, ErrorBox, FilePicker, Loading, Pill, PORTAL_TONE, RISK_TONE, STATUS, StatusPill, useApi } from '../components/ui'
import { Edit3, PlusCircle, Trash2 } from 'lucide-react'
import { UnitModal } from '../components/UnitModal'

export default function MeasureDetail() {
  const { code } = useParams()
  const nav = useNavigate()
  const { period, profile } = useAuth()
  const { data: m, error, reload } = useApi<Any>(period ? `measures/${code}?period=${period}` : null, [period, code])
  const units = useApi<Any[]>('units')
  const risks = useApi<Any[]>('risks')

  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  if (error) return <ErrorBox msg={error} />
  if (!m) return <Loading />

  const isKoord = profile?.role === 'KOORD' || profile?.role === 'ADMIN'
  const canManage = can.manageMeasures(profile?.role)
  const back = profile?.role === 'VYK' ? '/my' : '/program/measures'

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: '.6rem' }}>
        <p style={{ margin: 0 }}>
          <Link to={back}>← до переліку заходів</Link>
        </p>
        {canManage && (
          <div className="row" style={{ gap: '.5rem' }}>
            <button
              type="button"
              className="btn secondary small"
              onClick={() => {
                setEditing(!editing)
                setDeleting(false)
              }}
            >
              <Edit3 size={14} />
              <span>{editing ? 'Скасувати редагування' : 'Редагувати параметри'}</span>
            </button>
            {!m.is_excluded && (
              <button
                type="button"
                className="btn danger small"
                onClick={() => {
                  setDeleting(!deleting)
                  setEditing(false)
                }}
              >
                <Trash2 size={14} />
                <span>Виключити / Видалити захід</span>
              </button>
            )}
          </div>
        )}
      </div>

      {m.is_excluded && (
        <div className="alert danger" style={{ marginBottom: '1rem' }}>
          <b>ЗАХІД ОФІЦІЙНО ВИКЛЮЧЕНО З АНТИКОРУПЦІЙНОЇ ПРОГРАМИ</b>
          <br />
          {m.exclusion_reason ? (
            <>Підстава виключення: <b>{m.exclusion_reason}</b>. </>
          ) : (
            <>Виключено наказом / розпорядженням. </>
          )}
          Захід знято з активного оперативного контролю. Усі раніше подані підтвердження та історія змін збережені в незмінному реєстрі.
        </div>
      )}

      {editing && (
        <EditMeasureForm
          m={m}
          units={units.data || []}
          risks={risks.data || []}
          onDone={() => {
            setEditing(false)
            reload()
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      {deleting && (
        <DeleteOrExcludeModal
          m={m}
          onDone={(status) => {
            setDeleting(false)
            if (status === 'deleted') {
              nav('/program/measures')
            } else {
              reload()
            }
          }}
          onCancel={() => setDeleting(false)}
        />
      )}

      <Card>
        <div className="row" style={{ flexWrap: 'wrap', gap: '.5rem', alignItems: 'center' }}>
          <h1 style={{ margin: 0 }}>{m.code}</h1>
          {m.is_excluded ? (
            <Pill tone="bad">виключено з програми</Pill>
          ) : (
            <StatusPill s={m.status} />
          )}
          <Pill tone={PORTAL_TONE[m.portal_state]}>
            {m.is_excluded ? 'Знято з контролю' : `Портал: ${m.portal_state}`}
          </Pill>
          {m.execution && <Pill tone={APPROVAL_TONE[m.execution.approval]}>{m.execution.approval_name}</Pill>}
          <Pill tone={RISK_TONE[m.nonexecution_risk.level]}>ризик невиконання: {m.nonexecution_risk.level}</Pill>
        </div>
        <div style={{ marginTop: '.85rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div>
            <div style={{ fontSize: '.84rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '.25rem' }}>
              Плановий зміст та очікуваний результат:
            </div>
            <p style={{ fontSize: '1.05rem', margin: 0, lineHeight: 1.5, fontWeight: 500 }}>{m.content}</p>
          </div>

          <div
            className="measure-fact-summary-box"
            style={{
              padding: '.85rem 1rem',
              borderRadius: '8px',
              background: 'var(--card-subtle, rgba(59, 130, 246, 0.05))',
              border: '1px solid var(--border-subtle, rgba(59, 130, 246, 0.15))',
              borderLeft: '4px solid var(--primary, #3b82f6)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.4rem', marginBottom: '.35rem' }}>
              <span style={{ fontSize: '.86rem', fontWeight: 700, color: 'var(--primary)' }}>
                Підсумковий фактичний опис стану виконання заходу ({period}):
              </span>
              <Pill tone={PORTAL_TONE[m.portal_state]}>{m.portal_state}</Pill>
            </div>
            {m.execution?.result_text ? (
              <p style={{ margin: '0 0 .4rem 0', fontSize: '.93rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {m.execution.result_text}
              </p>
            ) : (
              <p className="muted" style={{ margin: '0 0 .4rem 0', fontSize: '.88rem', fontStyle: 'italic' }}>
                Опис фактичного виконання за звітний період {period} ще не внесено.
              </p>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', fontSize: '.78rem', color: 'var(--muted)' }}>
              {m.execution?.fact_date && (
                <span>Фактична дата: <b style={{ color: 'var(--ink)' }}>{fmtDate(m.execution.fact_date)}</b></span>
              )}
              {m.execution?.indicator_fact !== undefined && m.execution?.indicator_fact !== null && (
                <span>Факт індикатора: <b style={{ color: 'var(--ink)' }}>{num(m.execution.indicator_fact)} {m.indicator_unit}</b> {m.indicator_target !== null ? `(ціль: ${num(m.indicator_target)})` : ''}</span>
              )}
              {m.execution?.entered_by && (
                <span>Вніс: {m.execution.entered_by} {fmtDateTime(m.execution.entered_at)}</span>
              )}
              {m.execution?.approved_by && (
                <span>Погодив: {m.execution.approved_by} {fmtDateTime(m.execution.approved_at)}</span>
              )}
            </div>
          </div>
        </div>

        <dl className="kv" style={{ marginTop: '1rem' }}>
          <dt>Розділ</dt>
          <dd>{m.section_name}</dd>
          <dt>Відповідальний підрозділ</dt>
          <dd>
            {m.unit.code} {m.unit.name}
            {m.co_units.length ? <small className="muted"> · співвиконавці: {m.co_units.join(', ')}</small> : null}
          </dd>
          <dt>Строк за програмою</dt>
          <dd>
            {m.strok_text}
            {m.strok_date && <> (до {fmtDate(m.strok_date)})</>}
            {m.postponed > 0 && (
              <>
                {' '}
                · <Pill tone="warn">внутрішній строк перенесено ×{m.postponed} → {fmtDate(m.current_deadline)}</Pill>
              </>
            )}
          </dd>
          <dt>Плановий індикатор виконання</dt>
          <dd>
            {m.indicator}
            {m.indicator_target !== null && (
              <>
                {' '}
                · цільове значення: <b>{num(m.indicator_target)} {m.indicator_unit}</b>
              </>
            )}
          </dd>
          <dt>Потрібні підтвердження</dt>
          <dd>{m.required_evidence || '—'}</dd>
          {m.resources && (
            <>
              <dt>Необхідні ресурси</dt>
              <dd>{m.resources}</dd>
            </>
          )}
        </dl>
      </Card>

      {m.flags.length > 0 && (
        <Card title={`Сигнали (${m.flags.length})`}>
          {m.flags.map((f: Any, i: number) => (
            <div key={i} className={`alert ${f.severity === 'high' ? 'danger' : 'warning'}`}>
              <b>{f.code} · {f.title}.</b> {f.explanation}
              <br />
              <small>Правило: {f.rule}</small>
            </div>
          ))}
        </Card>
      )}

      {m.nonexecution_risk.reasons.length > 0 && (
        <Card title={`Ризик невиконання: ${m.nonexecution_risk.level} (${m.nonexecution_risk.score} б.)`}>
          <p className="muted">Розраховано за явними правилами, без моделі ШІ:</p>
          <ul>
            {m.nonexecution_risk.reasons.map((r: Any, i: number) => (
              <li key={i}>
                +{r.points} — {r.text}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div>
          <ExecutionForm m={m} period={period} onSaved={reload} />
          {isKoord && m.execution && <ApprovalPanel m={m} period={period} onDone={reload} />}
          {isKoord && m.strok_type === 'data' && <DeadlinePanel m={m} onDone={reload} />}
        </div>
        <div>
          <EvidencePanel m={m} period={period} onDone={reload} />
          {m.risk_detail && <RiskPanel r={m.risk_detail} />}
          <CommentsPanel
            m={m}
            period={period}
            onDone={reload}
            canComment={profile?.role === 'KOORD' || profile?.role === 'ADMIN' || profile?.role === 'VYK'}
          />
        </div>
      </div>

      <div style={{ marginTop: '1rem' }}>
        <Card title="Хронологія звітів виконавців за періодами">
          <p className="muted" style={{ fontSize: '.84rem', marginTop: '-.4rem', marginBottom: '.8rem' }}>
            Поквартальна динаміка виконання заходу, детальний текстовий опис досягнутих результатів та статус погодження.
          </p>
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th style={{ width: 85 }}>Період</th>
                  <th style={{ width: 110 }}>Статус</th>
                  <th>Фактичний опис результату / пояснення причин</th>
                  <th style={{ width: 120 }}>Індикатор</th>
                  <th style={{ width: 120 }}>Внесено</th>
                  <th style={{ width: 120 }}>Погодження</th>
                </tr>
              </thead>
              <tbody>
                {m.history[0].executions.map((e: Any) => (
                  <tr key={e.period}>
                    <td><b>{e.period}</b></td>
                    <td>
                      <StatusPill s={e.status} />
                    </td>
                    <td>
                      {e.result_text ? (
                        <div style={{ fontSize: '.88rem', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                          {e.result_text}
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                      {e.fact_date && (
                        <div className="muted" style={{ fontSize: '.76rem', marginTop: '.2rem' }}>
                          факт. дата: {fmtDate(e.fact_date)}
                        </div>
                      )}
                    </td>
                    <td>
                      <small>
                        {e.indicator_fact !== null && e.indicator_fact !== undefined
                          ? `${num(e.indicator_fact)} ${m.indicator_unit || ''}`
                          : '—'}
                      </small>
                    </td>
                    <td>
                      <small>
                        {e.entered_by || '—'}
                        <br />
                        {fmtDateTime(e.entered_at)}
                      </small>
                    </td>
                    <td>
                      <Pill tone={APPROVAL_TONE[e.approval]}>{e.approval_name}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div style={{ marginTop: '1rem' }}>
        <Card title="Журнал дій щодо заходу">
          <ul className="timeline">
            {m.audit.map((a: Any) => (
              <li key={a.id}>
                <b>{fmtDateTime(a.ts)}</b> · {a.actor} <small className="muted">({a.actor_role})</small>
                <br />
                {a.action}
                {a.field && (
                  <>
                    {' '}
                    — <code>{a.field}</code>: {a.old && <><s>{a.old.slice(0, 80)}</s> → </>}
                    {a.new.slice(0, 120)}
                  </>
                )}
                <div className="hash">#{a.hash.slice(0, 16)}…</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}

function EditMeasureForm({
  m,
  units,
  risks,
  onDone,
  onCancel,
}: {
  m: Any
  units: Any[]
  risks: Any[]
  onDone: () => void
  onCancel: () => void
}) {
  const [unitsList, setUnitsList] = useState<Any[]>(units || [])
  const [showUnitModal, setShowUnitModal] = useState(false)
  const [f, setF] = useState<Any>({
    content: m.content || '',
    section: m.section || 'R2',
    unit: m.unit?.code || '',
    co_units: m.co_units || [],
    risk: m.risk || '',
    strok_text: m.strok_text || '',
    strok_type: m.strok_type || 'data',
    strok_date: m.strok_date || '',
    indicator: m.indicator || '',
    indicator_unit: m.indicator_unit || '',
    indicator_target: m.indicator_target ?? '',
    required_evidence: m.required_evidence || '',
    resources: m.resources || '',
  })
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (units?.length) setUnitsList(units)
  }, [units])

  const set = (k: string) => (e: Any) => setF({ ...f, [k]: e.target.value })

  const toggleCoUnit = (uCode: string) => {
    const list = f.co_units || []
    if (list.includes(uCode)) {
      setF({ ...f, co_units: list.filter((x: string) => x !== uCode) })
    } else {
      setF({ ...f, co_units: [...list, uCode] })
    }
  }

  const handleUnitCreated = (newUnit: { code: string; name: string; type?: string; note?: string }) => {
    setUnitsList((prev: Any[]) => [...prev.filter((u: Any) => u.code !== newUnit.code), newUnit])
    setF((prev: Any) => ({ ...prev, unit: newUnit.code }))
  }

  const save = async () => {
    setErr('')
    setSaving(true)
    try {
      await api(`measures/${m.code}`, { method: 'PATCH', body: f })
      onDone()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title={`Редагування параметрів заходу ${m.code}`}>
      <div className="hint">
        Зміна параметрів фіксується в незмінному криптографічному ланцюжку аудиту (SHA-256).
      </div>
      <div className="grid g3">
        <label className="f">
          Розділ програми
          <select value={f.section} onChange={set('section')}>
            <option value="R1">Розділ 1</option>
            <option value="R2">Розділ 2</option>
            <option value="R3">Розділ 3</option>
          </select>
        </label>
        <label className="f">
          Корупційний ризик
          <select value={f.risk} onChange={set('risk')}>
            <option value="">—</option>
            {risks.map(r => (
              <option key={r.code} value={r.code}>
                {r.code} {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="f">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.25rem', marginBottom: '.25rem' }}>
            <span>Відповідальний підрозділ</span>
            <button
              type="button"
              className="btn secondary mini"
              onClick={() => setShowUnitModal(true)}
              style={{ padding: '2px 7px', fontSize: '.75rem', display: 'inline-flex', alignItems: 'center', gap: '.25rem' }}
              title="Швидко створити новий структурний підрозділ"
            >
              <PlusCircle size={12} />
              <span>+ Новий підрозділ</span>
            </button>
          </div>
          <select value={f.unit} onChange={set('unit')}>
            {unitsList.map(u => (
              <option key={u.code} value={u.code}>
                {u.code} {u.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="f">
        Зміст заходу
        <textarea rows={3} value={f.content} onChange={set('content')} />
      </label>

      <div className="grid g4">
        <label className="f">
          Строк за програмою
          <input value={f.strok_text} onChange={set('strok_text')} />
        </label>
        <label className="f">
          Тип строку
          <select value={f.strok_type} onChange={set('strok_type')}>
            <option value="data">до дати</option>
            <option value="postiino">постійно</option>
            <option value="periodychno">періодично</option>
          </select>
        </label>
        <label className="f">
          Кінцева дата
          <input type="date" value={f.strok_date} onChange={set('strok_date')} />
        </label>
        <label className="f">
          Потрібні підтвердження
          <input value={f.required_evidence} onChange={set('required_evidence')} />
        </label>
      </div>

      <div className="grid g4">
        <label className="f">
          Індикатор виконання
          <input value={f.indicator} onChange={set('indicator')} />
        </label>
        <label className="f">
          Одиниця
          <input value={f.indicator_unit} onChange={set('indicator_unit')} />
        </label>
        <label className="f">
          Цільове значення
          <input type="number" value={f.indicator_target} onChange={set('indicator_target')} />
        </label>
        <label className="f">
          Ресурси
          <input value={f.resources} onChange={set('resources')} />
        </label>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '.88rem', fontWeight: 600, marginBottom: '.4rem' }}>
          Співвиконавці заходу:
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: '.4rem' }}>
          {units.map(u => {
            const active = (f.co_units || []).includes(u.code)
            return (
              <button
                key={u.code}
                type="button"
                className={`btn small ${active ? 'primary' : 'secondary'}`}
                style={{ fontSize: '.78rem', padding: '.25rem .5rem' }}
                onClick={() => toggleCoUnit(u.code)}
              >
                {active ? '✓ ' : '+ '}
                {u.code}
              </button>
            )
          })}
        </div>
      </div>

      {err && <div className="alert danger">{err}</div>}

      <div className="row" style={{ gap: '.5rem' }}>
        <button type="button" className="btn" disabled={saving} onClick={save}>
          {saving ? 'Збереження…' : 'Зберегти зміни'}
        </button>
        <button type="button" className="btn secondary" onClick={onCancel}>
          Скасувати
        </button>
      </div>

      <UnitModal
        isOpen={showUnitModal}
        onClose={() => setShowUnitModal(false)}
        onSaved={handleUnitCreated}
      />
    </Card>
  )
}

function DeleteOrExcludeModal({
  m,
  onDone,
  onCancel,
}: {
  m: Any
  onDone: (status: 'deleted' | 'excluded') => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const hasEvidence = (m.evidence || []).length > 0
  const hasApproved = m.execution?.approval === 'approved'
  const mustExclude = hasEvidence || hasApproved

  const handleAction = async (permanent: boolean) => {
    setErr('')
    setLoading(true)
    try {
      if (mustExclude && !reason.trim()) {
        setErr("Обов'язково вкажіть підставу виключення заходу з програми (наказ/розпорядження).")
        setLoading(false)
        return
      }

      if (permanent && !mustExclude) {
        await api(`measures/${m.code}`, { method: 'DELETE' })
        onDone('deleted')
        return
      }

      const res = await api(`measures/${m.code}`, {
        method: 'DELETE',
        body: { reason: reason.trim() },
      })

      if (res?.status === 'excluded' || mustExclude || reason.trim()) {
        onDone('excluded')
      } else {
        onDone('deleted')
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card title={`Виключення або видалення заходу ${m.code}`}>
      {mustExclude ? (
        <div className="alert warning">
          <b>Увага: Захід містить захищені дані!</b>
          <br />
          За цим заходом вже є {m.evidence.length} завантажених незмінних підтверджень (Evidence) або погоджений звіт.
          Згідно з правилами цілісності реєстру, захід не видаляється безслідно, а <b>виключається з програми</b> із
          фіксацією реквізитів підстави (наказу) та збереженням історичного ланцюжка SHA-256.
        </div>
      ) : (
        <p>
          Цей захід не містить завантажених підтвердних матеріалів. Ви можете повністю видалити його з реєстру або
          виключити з програми із зазначенням реквізитів рішення.
        </p>
      )}

      <label className="f">
        Підстава виключення заходу (наприклад: Наказ ректора від 18.09.2026 № 214-од)
        <input
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Наказ від … № … про внесення змін до програми"
        />
      </label>

      {err && <div className="alert danger">{err}</div>}

      <div className="row" style={{ gap: '.5rem', marginTop: '.8rem' }}>
        <button
          type="button"
          className="btn danger"
          disabled={loading || (mustExclude && !reason.trim())}
          onClick={() => handleAction(false)}
        >
          {loading ? 'Виконання…' : 'Виключити захід з програми'}
        </button>
        {!mustExclude && (
          <button
            type="button"
            className="btn secondary"
            disabled={loading}
            onClick={() => handleAction(true)}
          >
            Видалити повністю з бази
          </button>
        )}
        <button type="button" className="btn secondary" onClick={onCancel}>
          Скасувати
        </button>
      </div>
    </Card>
  )
}

function ExecutionForm({ m, period, onSaved }: { m: Any; period: string; onSaved: () => void }) {
  const e = m.execution || {}
  const [f, setF] = useState<Any>({})
  const [res, setRes] = useState<Any>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    setF({
      status: e.status || 'ne_rozpochato',
      fact_date: e.fact_date || '',
      indicator_fact: e.indicator_fact ?? '',
      result_text: e.result_text || '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.code, period, e.entered_at])
  const allowed = m.can_edit_execution.allowed
  const set = (k: string) => (ev: Any) => setF({ ...f, [k]: ev.target.value })
  const save = async (submit: boolean) => {
    setErr('')
    setRes(null)
    try {
      const r = await api(`measures/${m.code}/execution`, { body: { ...f, period, submit } })
      setRes(r)
      onSaved()
    } catch (x) {
      setErr((x as Error).message)
    }
  }
  return (
    <Card title={`Інформація про виконання · ${period}`}>
      <div className={`alert ${allowed ? 'info' : 'warning'}`}>
        {allowed ? 'Внесення дозволено' : 'Внесення недоступне'}: {m.can_edit_execution.reason}.
      </div>
      {allowed && (
        <div className="hint">
          Внесіть один раз — ці дані автоматично потраплять у моніторинг, панелі, внутрішній звіт і звіт для Порталу
          НАЗК.
          {m.required_evidence && (
            <>
              {' '}
              Додайте підтвердження: <b>{m.required_evidence}</b>.
            </>
          )}
        </div>
      )}
      {!allowed ? (
        <dl className="kv">
          <dt>Статус</dt>
          <dd>{STATUS[e.status || 'ne_rozpochato']?.label}</dd>
          {m.strok_type === 'data' && (
            <>
              <dt>Фактична дата виконання</dt>
              <dd>{fmtDate(e.fact_date)}</dd>
            </>
          )}
          <dt>Факт індикатора</dt>
          <dd>
            {num(e.indicator_fact)} {m.indicator_unit}
            {m.indicator_target !== null && <small className="muted"> (ціль {num(m.indicator_target)})</small>}
          </dd>
          <dt>Опис результату / пояснення</dt>
          <dd>{e.result_text || '—'}</dd>
        </dl>
      ) : (
        <>
          <div className="grid g3">
            <label className="f">
              Статус виконання
              <select value={f.status} onChange={set('status')}>
                {Object.entries(STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            {m.strok_type === 'data' && (
              <label className="f">
                Фактична дата виконання
                <input type="date" value={f.fact_date} onChange={set('fact_date')} />
              </label>
            )}
            <label className="f">
              Факт індикатора ({m.indicator_unit || 'од.'})
              <input
                type="number"
                step="any"
                value={f.indicator_fact}
                onChange={set('indicator_fact')}
                placeholder={`Ціль: ${num(m.indicator_target)}`}
              />
            </label>
          </div>
          <label className="f">
            Опис результату та причини невиконання
            <textarea
              rows={3}
              value={f.result_text}
              onChange={set('result_text')}
              placeholder="Детально опишіть вжиті заходи або причини затримки…"
            />
          </label>
          {err && <div className="alert danger">{err}</div>}
          {res && <div className="alert success">Збережено ({res.saved_at}).</div>}
          <div className="row" style={{ gap: '.5rem' }}>
            <button type="button" className="btn" onClick={() => save(false)}>
              Зберегти чернетку
            </button>
            <button type="button" className="btn gold" onClick={() => save(true)}>
              Подати на погодження
            </button>
          </div>
        </>
      )}
    </Card>
  )
}

function ApprovalPanel({ m, period, onDone }: { m: Any; period: string; onDone: () => void }) {
  const [comment, setComment] = useState('')
  const [err, setErr] = useState('')
  const decide = async (decision: string) => {
    setErr('')
    try {
      await api(`measures/${m.code}/approve`, { body: { period, decision, comment } })
      setComment('')
      onDone()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <Card title="Погодження координатором (уповноваженою особою)">
      <p>
        Поточний статус виконання: <StatusPill s={m.status} /> · Погодження:{' '}
        <Pill tone={APPROVAL_TONE[m.execution.approval]}>{m.execution.approval_name}</Pill>
      </p>
      <label className="f">
        Зауваження або мотив рішення
        <input
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="У разі повернення на доопрацювання або відхилення вкажіть зауваження"
        />
      </label>
      {err && <div className="alert danger">{err}</div>}
      <div className="row" style={{ gap: '.5rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn" onClick={() => decide('approve')}>
          Погодити
        </button>
        <button type="button" className="btn secondary" onClick={() => decide('return')}>
          Повернути на доопрацювання
        </button>
        <button type="button" className="btn danger" onClick={() => decide('reject')}>
          Відхилити
        </button>
      </div>
    </Card>
  )
}

function DeadlinePanel({ m, onDone }: { m: Any; onDone: () => void }) {
  const [newDate, setNewDate] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const save = async () => {
    setErr('')
    try {
      await api(`measures/${m.code}/deadline`, { body: { new_date: newDate, reason } })
      setNewDate('')
      setReason('')
      onDone()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <Card title="Рішення про перенесення внутрішнього строку">
      <div className="hint">
        Затверджений строк у програмі ({fmtDate(m.strok_date)}) залишається незмінним, переноситься лише внутрішній робочий строк.
      </div>
      <div className="grid g2">
        <label className="f">
          Новий робочий строк
          <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
        </label>
        <label className="f">
          Обґрунтування / службова записка
          <input
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Службова записка від 10.04.2026 №..."
          />
        </label>
      </div>
      {err && <div className="alert danger">{err}</div>}
      <button type="button" className="btn secondary" disabled={!newDate || !reason} onClick={save}>
        Зафіксувати перенесення
      </button>
    </Card>
  )
}

function EvidencePanel({ m, period, onDone }: { m: Any; period: string; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [f, setF] = useState<Any>({ type: 'наказ' })
  const [err, setErr] = useState('')
  const [dupNotice, setDupNotice] = useState('')
  const allowed = m.can_edit_execution.allowed
  const save = async () => {
    setErr('')
    setDupNotice('')
    const fd = new FormData()
    if (file) fd.append('file', file)
    fd.append('type', f.type)
    fd.append('title', f.title || (file ? file.name : ''))
    fd.append('doc_date', f.doc_date || '')
    fd.append('link', f.link || '')
    fd.append('period', period)
    try {
      const res = await api<Any>(`measures/${m.code}/evidence`, { form: fd, method: 'POST' })
      setFile(null)
      setF({ type: 'наказ' })
      if (res?.duplicate_warning) {
        setDupNotice(res.duplicate_warning)
      }
      onDone()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <Card title={`Підтвердні матеріали (${m.evidence.length})`}>
      {m.evidence.map((e: Any) => (
        <div key={e.code} className="evidence-item" style={{ marginBottom: '.6rem', paddingBottom: '.6rem', borderBottom: '1px solid var(--line)' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div className="row" style={{ gap: '.4rem', alignItems: 'center' }}>
                <b>{e.title}</b>
                {e.is_duplicate && (
                  <Pill tone="warn" title={e.duplicate_in?.map((d: Any) => `Доказ ${d.code} у заході ${d.measure}`).join(', ')}>
                    ⚠️ Дублікат SHA-256 (захід {e.duplicate_in?.map((d: Any) => d.measure).join(', ')})
                  </Pill>
                )}
              </div>
              <small className="muted">
                {e.type} · від {fmtDate(e.doc_date)} · {e.code}
              </small>
            </div>
            {e.file_url ? (
              <a href={e.file_url} className="btn secondary small" download target="_blank" rel="noreferrer">
                Завантажити
              </a>
            ) : e.link ? (
              <a href={safeUrl(e.link) || undefined} className="btn secondary small" target="_blank" rel="noreferrer">
                Відкрити
              </a>
            ) : null}
          </div>
          <div className="hash" style={{ fontSize: '.72rem', marginTop: '.2rem' }}>
            SHA-256: {e.sha256}
          </div>
        </div>
      ))}
      {!m.evidence.length && <div className="alert warning">Підтвердних матеріалів немає.</div>}
      {allowed && (
        <div style={{ marginTop: '.7rem' }}>
          <div className="grid g3">
            <label className="f">
              Тип
              <select value={f.type} onChange={ev => setF({ ...f, type: ev.target.value })}>
                {['наказ', 'протокол', 'акт', 'звіт', 'реєстр', 'журнал', 'лист', 'посилання'].map(t => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="f">
              Дата документа
              <input type="date" value={f.doc_date || ''} onChange={ev => setF({ ...f, doc_date: ev.target.value })} />
            </label>
            <div className="f">
              Файл
              <FilePicker
                file={file}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.odt,.ods,.png,.jpg,.jpeg,.webp,.zip,.p7s,.sig"
                onChange={setFile}
              />
            </div>
          </div>
          <label className="f">
            Назва / реквізити
            <input
              value={f.title || ''}
              onChange={ev => setF({ ...f, title: ev.target.value })}
              placeholder="Наказ від 12.05.2026 № 45 (умовний)"
            />
          </label>
          <label className="f">
            Посилання на відкрите джерело (https://…)
            <input
              type="url"
              value={f.link || ''}
              onChange={ev => setF({ ...f, link: ev.target.value })}
              placeholder="https://..."
            />
          </label>
          {err && <div className="alert danger">{err}</div>}
          {dupNotice && <div className="alert warning" style={{ marginBottom: '.5rem' }}>{dupNotice}</div>}
          <button type="button" className="btn secondary" onClick={save}>
            Додати підтвердження
          </button>
        </div>
      )}
    </Card>
  )
}

function RiskPanel({ r }: { r: Any }) {
  const data = r.history.map((h: Any) => ({ date: fmtDate(h.date), value: h.value }))
  return (
    <Card title={`Корупційний ризик ${r.code}`}>
      <p>
        <b>{r.name}</b> · <Pill tone={RISK_TONE[r.level]}>{r.level}</Pill>
      </p>
      <p className="muted">
        {r.indicator}: базове {num(r.baseline)}, зараз <b>{num(r.current)}</b>, ціль {num(r.target)} {r.unit}
        {r.progress !== null && <> — пройдено <b>{Math.round(r.progress * 100)}%</b> шляху</>}.
      </p>
      <div style={{ height: 170 }}>
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid stroke={C.grid} />
            <XAxis dataKey="date" fontSize={11} stroke={C.muted} />
            <YAxis fontSize={11} stroke={C.muted} domain={['auto', 'auto']} />
            <Tooltip contentStyle={CHART_TOOLTIP_STYLE} itemStyle={CHART_ITEM_STYLE} labelStyle={CHART_LABEL_STYLE} />
            <ReferenceLine
              y={r.target}
              stroke={C.ok}
              strokeDasharray="4 4"
              label={{ value: 'ціль', fontSize: 11, fill: C.ok }}
            />
            <Line dataKey="value" stroke="#3b4fd8" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

function CommentsPanel({
  m,
  period,
  onDone,
  canComment,
}: {
  m: Any
  period: string
  onDone: () => void
  canComment: boolean
}) {
  const [t, setT] = useState('')
  const add = async () => {
    if (!t.trim()) return
    await api(`measures/${m.code}/comments`, { body: { text: t, period } })
    setT('')
    onDone()
  }
  return (
    <Card title="Коментарі та зауваження координатора">
      {m.comments.map((c: Any) => (
        <div key={c.id} className={`alert ${c.is_remark ? 'warning' : 'info'}`}>
          <small>
            <b>{c.author}</b> ({c.author_role}) · {fmtDateTime(c.created_at)}
            {c.is_remark && ' · зауваження'}
          </small>
          <br />
          {c.text}
        </div>
      ))}
      {!m.comments.length && <p className="muted">Коментарів немає.</p>}
      {canComment && (
        <div className="row comment-bar">
          <input
            style={{ flex: '1 1 160px' }}
            value={t}
            onChange={e => setT(e.target.value)}
            placeholder="Коментар…"
            onKeyDown={e => e.key === 'Enter' && add()}
          />
          <button type="button" className="btn secondary" onClick={add}>
            Додати
          </button>
        </div>
      )}
    </Card>
  )
}
