import { useState } from 'react'
import { Edit3, PlusCircle } from 'lucide-react'
import { api, fmtDate, type Any } from '../api'
import { useAuth } from '../auth'
import { Card, ErrorBox, Loading, Pill, useApi } from '../components/ui'
import { UnitModal } from '../components/UnitModal'

const SEVERITY_MAP: Record<string, { label: string; tone: 'bad' | 'warn' | 'info' | 'grey' }> = {
  high: { label: 'Високий', tone: 'bad' },
  medium: { label: 'Середній', tone: 'warn' },
  low: { label: 'Низький', tone: 'info' },
}

export default function Passport() {
  const { profile } = useAuth()
  const { data, error, reload } = useApi<Any>('program')
  const rules = useApi<Any>('rules')
  const units = useApi<Any[]>('units')
  const [unitModalOpen, setUnitModalOpen] = useState(false)
  const [editingUnit, setEditingUnit] = useState<Any | null>(null)

  if (error) return <ErrorBox msg={error} />
  if (!data) return <Loading />

  const canManage = profile?.role === 'KOORD' || profile?.role === 'ADMIN'
  const toggle = async () => {
    await api('program/update', { method: 'PATCH', body: { restricted_info: !data.restricted_info } })
    reload()
  }

  const handleUnitSaved = () => {
    units.reload()
    reload()
  }

  return <>
    <h1>Електронний паспорт програми</h1>
    <Card>
      <h2>{data.name}</h2>
      <dl className="kv">
        <dt>Орган</dt><dd>{data.organ}</dd>
        <dt>Строк дії</dt><dd>{fmtDate(data.period_start)} – {fmtDate(data.period_end)}</dd>
        <dt>Затверджено</dt><dd>{data.approved}</dd>
        <dt>Погодження НАЗК</dt><dd>{data.nazk_status}</dd>
        <dt>Координатор програми</dt><dd>{data.coordinator_unit?.code} {data.coordinator_unit?.name}</dd>
        <dt>Інформація з обмеженим доступом (ІзОД)</dt><dd>
          {data.restricted_info ? (
            <span>
              <span className="pill warn" style={{ marginRight: '.4rem' }}>Режим ІзОД активний</span>
              так — друкована форма / посилений аудит переглядів та вивантажень (SHA-256)
            </span>
          ) : (
            <span>ні — стандартний моніторинг (звіт заповнюється на Порталі НАЗК)</span>
          )}
          {canManage && <> <button className="btn secondary small" onClick={toggle} style={{ marginLeft: '.5rem' }}>змінити</button></>}</dd>
        <dt>Обсяг</dt><dd>{data.measures} заходів, {data.risks} корупційних ризиків</dd>
      </dl>
      <h3 style={{ marginTop: '1rem' }}>Цілі програми</h3><p>{data.goals}</p>
      <p><small className="muted">{data.note}</small></p>
    </Card>

    <Card title="Підрозділи-виконавці програми">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem', marginBottom: '1rem' }}>
        <p className="muted" style={{ margin: 0 }}>
          Структурні підрозділи органу, визначені відповідальними виконавцями та співвиконавцями антикорупційних заходів ({units.data?.length || 0}).
        </p>
        {canManage && (
          <button
            type="button"
            className="btn primary small"
            onClick={() => {
              setEditingUnit(null)
              setUnitModalOpen(true)
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '.35rem' }}
          >
            <PlusCircle size={15} />
            <span>Новий підрозділ</span>
          </button>
        )}
      </div>

      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              <th style={{ width: 80 }}>Код</th>
              <th>Найменування підрозділу</th>
              <th style={{ width: 140 }}>Категорія</th>
              <th style={{ width: 100, textAlign: 'center' }}>Заходів</th>
              {canManage && <th style={{ width: 100, textAlign: 'right' }}>Дії</th>}
            </tr>
          </thead>
          <tbody>
            {(units.data || []).map((u: Any) => (
              <tr key={u.code}>
                <td>
                  <b style={{ color: 'var(--primary)' }}>{u.code}</b>
                </td>
                <td>
                  <div>{u.name}</div>
                  {u.note && <small className="muted">{u.note}</small>}
                </td>
                <td>
                  {u.type ? <Pill tone="grey">{u.type}</Pill> : <span className="muted">—</span>}
                </td>
                <td style={{ textAlign: 'center' }}>
                  <Pill tone={u.measures_count > 0 ? 'neutral' : 'grey'}>
                    {u.measures_count ?? 0}
                  </Pill>
                </td>
                {canManage && (
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="btn secondary mini"
                      onClick={() => {
                        setEditingUnit(u)
                        setUnitModalOpen(true)
                      }}
                      title="Редагувати підрозділ"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem' }}
                    >
                      <Edit3 size={13} />
                      <span>Редагувати</span>
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {(!units.data || units.data.length === 0) && (
              <tr>
                <td colSpan={canManage ? 5 : 4} className="muted" style={{ textAlign: 'center', padding: '1.5rem' }}>
                  Підрозділів не знайдено.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>

    <Card title="Структура програми">
      <div className="table-wrap"><table className="t"><tbody>{data.sections.map((s: Any) => <tr key={s.code}><td style={{ width: 60 }}><b>{s.number}</b></td><td>{s.portal_name}</td><td>{s.measures} заходів</td></tr>)}</tbody></table></div>
    </Card>

    {rules.data && <Card title="Явні правила системи (rules.yaml)">
      <p className="muted">Пороги і формулювання можна змінити без програміста. Висновки з наслідками система робить лише за цими правилами (п. 4 Політики використання ШІ).</p>
      <div className="table-wrap"><table className="t"><thead><tr><th>Код</th><th>Сигнал</th><th>Правило</th><th>Важливість</th></tr></thead><tbody>
        {rules.data.flags.map((f: Any) => <tr key={f.code}>
          <td><b>{f.code}</b></td>
          <td>{f.title}</td>
          <td><small>{f.rule}</small></td>
          <td>
            {SEVERITY_MAP[f.severity] ? (
              <span className={`pill ${SEVERITY_MAP[f.severity].tone}`}>{SEVERITY_MAP[f.severity].label}</span>
            ) : (
              f.severity
            )}
          </td>
        </tr>)}
      </tbody></table></div>
      <h3 style={{ marginTop: '1rem' }}>Ризик невиконання заходу</h3>
      <ul>{Object.entries(rules.data.nonexecution_risk).filter(([k]) => k !== 'params').map(([k, v]: [string, Any]) =>
        <li key={k}>+{v.points} — {v.text.replace('{due_soon_days}', rules.data.nonexecution_risk.params.due_soon_days)}</li>)}</ul>
      <small className="muted">Рівень: 0 — низький, 1–2 — середній, ≥3 — високий.</small>
    </Card>}

    <UnitModal
      isOpen={unitModalOpen}
      onClose={() => {
        setUnitModalOpen(false)
        setEditingUnit(null)
      }}
      onSaved={handleUnitSaved}
      initialUnit={editingUnit}
    />
  </>
}
