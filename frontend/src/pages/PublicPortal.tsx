import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BarChart3, CalendarDays, FileCheck, LogIn, Moon, PieChart as PieChartIcon, Search, ShieldCheck, Sun, X,
} from 'lucide-react'
import {
  Bar as RBar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api, fmtDate, num, type Any } from '../api'
import { Emblem, useTheme } from '../components/Layout'
import {
  CHART_ITEM_STYLE, CHART_LABEL_STYLE, CHART_TOOLTIP_STYLE, Loading, Pill,
} from '../components/ui'

const DEFAULT_SECTION_INFO: Record<string, { number: number; name: string }> = {
  R1: {
    number: 1,
    name: 'Заходи з реалізації засад загальної відомчої політики, виконання антикорупційної стратегії та державної антикорупційної програми',
  },
  R2: {
    number: 2,
    name: 'Заходи з усунення корупційних ризиків',
  },
  R3: {
    number: 3,
    name: 'Навчання та заходи з поширення антикорупційної інформації',
  },
}

export default function PublicPortal() {
  const { theme, toggleTheme } = useTheme()
  const [data, setData] = useState<Any | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [selectedPeriod, setSelectedPeriod] = useState<string>('')
  const [q, setQ] = useState('')
  const [sectionFilter, setSectionFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    const qp = selectedPeriod ? `?period=${encodeURIComponent(selectedPeriod)}` : ''
    api<Any>(`public/measures${qp}`)
      .then(res => {
        if (active) {
          setData(res)
          if (!selectedPeriod && res?.period) {
            setSelectedPeriod(res.period)
          }
        }
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
  }, [selectedPeriod])

  const items: Any[] = useMemo(() => data?.items || [], [data])

  const stats = useMemo(() => {
    const total = items.length
    const done = items.filter(i => i.status === 'vykonano').length
    const inProgress = items.filter(i => ['v_roboti', 'chastkovo'].includes(i.status)).length
    const notDue = items.filter(i => i.status === 'ne_rozpochato').length
    const failed = items.filter(i => i.status === 'ne_vykonano').length

    let doneOnTime = data?.monitoring?.counts?.done_on_time
    let doneLate = data?.monitoring?.counts?.done_late
    let onTimePct = data?.monitoring?.percent?.on_time_of_dated_done

    if (doneOnTime === undefined || onTimePct === undefined) {
      const datedDone = items.filter(i => i.status === 'vykonano' && i.strok_type === 'data' && i.fact_date)
      doneOnTime = datedDone.filter(i => i.strok_date && i.fact_date <= i.strok_date).length
      doneLate = datedDone.length - doneOnTime
      onTimePct = datedDone.length > 0 ? Number((100 * doneOnTime / datedDone.length).toFixed(1)) : null
    }

    return { total, done, inProgress, notDue, failed, doneOnTime, doneLate, onTimePct }
  }, [items, data?.monitoring])

  const statusChartData = useMemo(() => {
    const total = items.length
    if (!total) return []
    const done = items.filter(i => i.status === 'vykonano').length
    const inProgress = items.filter(i => ['v_roboti', 'chastkovo'].includes(i.status)).length
    const notDue = items.filter(i => i.status === 'ne_rozpochato').length
    const failed = items.filter(i => i.status === 'ne_vykonano').length

    return [
      { key: 'vykonano', name: 'Виконано', value: done, color: '#16a34a', percent: Math.round((done / total) * 100) },
      { key: 'v_roboti', name: 'У роботі / частково', value: inProgress, color: '#2563eb', percent: Math.round((inProgress / total) * 100) },
      { key: 'ne_rozpochato', name: 'Строк не настав', value: notDue, color: '#64748b', percent: Math.round((notDue / total) * 100) },
      { key: 'ne_vykonano', name: 'Не виконано', value: failed, color: '#dc2626', percent: Math.round((failed / total) * 100) },
    ].filter(d => d.value > 0)
  }, [items])

  const sectionChartData = useMemo(() => {
    if (!items.length) return []
    const secMap: Record<string, {
      code: string
      number: number
      name: string
      shortName: string
      fullName: string
      total: number
      done: number
      inProgress: number
      notDue: number
      failed: number
    }> = {}

    // Ініціалізація з API (data.sections) або довідника програми
    const knownSections = (data?.sections && data.sections.length > 0)
      ? data.sections
      : Object.entries(DEFAULT_SECTION_INFO).map(([code, info]) => ({
          code,
          number: info.number,
          name: info.name,
        }))

    knownSections.forEach((s: Any) => {
      const num = s.number || parseInt(String(s.code).replace(/\D/g, ''), 10) || 1
      const secName = s.name || DEFAULT_SECTION_INFO[s.code]?.name || s.code
      secMap[s.code] = {
        code: s.code,
        number: num,
        name: secName,
        shortName: `Розділ ${num}`,
        fullName: `Розділ ${num} (${secName})`,
        total: 0,
        done: 0,
        inProgress: 0,
        notDue: 0,
        failed: 0,
      }
    })

    items.forEach(i => {
      const code = i.section || 'R1'
      if (!secMap[code]) {
        const num = parseInt(String(code).replace(/\D/g, ''), 10) || 1
        const secName = i.section_name || DEFAULT_SECTION_INFO[code]?.name || code
        secMap[code] = {
          code,
          number: num,
          name: secName,
          shortName: `Розділ ${num}`,
          fullName: `Розділ ${num} (${secName})`,
          total: 0,
          done: 0,
          inProgress: 0,
          notDue: 0,
          failed: 0,
        }
      }
      secMap[code].total += 1
      if (i.status === 'vykonano') secMap[code].done += 1
      else if (['v_roboti', 'chastkovo'].includes(i.status)) secMap[code].inProgress += 1
      else if (i.status === 'ne_rozpochato') secMap[code].notDue += 1
      else if (i.status === 'ne_vykonano') secMap[code].failed += 1
    })

    return Object.values(secMap).sort((a, b) => a.number - b.number).map(s => ({
      ...s,
      percentDone: s.total > 0 ? Math.round((s.done / s.total) * 100) : 0,
    }))
  }, [items, data?.sections])

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
            <Emblem size={36} className="public-portal-logo" />
            <div className="public-portal-brand-text">
              <div className="public-portal-brand-title">
                <span className="public-portal-brand-name">АКП-Монітор</span>
                <span className="brand-badge">ХНУВС</span>
                <span className="pill ok public-portal-pill-desktop">
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
              className="btn secondary small public-portal-tool-btn"
              title="Перевірка електронного зліпка звіту НАЗК за ДСТУ 4163:2020"
              aria-label="Верифікація звіту"
            >
              <ShieldCheck size={15} className="public-portal-tool-icon" />
              <span className="public-portal-btn-label">
                <span className="public-portal-btn-label-desktop">Верифікація</span>
                <span className="public-portal-btn-label-extra"> звіту</span>
              </span>
            </Link>

            <Link
              to="/login"
              className="btn primary small public-portal-tool-btn"
              title="Вхід до системи для виконавців та координаторів"
              aria-label="Вхід до кабінету"
            >
              <LogIn size={15} className="public-portal-tool-icon" />
              <span className="public-portal-btn-label">
                <span className="public-portal-cabinet-label">Кабінет</span>
              </span>
            </Link>

            <button
              type="button"
              className="btn secondary small icon public-portal-theme-btn"
              onClick={toggleTheme}
              title={theme === 'light' ? 'Увімкнути темну тему' : 'Увімкнути світлу тему'}
              aria-label="Перемкнути тему"
            >
              {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
            </button>
          </div>
        </div>
      </header>

      {/* Основний вміст */}
      <main className="public-portal-main">
        {/* Hero banner */}
        <div className="public-portal-hero">
          <div className="public-portal-hero-head">
            <div className="public-portal-hero-text">
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

            {/* Гарно оформлений інтерактивний блок вибору звітного періоду */}
            <div className="public-portal-period-widget">
              <div className="public-portal-period-widget-label">
                <CalendarDays size={14} className="public-portal-period-icon" />
                <span>Звітний період</span>
              </div>
              <div className="public-portal-period-select-wrap">
                <select
                  className="public-portal-period-select"
                  value={selectedPeriod || data?.period || ''}
                  onChange={e => setSelectedPeriod(e.target.value)}
                  aria-label="Оберіть звітний період"
                >
                  {(data?.periods || (data?.period ? [{ code: data.period, quarter: data.period.split('-Q')[1] || 1, year: data.period.split('-')[0] || 2026 }] : [])).map((p: Any) => (
                    <option key={p.code} value={p.code}>
                      {p.code} ({p.quarter} кв. {p.year})
                    </option>
                  ))}
                </select>
              </div>
            </div>
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
              <div className="public-portal-stat-box ok">
                <div className="public-portal-stat-lbl">Виконано вчасно</div>
                <div className="public-portal-stat-num">
                  {stats.onTimePct !== null && stats.onTimePct !== undefined ? `${stats.onTimePct}%` : '—'}
                </div>
              </div>
              <div className="public-portal-stat-box progress">
                <div className="public-portal-stat-lbl">У роботі / частково</div>
                <div className="public-portal-stat-num">{stats.inProgress}</div>
              </div>
              <div className="public-portal-stat-box">
                <div className="public-portal-stat-lbl">Строк не настав</div>
                <div className="public-portal-stat-num">{stats.notDue}</div>
              </div>
              <div className="public-portal-stat-box bad">
                <div className="public-portal-stat-lbl">Не виконано</div>
                <div className="public-portal-stat-num">{stats.failed}</div>
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
            {/* Блок наочної аналітики та графіків виконання програми */}
            {items.length > 0 && (
              <section className="public-portal-charts-section" aria-label="Візуалізація виконання програми">
                <div className="public-portal-charts-head">
                  <div className="public-portal-charts-head-title">
                    <BarChart3 size={18} className="public-portal-charts-head-icon" />
                    <h2>Наочна аналітика та візуалізація виконання програми</h2>
                  </div>
                  <div className="public-portal-charts-head-sub">
                    Інтерактивний розподіл статусів та динаміка за розділами за звітний період {data?.period || ''}
                  </div>
                </div>

                <div className="public-portal-charts-grid">
                  {/* Картка 1: Кругова діаграма статусів (Donut Chart) */}
                  <div className="public-portal-chart-card">
                    <div className="public-portal-chart-title">
                      <PieChartIcon size={16} />
                      <span>Розподіл за статусами виконання</span>
                    </div>
                    <div className="public-portal-donut-wrap">
                      <div className="public-portal-donut-container">
                        <ResponsiveContainer width="100%" height={210}>
                          <PieChart>
                            <Pie
                              data={statusChartData}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={50}
                              outerRadius={80}
                              paddingAngle={3}
                              stroke="var(--surface)"
                              strokeWidth={2}
                            >
                              {statusChartData.map((entry, idx) => (
                                <Cell key={`cell-${idx}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={CHART_TOOLTIP_STYLE}
                              itemStyle={CHART_ITEM_STYLE}
                              labelStyle={CHART_LABEL_STYLE}
                              formatter={(value: any, name: any) => [`${value} заходів`, name]}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="public-portal-donut-center">
                          <div className="public-portal-donut-pct">
                            {stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0}%
                          </div>
                          <div className="public-portal-donut-lbl">виконано</div>
                        </div>
                      </div>

                      <div className="public-portal-donut-legend">
                        {statusChartData.map(item => {
                          const isSelected = statusFilter === item.key
                          return (
                            <button
                              key={item.key}
                              type="button"
                              className={`public-portal-legend-item ${isSelected ? 'active' : ''}`}
                              onClick={() => setStatusFilter(isSelected ? '' : item.key)}
                              title={`Фільтрувати за статусом: ${item.name}`}
                            >
                              <span className="public-portal-legend-dot" style={{ backgroundColor: item.color }} />
                              <span className="public-portal-legend-name">{item.name}</span>
                              <span className="public-portal-legend-count">{item.value}</span>
                              <span className="public-portal-legend-pct">({item.percent}%)</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Картка 2: Стовпчикова діаграма за розділами */}
                  <div className="public-portal-chart-card">
                    <div className="public-portal-chart-title">
                      <BarChart3 size={16} />
                      <span>Виконання за розділами програми</span>
                    </div>
                    <div className="public-portal-barchart-wrap">
                      <ResponsiveContainer width="100%" height={170}>
                        <BarChart
                          data={sectionChartData}
                          layout="vertical"
                          margin={{ top: 5, right: 15, left: 5, bottom: 0 }}
                        >
                          <XAxis type="number" allowDecimals={false} fontSize={11} stroke="var(--muted)" />
                          <YAxis
                            type="category"
                            dataKey="shortName"
                            width={75}
                            fontSize={11}
                            stroke="var(--muted)"
                            tickLine={false}
                          />
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
                          <RBar dataKey="done" name="Виконано" stackId="sec" fill="#16a34a" />
                          <RBar dataKey="inProgress" name="У роботі / частково" stackId="sec" fill="#2563eb" />
                          <RBar dataKey="notDue" name="Строк не настав" stackId="sec" fill="#64748b" />
                          <RBar dataKey="failed" name="Не виконано" stackId="sec" fill="#dc2626" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>

                      <div className="public-portal-sections-progress">
                        {sectionChartData.map(sec => {
                          const isSelected = sectionFilter === sec.code
                          return (
                            <div
                              key={sec.code}
                              className={`public-portal-sec-prog-item ${isSelected ? 'active' : ''}`}
                              onClick={() => setSectionFilter(isSelected ? '' : sec.code)}
                              title={`Фільтрувати за розділом: ${sec.fullName}`}
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
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Панель пошуку і фільтрів */}
            <div className="public-portal-filters">
              <div className="public-portal-search-wrap">
                <Search size={15} className="public-portal-search-icon" />
                <input
                  type="text"
                  className="public-portal-search-input"
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
                {sectionChartData.length > 0 ? (
                  sectionChartData.map(sec => (
                    <option key={sec.code} value={sec.code}>
                      {sec.fullName}
                    </option>
                  ))
                ) : (
                  <>
                    <option value="R1">Розділ 1 ({DEFAULT_SECTION_INFO.R1.name})</option>
                    <option value="R2">Розділ 2 ({DEFAULT_SECTION_INFO.R2.name})</option>
                    <option value="R3">Розділ 3 ({DEFAULT_SECTION_INFO.R3.name})</option>
                  </>
                )}
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
          <div className="public-portal-footer-info">
            <span className="public-portal-footer-brand">АКП-Монітор</span>
            <span className="public-portal-footer-sep">·</span>
            <span>Харківський національний університет внутрішніх справ</span>
            <span className="public-portal-footer-sep">·</span>
            <span>Сектор з питань запобігання корупції</span>
          </div>

          <div className="public-portal-footer-actions">
            <Link to="/verify" className="public-portal-footer-btn" title="Перевірка електронного підпису та зліпка звіту">
              <ShieldCheck size={14} />
              <span>Перевірка автентичності звіту</span>
            </Link>
            <Link to="/login" className="public-portal-footer-btn primary" title="Вхід до системи для відповідальних осіб">
              <LogIn size={14} />
              <span>Вхід для уповноважених осіб</span>
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
