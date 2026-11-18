import { useState } from 'react'
import { Link } from 'react-router-dom'
import { download, fmtDateTime, type Any } from '../api'
import { Card, ErrorBox, Loading, PageHead, useApi } from '../components/ui'
import { Eye, FileDown, Printer, KeyRound, CheckCircle, XCircle } from 'lucide-react'

const CATEGORIES = [
  { id: '', label: 'Усі події' },
  { id: 'changes', label: 'Лише зміни' },
  { id: 'views', label: 'Перегляди карток (ІзОД)' },
  { id: 'evidence', label: 'Завантаження Evidence' },
  { id: 'export', label: 'Експорт та друк' },
  { id: 'auth', label: 'Вхід / Вихід' },
]

function ActionBadge({ action }: { action: string }) {
  const act = (action || '').toLowerCase()
  if (act.includes('перегляд')) {
    return (
      <span className="pill info" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', whiteSpace: 'nowrap' }}>
        <Eye size={12} /> {action}
      </span>
    )
  }
  if (act.includes('завантаження підтвердного')) {
    return (
      <span className="pill warn" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', whiteSpace: 'nowrap' }}>
        <FileDown size={12} /> {action}
      </span>
    )
  }
  if (act.includes('експорт') || act.includes('друк')) {
    return (
      <span className="pill gold" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', whiteSpace: 'nowrap' }}>
        <Printer size={12} /> {action}
      </span>
    )
  }
  if (act.includes('погоджено') || act.includes('створено')) {
    return (
      <span className="pill ok" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', whiteSpace: 'nowrap' }}>
        <CheckCircle size={12} /> {action}
      </span>
    )
  }
  if (act.includes('відхилено') || act.includes('повернуто') || act.includes('невдала')) {
    return (
      <span className="pill bad" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', whiteSpace: 'nowrap' }}>
        <XCircle size={12} /> {action}
      </span>
    )
  }
  if (act.includes('вхід') || act.includes('вихід')) {
    return (
      <span className="pill grey" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', whiteSpace: 'nowrap' }}>
        <KeyRound size={12} /> {action}
      </span>
    )
  }
  return <span>{action}</span>
}

export default function Audit() {
  const emptyQ = { obj_id: '', actor: '', action: '', category: '' }
  const [q, setQ] = useState(emptyQ)
  const [applied, setApplied] = useState(emptyQ)
  const qs = new URLSearchParams(Object.entries(applied).filter(([, v]) => v) as [string, string][]).toString()
  const { data, error } = useApi<Any>(`audit?limit=300&${qs}`, [qs])
  const chain = useApi<Any>('audit/verify')

  if (error) return <ErrorBox msg={error} />
  const hasFilter = !!(applied.obj_id || applied.actor || applied.action || applied.category)

  const handleCategorySelect = (catId: string) => {
    const next = { ...applied, category: catId }
    setQ(prev => ({ ...prev, category: catId }))
    setApplied(next)
  }

  return (
    <>
      <PageHead title="Журнал дій">
        <button
          type="button"
          className="btn secondary"
          onClick={() => download(`audit/export${qs ? `?${qs}` : ''}`, 'zhurnal_dii.csv')}
        >
          Експорт CSV
        </button>
      </PageHead>

      {chain.data && (
        <div className={`alert ${chain.data.ok ? 'success' : 'danger'}`}>
          Ланцюжок хешів {chain.data.ok ? `цілісний: перевірено ${chain.data.checked} записів` : `ПОРУШЕНО на записі #${chain.data.broken_at}`}.
          Кожен запис містить SHA-256 попереднього, тож змінити чи видалити запис непомітно неможливо.
          У режимі ІзОД до ланцюжка також фіксуються перегляди карток заходів, вивантаження підтвердних файлів та експорт/друк звітів.
        </div>
      )}

      {/* Швидкі категорії аудиту */}
      <div className="tabs" style={{ marginBottom: '1rem' }}>
        {CATEGORIES.map(c => (
          <button
            key={c.id}
            type="button"
            className={applied.category === c.id ? 'active' : ''}
            onClick={() => handleCategorySelect(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <Card>
        <form
          className="filter-bar"
          onSubmit={e => {
            e.preventDefault()
            setApplied(q)
          }}
        >
          <input
            placeholder="Обʼєкт (Z-17, E-001…)"
            value={q.obj_id}
            onChange={e => setQ({ ...q, obj_id: e.target.value })}
          />
          <input
            placeholder="Користувач (U-002)"
            value={q.actor}
            onChange={e => setQ({ ...q, actor: e.target.value })}
          />
          <input
            placeholder="Дія містить…"
            value={q.action}
            onChange={e => setQ({ ...q, action: e.target.value })}
          />
          <button type="submit" className="btn">
            Фільтрувати
          </button>
          {hasFilter && (
            <button
              type="button"
              className="btn secondary small"
              onClick={() => {
                setQ(emptyQ)
                setApplied(emptyQ)
              }}
            >
              Скинути
            </button>
          )}
          {data && (
            <span className="muted" style={{ marginLeft: 'auto' }}>
              записів: <b>{data.total}</b>
            </span>
          )}
        </form>
      </Card>

      {!data ? (
        <Loading />
      ) : (
        <Card>
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th style={{ width: 52 }}>#</th>
                  <th>Час</th>
                  <th>Хто</th>
                  <th>Дія</th>
                  <th>Обʼєкт</th>
                  <th>Поле</th>
                  <th>Було → стало</th>
                  <th>Хеш (SHA-256)</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((a: Any) => (
                  <tr key={a.id}>
                    <td className="nowrap">{a.id}</td>
                    <td className="nowrap">
                      <small>{fmtDateTime(a.ts)}</small>
                    </td>
                    <td className="nowrap">
                      <small>
                        <b>{a.actor || '—'}</b>
                        {a.actor_role && (
                          <>
                            <br />
                            <span className="muted">{a.actor_role}</span>
                          </>
                        )}
                      </small>
                    </td>
                    <td>
                      <ActionBadge action={a.action} />
                    </td>
                    <td className="nowrap">
                      {String(a.obj_id || '').startsWith('Z-') ? (
                        <Link to={`/program/measures/${a.obj_id}`}>{a.obj_id}</Link>
                      ) : (
                        a.obj_id
                      )}
                      <br />
                      <small className="muted">{a.obj_type}</small>
                    </td>
                    <td>{a.field ? <code>{a.field}</code> : <span className="muted">—</span>}</td>
                    <td style={{ minWidth: 180, maxWidth: 360 }}>
                      <small>
                        {a.old && <s>{a.old.slice(0, 100)}</s>}
                        {a.old && ' → '}
                        {a.new.slice(0, 140)}
                      </small>
                    </td>
                    <td className="nowrap">
                      <span className="hash" title={`Повний хеш: ${a.hash}\nПопередній: ${a.prev_hash}`}>
                        {a.hash.slice(0, 12)}…
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  )
}
