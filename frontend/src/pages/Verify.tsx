import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { ShieldCheck, ShieldAlert, ShieldX, CheckCircle, AlertTriangle, Moon, Sun, ArrowLeft, Search } from 'lucide-react'
import { api, fmtDate, type Any } from '../api'
import { Emblem, useTheme } from '../components/Layout'
import { Pill, PORTAL_TONE } from '../components/ui'

export default function Verify() {
  const [params] = useSearchParams()
  const { theme, toggleTheme } = useTheme()

  const [idInput, setIdInput] = useState(params.get('id') || '')
  const [sigInput, setSigInput] = useState(params.get('sig') || '')

  const [loading, setLoading] = useState(false)
  const [res, setRes] = useState<Any | null>(null)
  const [err, setErr] = useState<string | null>(null)

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
      verify(qId, qSig)
    }
  }, [params])

  return (
    <div className="verify-page">
      <div className="verify-container">
        <header className="verify-nav">
          <div className="verify-nav-brand">
            <Emblem size={44} />
            <div>
              <div className="verify-brand-title">АКП-Монітор · ХНУВС</div>
              <div className="verify-brand-sub">Центр електронної верифікації звітів</div>
            </div>
          </div>
          <div className="row" style={{ gap: '.5rem' }}>
            <button
              type="button"
              className="btn secondary icon"
              onClick={toggleTheme}
              title={theme === 'light' ? 'Увімкнути темну тему' : 'Увімкнути світлу тему'}
              aria-label="Перемкнути тему"
            >
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <Link to="/login" className="btn secondary small">
              <ArrowLeft size={14} style={{ marginRight: '.3rem' }} />
              Увійти в систему
            </Link>
          </div>
        </header>

        <div className="verify-search-card card">
          <form
            onSubmit={e => {
              e.preventDefault()
              verify(idInput, sigInput)
            }}
          >
            <div className="verify-form-grid">
              <label className="f">
                Ідентифікатор зліпка звіту (ID)
                <input
                  value={idInput}
                  onChange={e => setIdInput(e.target.value)}
                  placeholder="наприклад: f7ea9c2a-6814-4659-99bb-4eadd79a45af"
                  required
                />
              </label>
              <label className="f">
                Цифровий підпис (HMAC-SHA256 signature)
                <input
                  value={sigInput}
                  onChange={e => setSigInput(e.target.value)}
                  placeholder="64-значний шістнадцятковий хеш підпису"
                  required
                />
              </label>
            </div>
            <div className="row" style={{ marginTop: '.85rem', justifyContent: 'flex-end' }}>
              <button type="submit" className="btn" disabled={loading}>
                <Search size={15} style={{ marginRight: '.4rem' }} />
                {loading ? 'Перевірка підпису…' : 'Перевірити звіт'}
              </button>
            </div>
          </form>
        </div>

        {err && (
          <div className="alert danger" style={{ marginTop: '1rem' }}>
            <AlertTriangle size={18} style={{ marginRight: '.4rem', verticalAlign: 'middle' }} />
            {err}
          </div>
        )}

        {res && (
          <div className="verify-results">
            {res.status === 'verified_intact' && (
              <div className="verify-badge-card success">
                <div className="verify-badge-icon">
                  <ShieldCheck size={48} />
                </div>
                <div className="verify-badge-content">
                  <span className="verify-pill pill-success">ОРИГІНАЛ · ЦІЛІСНІСТЬ ПІДТВЕРДЖЕНО</span>
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
                  <span className="verify-pill pill-warning">АРХІВНИЙ ЗВІТ · ДАНІ ОНОВЛЕНО</span>
                  <h2>Цифровий підпис валідний</h2>
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
                  <h2>Документ не зареєстровано</h2>
                  <p>{res.message}</p>
                </div>
              </div>
            )}

            {res.snapshot && (
              <>
                <div className="card" style={{ marginTop: '1.25rem' }}>
                  <h3>Параметри зафіксованого звіту</h3>
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
                      <div className="muted">Кількість заходів у програмі:</div>
                      <b>{res.snapshot.total_measures || 50} заходів</b>
                    </div>
                    <div>
                      <div className="muted">Рядків у звіті:</div>
                      <b>{res.snapshot.rows_count || 50} рядків</b>
                    </div>
                  </div>

                  {res.snapshot.summary && Object.keys(res.snapshot.summary).length > 0 && (
                    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--line)' }}>
                      <div className="muted" style={{ marginBottom: '.45rem' }}>Стан виконання заходів на момент фіксації:</div>
                      <div className="row" style={{ gap: '.4rem', flexWrap: 'wrap' }}>
                        {Object.entries(res.snapshot.summary).map(([st, cnt]) => (
                          <Pill key={st} tone={PORTAL_TONE[st] || 'neutral'}>
                            {st}: {String(cnt)}
                          </Pill>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="card" style={{ marginTop: '1.25rem' }}>
                  <h3>Криптографічний контрольний слід (HMAC-SHA256)</h3>
                  <div className="verify-crypto-list">
                    <div className="crypto-item">
                      <div className="crypto-label">
                        <CheckCircle size={15} className="text-success" />
                        <span>Криптографічний підпис сервера (HMAC-SHA256):</span>
                      </div>
                      <code className="crypto-value break-all">{res.snapshot.signature}</code>
                    </div>

                    <div className="crypto-item">
                      <div className="crypto-label">
                        <span>SHA-256 хеш зафіксованих даних:</span>
                      </div>
                      <code className="crypto-value break-all">{res.snapshot.report_hash}</code>
                    </div>

                    {res.current_hash && (
                      <div className="crypto-item">
                        <div className="crypto-label">
                          <span>SHA-256 хеш актуального реєстру:</span>
                        </div>
                        <code className="crypto-value break-all">{res.current_hash}</code>
                        {res.data_matches_current ? (
                          <div className="crypto-match match-ok">
                            ✓ Хеш повністю збігається з поточним станом бази даних (100% цілісність)
                          </div>
                        ) : (
                          <div className="crypto-match match-diff">
                            ⚠ Хеш відрізняється: дані в системі оновлювалися після створення цього зліпка
                          </div>
                        )}
                      </div>
                    )}

                    <div className="crypto-item">
                      <div className="crypto-label">
                        <span>Унікальний ідентифікатор зліпка (UUIDv4):</span>
                      </div>
                      <code className="crypto-value">{res.snapshot.id}</code>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <footer className="verify-footer">
          © {new Date().getFullYear()} Харківський національний університет внутрішніх справ (ХНУВС) ·
          АКП-Монітор. Підсистема криптографічної верифікації звітів ДСТУ 4163:2020.
        </footer>
      </div>
    </div>
  )
}
