import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle,
  Copy,
  Check,
  FileDown,
  Filter,
  LogIn,
  Moon,
  Printer,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Sun,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { api, fmtDate, type Any } from '../api'
import { Emblem, useTheme } from '../components/Layout'
import { Pill, PORTAL_TONE } from '../components/ui'

export default function Verify() {
  const [params, setParams] = useSearchParams()
  const { theme, toggleTheme } = useTheme()

  const [idInput, setIdInput] = useState(params.get('id') || '')
  const [sigInput, setSigInput] = useState(params.get('sig') || '')

  const [loading, setLoading] = useState(false)
  const [res, setRes] = useState<Any | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [showSearchForm, setShowSearchForm] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // Фільтри таблиці документа
  const [filterText, setFilterText] = useState('')
  const [filterSection, setFilterSection] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard?.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const verify = async (id: string, sig: string) => {
    const cleanId = id.trim()
    const cleanSig = sig.trim()
    if (!cleanId || !cleanSig) {
      setErr('Вкажіть ідентифікатор зліпка (id) та цифровий підпис (sig).')
      setRes(null)
      return
    }
    setLoading(true)
    setErr(null)
    try {
      const data = await api(`reports/verify?id=${encodeURIComponent(cleanId)}&sig=${encodeURIComponent(cleanSig)}`)
      setRes(data)
    } catch (e: Any) {
      if (e?.data && typeof e.data === 'object') {
        setRes(e.data)
      } else {
        setErr(e?.message || 'Помилка зʼєднання із сервером верифікації.')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const qId = params.get('id')
    const qSig = params.get('sig')
    if (qId && qSig) {
      setIdInput(qId)
      setSigInput(qSig)
      verify(qId, qSig)
    } else {
      setShowSearchForm(true)
    }
  }, [params])

  // Підготовка рядків документа
  const rows: Any[] = useMemo(() => res?.snapshot?.raw_data || [], [res])

  const sections: string[] = useMemo(() => {
    if (res?.sections && Array.isArray(res.sections) && res.sections.length > 0) {
      return res.sections
    }
    const set = new Set<string>()
    rows.forEach(r => { if (r.rozdil_portal) set.add(r.rozdil_portal) })
    return Array.from(set)
  }, [res, rows])

  const filteredRows = useMemo(() => {
    return rows.filter(r => {
      if (filterSection && r.rozdil_portal !== filterSection) return false
      if (filterStatus && r.stan_vykonannia !== filterStatus) return false
      if (filterText) {
        const q = filterText.toLowerCase()
        const text = `${r.nomer || ''} ${r.opys_zakhodu || ''} ${r.naimenuvannia_pidrozdilu || ''} ${r.opys_rezultatu_abo_prychyn || ''}`.toLowerCase()
        if (!text.includes(q)) return false
      }
      return true
    })
  }, [rows, filterSection, filterStatus, filterText])

  const docxUrl = res?.docx_download_url
    ? res.docx_download_url
    : res?.snapshot?.id && res?.snapshot?.signature
      ? `/api/reports/verify?id=${res.snapshot.id}&sig=${res.snapshot.signature}&format=docx`
      : null

  return (
    <div className="verify-page">
      {/* Повноширинна офіційна шапка (Header) */}
      <header className="verify-header no-print">
        <div className="verify-header-inner">
          <div className="verify-header-brand">
            <Emblem size={38} className="verify-logo" />
            <div className="brand-text">
              <div className="brand-title">
                АКП-Монітор <span className="brand-badge">ХНУВС</span>
              </div>
              <div className="brand-subtitle">Центр електронної верифікації звітів НАЗК</div>
            </div>
          </div>

          <div className="verify-header-tools">
            <span className="pill ok verify-header-pill">Офіційний реєстр · ДСТУ 4163:2020</span>
            <button
              type="button"
              className="btn secondary small icon"
              onClick={toggleTheme}
              title={theme === 'light' ? 'Увімкнути темну тему' : 'Увімкнути світлу тему'}
              aria-label="Перемкнути тему"
            >
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <Link to="/login" className="btn primary small verify-login-btn" title="Увійти в кабінет">
              <LogIn size={15} />
              <span className="verify-login-text-full">Увійти в кабінет</span>
              <span className="verify-login-text-short">Увійти</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Основний вміст сторінки */}
      <main className="verify-main">
        <div className="verify-container">
          {/* Офіційний заголовок для друку */}
          <div className="print-only" style={{ textAlign: 'center', marginBottom: '14pt' }}>
            <div style={{ fontSize: '13pt', fontWeight: 'bold', textTransform: 'uppercase' }}>
              Харківський національний університет внутрішніх справ
            </div>
            <div style={{ fontSize: '10pt', color: '#333', marginTop: '2pt' }}>
              АКП-Монітор · Підсистема електронної криптографічної верифікації звітів НАЗК (ДСТУ 4163:2020)
            </div>
          </div>

          {/* Верхній блок заголовка для екрана */}
          <div className="verify-hero no-print">
            <div>
              <h1 className="verify-title">Перевірка автентичності та цілісності звіту</h1>
              <p className="verify-desc">
                Криптографічна перевірка оригінальності підпису (HMAC-SHA256) та цифрового зліпка даних антикорупційного звіту за Законом України «Про запобігання корупції».
              </p>
            </div>
            {res && (
              <button
                type="button"
                className="btn secondary small no-print"
                onClick={() => setShowSearchForm(v => !v)}
              >
                <Search size={14} />
                <span>{showSearchForm ? 'Приховати форму пошуку' : 'Перевірити інший звіт'}</span>
                {showSearchForm ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            )}
          </div>

          {/* Форма пошуку (ручна перевірка або інший звіт) */}
          {showSearchForm && (
            <div className="card verify-search-card no-print" style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.4rem', marginBottom: '.75rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Параметри верифікації документа</h3>
                <span className="muted" style={{ fontSize: '.82rem' }}>Введіть ID або відскануйте QR-код</span>
              </div>
              <form
                onSubmit={e => {
                  e.preventDefault()
                  setParams({ id: idInput.trim(), sig: sigInput.trim() })
                  verify(idInput, sigInput)
                }}
              >
                <div className="verify-form-grid">
                  <label className="f">
                    Ідентифікатор зліпка звіту (ID)
                    <input
                      value={idInput}
                      onChange={e => setIdInput(e.target.value)}
                      placeholder="наприклад: 6a89ea88-2180-44ba-ab4f-552420f792f2"
                      required
                    />
                  </label>
                  <label className="f">
                    Цифровий підпис сервера (HMAC-SHA256 signature)
                    <input
                      value={sigInput}
                      onChange={e => setSigInput(e.target.value)}
                      placeholder="64-значний шістнадцятковий криптографічний хеш"
                      required
                    />
                  </label>
                </div>
                <div className="row" style={{ marginTop: '.85rem', justifyContent: 'flex-end', gap: '.5rem' }}>
                  <button type="submit" className="btn" disabled={loading}>
                    <Search size={15} style={{ marginRight: '.4rem' }} />
                    {loading ? 'Перевірка підпису…' : 'Перевірити звіт'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {err && (
            <div className="alert danger" style={{ marginBottom: '1.5rem' }}>
              <AlertTriangle size={18} style={{ marginRight: '.4rem', verticalAlign: 'middle' }} />
              {err}
            </div>
          )}

          {res && (
            <div className="verify-results">
              {/* Статус-бейдж сертифіката */}
              {res.status === 'verified_intact' && (
                <div className="verify-badge-card success">
                  <div className="verify-badge-icon">
                    <ShieldCheck size={48} />
                  </div>
                  <div className="verify-badge-content">
                    <span className="verify-pill pill-success">ОРИГІНАЛ · ЦІЛІСНІСТЬ ПІДТВЕРДЖЕНО (100%)</span>
                    <h2>Офіційний звіт верифіковано успішно</h2>
                    <p>{res.message}</p>
                  </div>
                </div>
              )}

              {res.status === 'verified_modified' && (
                <div className="verify-badge-card warning">
                  <div className="verify-badge-icon">
                    <AlertTriangle size={48} />
                  </div>
                  <div className="verify-badge-content">
                    <span className="verify-pill pill-warning">АРХІВНИЙ ОРИГІНАЛ · ДАНІ ОНОВЛЮВАЛИСЯ</span>
                    <h2>Криптографічний підпис дійсний</h2>
                    <p>{res.message}</p>
                  </div>
                </div>
              )}

              {res.status === 'invalid_signature' && (
                <div className="verify-badge-card danger">
                  <div className="verify-badge-icon">
                    <ShieldX size={48} />
                  </div>
                  <div className="verify-badge-content">
                    <span className="verify-pill pill-danger">ПІДРОБЛЕНИЙ ПІДПИС · НЕВАЛІДНО</span>
                    <h2>Криптографічний підпис не зійшовся</h2>
                    <p>{res.message}</p>
                  </div>
                </div>
              )}

              {res.status === 'not_found' && (
                <div className="verify-badge-card danger">
                  <div className="verify-badge-icon">
                    <ShieldAlert size={48} />
                  </div>
                  <div className="verify-badge-content">
                    <span className="verify-pill pill-danger">ЗЛІПОК НЕ ЗНАЙДЕНО</span>
                    <h2>Документ не зареєстровано в системі</h2>
                    <p>{res.message}</p>
                  </div>
                </div>
              )}

              {res.snapshot && (
                <>
                  {/* Реквізити документа та статистика */}
                  <div className="card" style={{ marginTop: '1.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem', marginBottom: '1rem' }}>
                      <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Параметри зафіксованого документа</h3>
                      <span className="pill info">Електронний зліпок #{res.snapshot.id.slice(0, 8)}</span>
                    </div>

                    <div className="verify-details-grid">
                      <div>
                        <div className="muted">Звітний період:</div>
                        <b>
                          {res.snapshot.year} рік, {res.snapshot.half === 1 ? 'І півріччя' : 'ІІ півріччя'}{' '}
                          <small className="muted">({res.snapshot.period_code})</small>
                        </b>
                      </div>
                      <div>
                        <div className="muted">Орган сектору безпеки і оборони:</div>
                        <b>{res.snapshot.organ_name || 'Харківський національний університет внутрішніх справ'}</b>
                      </div>
                      <div>
                        <div className="muted">Дата та час фіксації:</div>
                        <b>{fmtDate(res.snapshot.created_at)}</b>
                      </div>
                      <div>
                        <div className="muted">Зафіксовано користувачем:</div>
                        <b>{res.snapshot.created_by || 'Уповноважена особа'}</b>
                      </div>
                      <div>
                        <div className="muted">Заходів у програмі:</div>
                        <b>{res.snapshot.total_measures || rows.length} заходів</b>
                      </div>
                      <div>
                        <div className="muted">Рядків у звіті:</div>
                        <b>{res.snapshot.rows_count || rows.length} рядків</b>
                      </div>
                    </div>

                    {res.snapshot.summary && Object.keys(res.snapshot.summary).length > 0 && (
                      <div style={{ marginTop: '1.15rem', paddingTop: '1rem', borderTop: '1px solid var(--line)' }}>
                        <div className="muted" style={{ marginBottom: '.5rem', fontSize: '.85rem' }}>
                          Стан виконання заходів на момент фіксації зліпка:
                        </div>
                        <div className="row" style={{ gap: '.45rem', flexWrap: 'wrap' }}>
                          {Object.entries(res.snapshot.summary).map(([st, cnt]) => (
                            <Pill key={st} tone={PORTAL_TONE[st] || 'neutral'}>
                              {st}: <b>{String(cnt)}</b>
                            </Pill>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ОФІЦІЙНИЙ ЗМІСТ ДОКУМЕНТА (ТАБЛИЦЯ НА САЙТІ) */}
                  <div className="card verify-doc-card" style={{ marginTop: '1.5rem' }}>
                    <div className="verify-doc-header">
                      <div>
                        <h2 className="verify-doc-title">
                          Зміст зафіксованого документа
                        </h2>
                        <div className="verify-doc-sub">
                          Звіт про виконання антикорупційної програми за {res.snapshot.half === 1 ? 'І півріччя' : 'ІІ півріччя'} {res.snapshot.year} року
                        </div>
                      </div>

                      <div className="verify-doc-actions no-print">
                        {docxUrl && (
                          <a
                            href={docxUrl}
                            className="btn primary small"
                            download={`zvit_portal_${res.snapshot.year}_h${res.snapshot.half}_verified.docx`}
                          >
                            <FileDown size={15} />
                            <span>Завантажити Word (.docx)</span>
                          </a>
                        )}
                        <button
                          type="button"
                          className="btn secondary small"
                          onClick={() => window.print()}
                        >
                          <Printer size={15} />
                          <span>Роздрукувати звіт</span>
                        </button>
                      </div>
                    </div>

                    {/* Панель фільтрації по заходах */}
                    <div className="filter-bar verify-doc-filter-bar no-print">
                      <div className="search-box verify-filter-search">
                        <Search size={16} />
                        <input
                          type="text"
                          placeholder="Шукати за текстом або кодом заходу…"
                          value={filterText}
                          onChange={e => setFilterText(e.target.value)}
                        />
                      </div>

                      {sections.length > 0 && (
                        <div className="select-wrap verify-filter-select">
                          <Filter size={15} />
                          <select
                            value={filterSection}
                            onChange={e => setFilterSection(e.target.value)}
                            aria-label="Фільтр за розділом"
                          >
                            <option value="">Усі розділи ({rows.length})</option>
                            {sections.map(s => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="select-wrap verify-filter-select">
                        <select
                          value={filterStatus}
                          onChange={e => setFilterStatus(e.target.value)}
                          aria-label="Фільтр за станом виконання"
                        >
                          <option value="">Усі стани виконання</option>
                          <option value="Виконано">Виконано</option>
                          <option value="Не виконано">Не виконано</option>
                          <option value="Частково виконано">Частково виконано</option>
                          <option value="Строк виконання заходу не настав">Строк не настав</option>
                        </select>
                      </div>
                    </div>

                    {/* Індикатор кількості */}
                    <div className="muted" style={{ fontSize: '.84rem', margin: '.65rem 0 .5rem' }}>
                      Відображено <b>{filteredRows.length}</b> із <b>{rows.length}</b> заходів у зафіксованому звіті
                    </div>

                    {/* Підказка гортання таблиці для мобільних */}
                    <div className="verify-table-hint no-print">
                      <span>↔ Гортайте таблицю вправо/вліво для перегляду всіх колонок</span>
                    </div>

                    {/* Таблиця заходів */}
                    <div className="table-wrap">
                      <table className="t verify-table">
                        <thead>
                          <tr>
                            <th style={{ width: '45px', textAlign: 'center' }}>№</th>
                            <th style={{ width: '30%', minWidth: '220px' }}>Захід та очікуваний результат</th>
                            <th style={{ width: '18%', minWidth: '160px' }}>Відповідальний виконавець</th>
                            <th style={{ width: '110px' }}>Строк виконання</th>
                            <th style={{ width: '150px' }}>Стан виконання</th>
                            <th style={{ minWidth: '220px' }}>Опис результату / пояснення причин</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredRows.length === 0 ? (
                            <tr>
                              <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>
                                За обраними фільтрами заходів не знайдено.
                              </td>
                            </tr>
                          ) : (
                            filteredRows.map((r, i) => (
                              <tr key={r.nomer || i}>
                                <td style={{ textAlign: 'center', fontWeight: 600 }}>{r.nomer || i + 1}</td>
                                <td>
                                  <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: '.2rem' }}>
                                    {r.opys_zakhodu || '—'}
                                  </div>
                                  {r.rozdil_portal && (
                                    <small className="muted" style={{ display: 'block', fontSize: '.76rem' }}>
                                      {r.rozdil_portal}
                                    </small>
                                  )}
                                </td>
                                <td>
                                  <div style={{ fontSize: '.88rem' }}>{r.naimenuvannia_pidrozdilu || '—'}</div>
                                </td>
                                <td>
                                  <div style={{ fontSize: '.86rem', whiteSpace: 'nowrap' }}>
                                    {r.zaplanovanyi_strok || '—'}
                                  </div>
                                  {r.faktychnyi_strok_vykonannia && (
                                    <small className="muted" style={{ display: 'block', fontSize: '.76rem' }}>
                                      факт: {fmtDate(r.faktychnyi_strok_vykonannia)}
                                    </small>
                                  )}
                                </td>
                                <td>
                                  <Pill tone={PORTAL_TONE[r.stan_vykonannia] || 'neutral'}>
                                    {r.stan_vykonannia || '—'}
                                  </Pill>
                                </td>
                                <td>
                                  <div style={{ fontSize: '.88rem', lineHeight: 1.4 }}>
                                    {r.opys_rezultatu_abo_prychyn || <span className="muted">—</span>}
                                  </div>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Підписний блок наприкінці документа */}
                    <div className="verify-doc-seal">
                      <div className="verify-seal-grid">
                        <div className="seal-signatory">
                          <div className="seal-role">Уповноважена особа з питань запобігання та виявлення корупції</div>
                          <div className="seal-line"></div>
                          <div className="seal-name">{res.snapshot.created_by || 'Координатор Програми'}</div>
                        </div>
                        <div className="seal-signatory">
                          <div className="seal-role">Керівник органу сектору безпеки і оборони</div>
                          <div className="seal-line"></div>
                          <div className="seal-name">{res.snapshot.organ_name || 'Керівник органу'}</div>
                        </div>
                      </div>
                      <div className="seal-stamp">
                        <CheckCircle size={16} className="text-success" />
                        <span>Документ підписано кваліфікованим криптографічним зліпком HMAC-SHA256</span>
                      </div>
                    </div>
                  </div>

                  {/* Криптографічний слід */}
                  <div className="card" style={{ marginTop: '1.5rem' }}>
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '.75rem' }}>
                      Криптографічний контрольний слід (HMAC-SHA256)
                    </h3>
                    <div className="verify-crypto-list">
                      <div className="crypto-item">
                        <div className="crypto-label">
                          <CheckCircle size={15} className="text-success" />
                          <span>Криптографічний підпис сервера (HMAC-SHA256):</span>
                          <button
                            type="button"
                            className="btn-icon-subtle"
                            onClick={() => copyToClipboard(res.snapshot.signature, 'sig')}
                            title="Копіювати підпис"
                          >
                            {copiedKey === 'sig' ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                          </button>
                        </div>
                        <code className="crypto-value break-all">{res.snapshot.signature}</code>
                      </div>

                      <div className="crypto-item">
                        <div className="crypto-label">
                          <span>SHA-256 хеш зафіксованих даних:</span>
                          <button
                            type="button"
                            className="btn-icon-subtle"
                            onClick={() => copyToClipboard(res.snapshot.report_hash, 'hash')}
                            title="Копіювати хеш"
                          >
                            {copiedKey === 'hash' ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                          </button>
                        </div>
                        <code className="crypto-value break-all">{res.snapshot.report_hash}</code>
                      </div>

                      {res.current_hash && (
                        <div className="crypto-item">
                          <div className="crypto-label">
                            <span>SHA-256 хеш актуального реєстру на поточний момент:</span>
                          </div>
                          <code className="crypto-value break-all">{res.current_hash}</code>
                          {res.data_matches_current ? (
                            <div className="crypto-match match-ok">
                              ✓ Хеш повністю збігається з поточним станом бази даних (100% цілісність даних)
                            </div>
                          ) : (
                            <div className="crypto-match match-diff">
                              ⚠ Хеш відрізняється: дані в реєстрі оновлювалися після створення цього зліпка
                            </div>
                          )}
                        </div>
                      )}

                      <div className="crypto-item">
                        <div className="crypto-label">
                          <span>Унікальний ідентифікатор зліпка (UUIDv4):</span>
                        </div>
                        <code className="crypto-value break-all">{res.snapshot.id}</code>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          <footer className="verify-footer no-print">
            © {new Date().getFullYear()} Харківський національний університет внутрішніх справ (ХНУВС) ·
            АКП-Монітор. Підсистема криптографічної верифікації звітів НАЗК за ДСТУ 4163:2020.
          </footer>
        </div>
      </main>
    </div>
  )
}
