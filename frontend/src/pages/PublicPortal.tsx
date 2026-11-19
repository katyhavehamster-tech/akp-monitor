import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  FileCheck, LogIn, Moon, Search, ShieldCheck, Sun, X,
} from 'lucide-react'
import { api, fmtDate, num, type Any } from '../api'
import { Emblem, useTheme } from '../components/Layout'
import { Loading, Pill, PORTAL_TONE } from '../components/ui'

export default function PublicPortal() {
  const { theme, toggleTheme } = useTheme()
  const [data, setData] = useState<Any | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [q, setQ] = useState('')
  const [sectionFilter, setSectionFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    api<Any>('public/measures')
      .then(res => {
        if (active) setData(res)
      })
      .catch(e => {
        if (active) setErr((e as Error).message || 'Помилка завантаження даних публічного порталу.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const items: Any[] = useMemo(() => data?.items || [], [data])

  const stats = useMemo(() => {
    const total = items.length
    const done = items.filter(i => i.status === 'vykonano').length
    const inProgress = items.filter(i => ['v_roboti', 'chastkovo'].includes(i.status)).length
    const notDue = items.filter(i => i.status === 'ne_rozpochato').length
    return { total, done, inProgress, notDue }
  }, [items])

  const filteredItems = useMemo(() => {
    return items.filter(i => {
      if (sectionFilter && i.section !== sectionFilter) return false
      if (statusFilter && i.status !== statusFilter) return false
      if (q) {
        const needle = q.toLowerCase()
        const text = [
          i.code,
          i.content,
          i.unit?.code,
          i.unit?.name,
          i.result_text,
          i.indicator,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!text.includes(needle)) return false
      }
      return true
    })
  }, [items, sectionFilter, statusFilter, q])

  return (
    <div
      className="public-portal-root"
      style={{
        minHeight: '100vh',
        background: 'var(--bg, #0b0f19)',
        color: 'var(--ink, #f3f4f6)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Шапка порталу */}
      <header
        style={{
          borderBottom: '1px solid var(--border, rgba(255,255,255,0.08))',
          background: 'var(--card-bg, #111827)',
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}
      >
        <div
          style={{
            maxWidth: '1240px',
            margin: '0 auto',
            padding: '0.65rem 1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Emblem size={38} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
                <b style={{ fontSize: '1rem', letterSpacing: '-0.01em' }}>АКП-Монітор</b>
                <span
                  style={{
                    fontSize: '.72rem',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    background: 'var(--card-subtle, rgba(255,255,255,0.07))',
                    color: 'var(--muted)',
                  }}
                >
                  ХНУВС
                </span>
                <span
                  style={{
                    fontSize: '.72rem',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    background: 'rgba(34, 197, 94, 0.15)',
                    color: '#4ade80',
                    fontWeight: 600,
                  }}
                >
                  Публічний портал
                </span>
              </div>
              <div className="muted" style={{ fontSize: '.76rem' }}>
                Відкритий моніторинг виконання антикорупційної програми
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
            <Link
              to="/verify"
              className="btn secondary small"
              title="Перевірка електронного зліпка звіту НАЗК за ДСТУ 4163:2020"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.82rem' }}
            >
              <ShieldCheck size={14} />
              <span>Верифікація звіту</span>
            </Link>

            <Link
              to="/login"
              className="btn primary small"
              title="Вхід до системи для виконавців та координаторів"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.82rem' }}
            >
              <LogIn size={14} />
              <span>Кабінет</span>
            </Link>

            <button
              type="button"
              className="btn ghost icon small"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Увімкнути світлу тему' : 'Увімкнути темну тему'}
              aria-label="Перемикач теми"
              style={{ padding: '6px' }}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>
      </header>

      {/* Основний вміст */}
      <main style={{ flex: 1, maxWidth: '1240px', width: '100%', margin: '0 auto', padding: '1.25rem 1rem', boxSizing: 'border-box' }}>
        {/* Hero banner */}
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(30, 58, 138, 0.22) 0%, rgba(17, 24, 39, 0.8) 100%)',
            border: '1px solid var(--border, rgba(255,255,255,0.08))',
            borderRadius: '12px',
            padding: '1.25rem 1.5rem',
            marginBottom: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <span
                style={{
                  fontSize: '.75rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--primary, #60a5fa)',
                  fontWeight: 700,
                  display: 'block',
                  marginBottom: '.25rem',
                }}
              >
                Громадський контроль та прозорість
              </span>
              <h1 style={{ margin: '0 0 .4rem 0', fontSize: '1.45rem', lineHeight: 1.3 }}>
                {data?.program?.title || 'Антикорупційна програма органу сектору безпеки і оборони'}
              </h1>
              <p className="muted" style={{ margin: 0, fontSize: '.88rem', maxWidth: '820px', lineHeight: 1.5 }}>
                Офіційний електронний реєстр заходів, планових індикаторів та фактичного опису результатів їх виконання.
                {data?.program?.approved ? ` Затверджено: ${data.program.approved}.` : ''}
              </p>
            </div>
            {data?.period && (
              <div
                style={{
                  padding: '.5rem .85rem',
                  borderRadius: '8px',
                  background: 'var(--card-bg, #1f2937)',
                  border: '1px solid var(--border, rgba(255,255,255,0.1))',
                  textAlign: 'right',
                }}
              >
                <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase' }}>
                  Звітний період
                </div>
                <b style={{ fontSize: '1.1rem', color: 'var(--primary, #60a5fa)' }}>{data.period}</b>
              </div>
            )}
          </div>

          {/* Плашки статистики */}
          {!data?.restricted && items.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: '.75rem',
                marginTop: '1.25rem',
              }}
            >
              <div style={{ padding: '.65rem .85rem', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="muted" style={{ fontSize: '.75rem' }}>Усього заходів</div>
                <b style={{ fontSize: '1.3rem' }}>{stats.total}</b>
              </div>
              <div style={{ padding: '.65rem .85rem', borderRadius: '8px', background: 'rgba(34, 197, 94, 0.06)', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
                <div style={{ fontSize: '.75rem', color: '#4ade80' }}>Виконано</div>
                <b style={{ fontSize: '1.3rem', color: '#4ade80' }}>{stats.done}</b>
              </div>
              <div style={{ padding: '.65rem .85rem', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.06)', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                <div style={{ fontSize: '.75rem', color: '#60a5fa' }}>У роботі / частково</div>
                <b style={{ fontSize: '1.3rem', color: '#60a5fa' }}>{stats.inProgress}</b>
              </div>
              <div style={{ padding: '.65rem .85rem', borderRadius: '8px', background: 'rgba(156, 163, 175, 0.06)', border: '1px solid rgba(156, 163, 175, 0.2)' }}>
                <div className="muted" style={{ fontSize: '.75rem' }}>Строк не настав</div>
                <b style={{ fontSize: '1.3rem' }}>{stats.notDue}</b>
              </div>
            </div>
          )}
        </div>

        {/* Обробка стану завантаження та помилок */}
        {loading && <Loading />}
        {err && <div className="alert danger">{err}</div>}

        {/* Режим обмеженого доступу ІзОД / ДСК */}
        {!loading && data?.restricted && (
          <div
            style={{
              padding: '2rem 1.5rem',
              borderRadius: '12px',
              background: 'rgba(234, 179, 8, 0.06)',
              border: '1px solid rgba(234, 179, 8, 0.3)',
              marginBottom: '1.5rem',
              textAlign: 'center',
            }}
          >
            <div style={{ display: 'inline-flex', padding: '.75rem', borderRadius: '50%', background: 'rgba(234, 179, 8, 0.15)', color: '#eab308', marginBottom: '1rem' }}>
              <FileCheck size={36} />
            </div>
            <h2 style={{ margin: '0 0 .5rem 0', fontSize: '1.25rem' }}>
              Інформація з обмеженим доступом (ІзОД / ДСК)
            </h2>
            <p style={{ maxWidth: '640px', margin: '0 auto 1.25rem auto', lineHeight: 1.5, fontSize: '.92rem' }} className="muted">
              {data.message || 'Антикорупційна програма містить інформацію з обмеженим доступом. Публікація деталізованого оперативного змісту та результатів виконання заходів обмежена відповідно до чинного законодавства України.'}
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
              <Link to="/verify" className="btn secondary small">
                Перевірити офіційний зліпок звіту
              </Link>
              <Link to="/login" className="btn primary small">
                Авторизуватися як виконавець / координатор
              </Link>
            </div>
          </div>
        )}

        {/* Фільтри та перелік заходів при відкритому доступі */}
        {!loading && !data?.restricted && (
          <>
            {/* Панель пошуку і фільтрів */}
            <div
              style={{
                background: 'var(--card-bg, #111827)',
                border: '1px solid var(--border, rgba(255,255,255,0.08))',
                borderRadius: '10px',
                padding: '.85rem 1rem',
                marginBottom: '1.25rem',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '.75rem',
                alignItems: 'center',
              }}
            >
              <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '180px' }}>
                <Search
                  size={15}
                  className="muted"
                  style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }}
                />
                <input
                  type="text"
                  placeholder="Шукати за змістом, кодом або описом виконання…"
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  style={{
                    width: '100%',
                    paddingLeft: '32px',
                    paddingRight: q ? '30px' : '10px',
                    boxSizing: 'border-box',
                    fontSize: '.88rem',
                  }}
                />
                {q && (
                  <button
                    type="button"
                    onClick={() => setQ('')}
                    style={{
                      position: 'absolute',
                      right: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--muted)',
                      cursor: 'pointer',
                      padding: 2,
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <select
                value={sectionFilter}
                onChange={e => setSectionFilter(e.target.value)}
                style={{ flex: '0 1 180px', minWidth: '130px', fontSize: '.88rem' }}
              >
                <option value="">Усі розділи</option>
                <option value="R1">Розділ 1 — Загальна політика</option>
                <option value="R2">Розділ 2 — Усунення ризиків</option>
                <option value="R3">Розділ 3 — Навчання</option>
              </select>

              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                style={{ flex: '0 1 180px', minWidth: '130px', fontSize: '.88rem' }}
              >
                <option value="">Усі стани виконання</option>
                <option value="vykonano">Виконано</option>
                <option value="v_roboti">У роботі</option>
                <option value="chastkovo">Частково виконано</option>
                <option value="ne_rozpochato">Не розпочато / строк не настав</option>
                <option value="ne_vykonano">Не виконано</option>
              </select>

              <div style={{ marginLeft: 'auto', fontSize: '.82rem' }} className="muted">
                Відображено: <b>{filteredItems.length}</b> із <b>{items.length}</b>
              </div>
            </div>

            {/* Список карток заходів із розгорнутим описом */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {filteredItems.map(item => (
                <div
                  key={item.code}
                  style={{
                    background: 'var(--card-bg, #111827)',
                    border: '1px solid var(--border, rgba(255,255,255,0.08))',
                    borderRadius: '10px',
                    padding: '1rem 1.15rem',
                      boxSizing: 'border-box',
                    }}
                  >
                    {/* Рядок заголовка */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '.5rem', marginBottom: '.4rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                        <b style={{ color: 'var(--primary, #60a5fa)', fontSize: '1.05rem' }}>{item.code}</b>
                        <span
                          style={{
                            fontSize: '.75rem',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            background: 'rgba(255,255,255,0.05)',
                            color: 'var(--muted)',
                          }}
                        >
                          {item.section_name || item.section}
                        </span>
                        <span style={{ fontSize: '.82rem', color: 'var(--muted)' }}>
                          Відповідальний: <b style={{ color: 'var(--ink)' }}>{item.unit?.name || item.unit?.code}</b>
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
                        <Pill tone={PORTAL_TONE[item.portal_state] || 'neutral'}>
                          {item.portal_state}
                        </Pill>
                        <Pill tone={item.status === 'vykonano' ? 'ok' : item.status === 'ne_vykonano' ? 'bad' : 'neutral'}>
                          {item.status_name}
                        </Pill>
                      </div>
                    </div>

                    {/* Плановий зміст */}
                    <div style={{ marginBottom: '.65rem' }}>
                      <div style={{ fontSize: '.78rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted)', fontWeight: 600, marginBottom: '.15rem' }}>
                        Плановий зміст заходу та очікуваний результат:
                      </div>
                      <p style={{ margin: 0, fontSize: '.95rem', lineHeight: 1.45 }}>{item.content}</p>
                    </div>

                    {/* Фактичний опис виконання */}
                    <div
                      style={{
                        padding: '.75rem .9rem',
                        borderRadius: '6px',
                        background: 'var(--card-subtle, rgba(255, 255, 255, 0.03))',
                        borderLeft: item.result_text ? '3px solid var(--primary, #3b82f6)' : '3px solid rgba(255,255,255,0.1)',
                        marginBottom: '.65rem',
                      }}
                    >
                      <div style={{ fontSize: '.8rem', fontWeight: 700, color: item.result_text ? 'var(--primary, #60a5fa)' : 'var(--muted)', marginBottom: '.25rem' }}>
                        Фактичний стан та опис виконання заходу:
                      </div>
                      {item.result_text ? (
                        <p style={{ margin: 0, fontSize: '.9rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', color: 'var(--ink)' }}>
                          {item.result_text}
                        </p>
                      ) : (
                        <p className="muted" style={{ margin: 0, fontSize: '.84rem', fontStyle: 'italic' }}>
                          Звітний опис виконання за поточний період ще опрацьовується або строк виконання заходу не настав.
                        </p>
                      )}
                    </div>

                    {/* Метадані заходу */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', fontSize: '.8rem', color: 'var(--muted)', paddingTop: '.35rem', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      <div>
                        Строк виконання: <b style={{ color: 'var(--ink)' }}>{item.strok_text}</b>
                        {item.fact_date && <> (факт: {fmtDate(item.fact_date)})</>}
                      </div>
                      {item.indicator && (
                        <div>
                          Індикатор: <span style={{ color: 'var(--ink)' }}>{item.indicator}</span>
                          {item.indicator_target !== null && (
                            <> (ціль: <b>{num(item.indicator_target)} {item.indicator_unit}</b>{item.indicator_fact !== null && item.indicator_fact !== undefined ? `, факт: ${num(item.indicator_fact)}` : ''})</>
                          )}
                        </div>
                      )}
                      {item.evidence_count > 0 && (
                        <div>
                          Підтвердних матеріалів: <b style={{ color: 'var(--ink)' }}>{item.evidence_count}</b>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

              {filteredItems.length === 0 && (
                <div
                  style={{
                    padding: '2.5rem 1rem',
                    textAlign: 'center',
                    background: 'var(--card-bg, #111827)',
                    borderRadius: '10px',
                    border: '1px solid var(--border, rgba(255,255,255,0.08))',
                  }}
                  className="muted"
                >
                  За вказаними критеріями заходів не знайдено.
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* Підвал порталу */}
      <footer
        style={{
          borderTop: '1px solid var(--border, rgba(255,255,255,0.08))',
          background: 'var(--card-bg, #111827)',
          padding: '1.25rem 1rem',
          marginTop: '2rem',
        }}
      >
        <div
          style={{
            maxWidth: '1240px',
            margin: '0 auto',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem',
            fontSize: '.82rem',
          }}
          className="muted"
        >
          <div>
            АКП-Монітор · Харківський національний університет внутрішніх справ · Сектор з питань запобігання корупції
          </div>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <Link to="/verify" style={{ color: 'var(--muted)', textDecoration: 'underline' }}>
              Перевірка автентичності звіту
            </Link>
            <Link to="/login" style={{ color: 'var(--muted)', textDecoration: 'underline' }}>
              Вхід для уповноважених осіб
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
