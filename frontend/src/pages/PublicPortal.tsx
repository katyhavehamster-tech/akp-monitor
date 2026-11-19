import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  FileCheck, LogIn, Moon, Search, ShieldCheck, Sun, X,
} from 'lucide-react'
import { api, fmtDate, num, type Any } from '../api'
import { Emblem, useTheme } from '../components/Layout'
import { Loading, Pill } from '../components/ui'

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
    <div className="public-portal-root">
      {/* Шапка порталу */}
      <header className="public-portal-header">
        <div className="public-portal-header-inner">
          <div className="public-portal-brand">
            <Emblem size={38} className="public-portal-logo" />
            <div className="public-portal-brand-text">
              <div className="public-portal-brand-title">
                <span>АКП-Монітор</span>
                <span className="brand-badge">ХНУВС</span>
                <span className="pill ok" style={{ fontSize: '.72rem', padding: '1px 7px' }}>
                  Публічний портал
                </span>
              </div>
              <div className="public-portal-brand-sub">
                Відкритий моніторинг виконання антикорупційної програми
              </div>
            </div>
          </div>

          <div className="public-portal-header-tools">
            <Link
              to="/verify"
              className="btn secondary small"
              title="Перевірка електронного зліпка звіту НАЗК за ДСТУ 4163:2020"
            >
              <ShieldCheck size={14} />
              <span>Верифікація звіту</span>
            </Link>

            <Link
              to="/login"
              className="btn primary small"
              title="Вхід до системи для виконавців та координаторів"
            >
              <LogIn size={14} />
              <span>Кабінет</span>
            </Link>

            <button
              type="button"
              className="btn secondary small icon"
              onClick={toggleTheme}
              title={theme === 'light' ? 'Увімкнути темну тему' : 'Увімкнути світлу тему'}
              aria-label="Перемкнути тему"
            >
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
          </div>
        </div>
      </header>

      {/* Основний вміст */}
      <main className="public-portal-main">
        {/* Hero banner */}
        <div className="public-portal-hero">
          <div className="public-portal-hero-head">
            <div>
              <span className="public-portal-hero-kicker">
                Громадський контроль та прозорість
              </span>
              <h1 className="public-portal-hero-title">
                {data?.program?.title || 'Антикорупційна програма органу сектору безпеки і оборони'}
              </h1>
              <p className="public-portal-hero-desc">
                Офіційний електронний реєстр заходів, планових індикаторів та фактичного опису результатів їх виконання.
                {data?.program?.approved ? ` Затверджено: ${data.program.approved}.` : ''}
              </p>
            </div>
            {data?.period && (
              <div className="public-portal-period-badge">
                <div className="public-portal-period-label">
                  Звітний період
                </div>
                <div className="public-portal-period-val">{data.period}</div>
              </div>
            )}
          </div>

          {/* Плашки статистики */}
          {!data?.restricted && items.length > 0 && (
            <div className="public-portal-stats">
              <div className="public-portal-stat-box">
                <div className="public-portal-stat-lbl">Усього заходів</div>
                <div className="public-portal-stat-num">{stats.total}</div>
              </div>
              <div className="public-portal-stat-box ok">
                <div className="public-portal-stat-lbl">Виконано</div>
                <div className="public-portal-stat-num">{stats.done}</div>
              </div>
              <div className="public-portal-stat-box progress">
                <div className="public-portal-stat-lbl">У роботі / частково</div>
                <div className="public-portal-stat-num">{stats.inProgress}</div>
              </div>
              <div className="public-portal-stat-box">
                <div className="public-portal-stat-lbl">Строк не настав</div>
                <div className="public-portal-stat-num">{stats.notDue}</div>
              </div>
            </div>
          )}
        </div>

        {/* Обробка стану завантаження та помилок */}
        {loading && <Loading />}
        {err && <div className="alert danger">{err}</div>}

        {/* Режим обмеженого доступу ІзОД / ДСК */}
        {!loading && data?.restricted && (
          <div className="card" style={{ padding: '2rem 1.5rem', textAlign: 'center', marginBottom: '1.5rem' }}>
            <div style={{ display: 'inline-flex', padding: '.75rem', borderRadius: '50%', background: 'var(--warn-bg)', color: 'var(--warn)', marginBottom: '1rem' }}>
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
            <div className="public-portal-filters">
              <div className="public-portal-search-wrap">
                <Search size={15} className="public-portal-search-icon" />
                <input
                  type="text"
                  placeholder="Шукати за змістом, кодом або описом виконання…"
                  value={q}
                  onChange={e => setQ(e.target.value)}
                />
                {q && (
                  <button
                    type="button"
                    className="public-portal-search-clear"
                    onClick={() => setQ('')}
                    aria-label="Очистити пошук"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <select
                className="public-portal-filter-select"
                value={sectionFilter}
                onChange={e => setSectionFilter(e.target.value)}
                aria-label="Фільтр за розділом"
              >
                <option value="">Усі розділи</option>
                <option value="R1">Розділ 1 — Загальна політика</option>
                <option value="R2">Розділ 2 — Усунення ризиків</option>
                <option value="R3">Розділ 3 — Навчання</option>
              </select>

              <select
                className="public-portal-filter-select"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                aria-label="Фільтр за станом виконання"
              >
                <option value="">Усі стани виконання</option>
                <option value="vykonano">Виконано</option>
                <option value="v_roboti">У роботі</option>
                <option value="chastkovo">Частково виконано</option>
                <option value="ne_rozpochato">Не розпочато / строк не настав</option>
                <option value="ne_vykonano">Не виконано</option>
              </select>

              <div className="public-portal-count">
                Відображено: <b>{filteredItems.length}</b> із <b>{items.length}</b>
              </div>
            </div>

            {/* Список карток заходів із розгорнутим описом */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {filteredItems.map(item => {
                const statusTone =
                  item.status === 'vykonano'
                    ? 'ok'
                    : item.status === 'ne_vykonano'
                    ? 'bad'
                    : item.status === 'chastkovo' || item.status === 'v_roboti'
                    ? 'warn'
                    : 'grey'
                const displayStatus = item.status_name || item.portal_state

                return (
                  <div key={item.code} className="public-portal-card">
                    {/* Рядок заголовка: код і розділ ліворуч, статус чітко праворуч */}
                    <div className="public-portal-card-head">
                      <div className="public-portal-card-title-group">
                        <b className="public-portal-code">{item.code}</b>
                        <span className="public-portal-section-badge">
                          {item.section_name || item.section}
                        </span>
                      </div>

                      <div className="public-portal-card-status">
                        <Pill tone={statusTone}>
                          {displayStatus}
                        </Pill>
                      </div>
                    </div>

                    {/* Підрозділ-виконавець на окремому рядку */}
                    <div className="public-portal-unit-row">
                      <span className="muted">Відповідальний виконавець: </span>
                      <b>{item.unit?.name || item.unit?.code}</b>
                    </div>

                    {/* Плановий зміст */}
                    <div className="public-portal-planned">
                      <div className="public-portal-label">
                        Плановий зміст заходу та очікуваний результат:
                      </div>
                      <p className="public-portal-text">{item.content}</p>
                    </div>

                    {/* Фактичний опис виконання */}
                    <div className="public-portal-execution-box">
                      <div className="public-portal-exec-label">
                        Фактичний стан та опис виконання заходу:
                      </div>
                      {item.result_text ? (
                        <p className="public-portal-exec-text">
                          {item.result_text}
                        </p>
                      ) : (
                        <p className="public-portal-exec-empty">
                          Звітний опис виконання за поточний період ще опрацьовується або строк виконання заходу не настав.
                        </p>
                      )}
                    </div>

                    {/* Метадані заходу */}
                    <div className="public-portal-meta-row">
                      <div>
                        <span className="muted">Строк виконання: </span>
                        <b>{item.strok_text}</b>
                        {item.fact_date && <span> (факт: {fmtDate(item.fact_date)})</span>}
                      </div>
                      {item.indicator && (
                        <div>
                          <span className="muted">Індикатор: </span>
                          <span>{item.indicator}</span>
                          {item.indicator_target !== null && (
                            <span>
                              {' '}
                              (ціль: <b>{num(item.indicator_target)} {item.indicator_unit}</b>
                              {item.indicator_fact !== null && item.indicator_fact !== undefined
                                ? `, факт: ${num(item.indicator_fact)}`
                                : ''}
                              )
                            </span>
                          )}
                        </div>
                      )}
                      {item.evidence_count > 0 && (
                        <div>
                          <span className="muted">Підтвердних матеріалів: </span>
                          <b>{item.evidence_count}</b>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

              {filteredItems.length === 0 && (
                <div className="card" style={{ padding: '2.5rem 1rem', textAlign: 'center' }}>
                  <p className="muted" style={{ margin: 0 }}>
                    За вказаними критеріями заходів не знайдено.
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* Підвал порталу */}
      <footer className="public-portal-footer">
        <div className="public-portal-footer-inner">
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
