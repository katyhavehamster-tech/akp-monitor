import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, Eye, EyeOff, FileKey, KeyRound, Moon, Sun, UploadCloud, X } from 'lucide-react'
import { ensureCsrf } from '../api'
import { useAuth } from '../auth'
import { Emblem, useTheme } from '../components/Layout'
import { parseKeyFile, type KeyFileContainer } from '../keyFileCrypto'

export default function Login() {
  const { loginWithKey } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const nav = useNavigate()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [keyFile, setKeyFile] = useState<KeyFileContainer | null>(null)
  const [keyFileName, setKeyFileName] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [revocationNotice, setRevocationNotice] = useState('')

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    ensureCsrf().catch(() => {})
    try {
      const p = new URLSearchParams(window.location.search)
      const r = p.get('reason') || sessionStorage.getItem('auth_redirect_reason')
      if (r === 'key_revoked') {
        setRevocationNotice('Ваш активний сеанс завершено: особистий ключ доступу було відкликано або перевипущено. Будь ласка, завантажте новий файл ключа (.key) та здійсніть вхід.')
        sessionStorage.removeItem('auth_redirect_reason')
      } else if (r === 'session_terminated') {
        setRevocationNotice('Ваш сеанс було примусово завершено адміністратором безпеки. Для продовження роботи виконайте вхід повторно.')
        sessionStorage.removeItem('auth_redirect_reason')
      } else if (r === 'account_disabled') {
        setRevocationNotice('Обліковий запис деактивовано або заблоковано адміністратором системи.')
        sessionStorage.removeItem('auth_redirect_reason')
      }
    } catch {
      /* ignore */
    }
  }, [])

  const handleFile = async (file: File) => {
    setErr('')
    try {
      const text = await file.text()
      const parsed = parseKeyFile(text)
      setKeyFile(parsed)
      setKeyFileName(file.name)
      if (parsed.user_login) {
        setUsername(parsed.user_login)
      }
    } catch (e) {
      setKeyFile(null)
      setKeyFileName('')
      setErr((e as Error).message || 'Не вдалося прочитати файл ключа.')
    }
  }

  const onFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFile(file)
    }
    e.target.value = ''
  }

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) {
      handleFile(file)
    }
  }

  const clearKeyFile = () => {
    setKeyFile(null)
    setKeyFileName('')
    setErr('')
  }

  const submit = async () => {
    if (busy) return
    const u = username.trim()
    if (!keyFile) {
      setErr('Будь ласка, завантажте файл особистого ключа (.key)')
      return
    }
    if (!u) {
      setErr('Будь ласка, введіть логін користувача')
      return
    }
    if (!password) {
      setErr('Будь ласка, введіть пароль захисту ключа')
      return
    }

    setErr('')
    setBusy(true)
    try {
      await loginWithKey(keyFile, password, u)
      nav('/')
    } catch (e) {
      setErr((e as Error).message || 'Помилка автентифікації.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <div className="box" style={{ maxWidth: 440 }}>
        <div className="head">
          <Emblem size={62} className="login-logo" />
          <div className="login-title-wrap">
            <h1>АКП-Монітор · ХНУВС</h1>
            <p>Цифрова система моніторингу виконання антикорупційної програми</p>
          </div>
          <button
            type="button"
            className="btn secondary icon login-theme-btn"
            onClick={toggleTheme}
            title={theme === 'light' ? 'Увімкнути темну тему' : 'Увімкнути світлу тему'}
            aria-label="Перемкнути тему"
          >
            {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
          </button>
        </div>

        <form className="card login-card" onSubmit={e => { e.preventDefault(); submit() }}>
          <div style={{ textAlign: 'center', marginBottom: '.85rem' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', fontSize: '.9rem', fontWeight: 700, color: 'var(--ink)' }}>
              <KeyRound size={17} style={{ color: 'var(--accent)' }} />
              Вхід за електронним ключем (.key)
            </div>
            <div className="muted" style={{ fontSize: '.76rem', marginTop: '.2rem' }}>
              Криптографічний захист Challenge-Response (ECDSA P-256 / AES-GCM)
            </div>
          </div>

          {revocationNotice && (
            <div className="alert danger" role="alert" style={{ marginBottom: '.85rem', fontSize: '.84rem', lineHeight: 1.45 }}>
              <div style={{ fontWeight: 700, marginBottom: '.2rem' }}>⚠️ Сеанс завершено</div>
              {revocationNotice}
            </div>
          )}

          <div className="login-fields">
            {/* 1. Поле завантаження/перетягування файлу ключа */}
            <label className="f" style={{ marginBottom: '.25rem' }}>
              Файл особистого ключа (.key)
              <input
                ref={fileInputRef}
                type="file"
                accept=".key,application/json,.json"
                style={{ display: 'none' }}
                onChange={onFileInputChange}
              />

              {!keyFile ? (
                <div
                  className={`login-key-dropzone ${isDragging ? 'dragover' : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click() }}
                >
                  <UploadCloud size={28} className="login-key-drop-icon" />
                  <div style={{ fontWeight: 600, fontSize: '.84rem', marginTop: '.25rem' }}>
                    Натисніть або перетягніть файл ключа (.key)
                  </div>
                  <div className="muted" style={{ fontSize: '.74rem', marginTop: '.15rem' }}>
                    Формат AKP-KEY-V1 (локальне розшифрування)
                  </div>
                </div>
              ) : (
                <div className="login-key-loaded">
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.65rem', flex: 1, minWidth: 0 }}>
                    <div className="login-key-badge-icon">
                      <FileKey size={20} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
                        <span className="login-key-filename" title={keyFileName}>
                          {keyFileName}
                        </span>
                        {keyFile.role && (
                          <span className="pill small" style={{ fontSize: '.68rem', padding: '1px 6px' }}>
                            {keyFile.role}
                          </span>
                        )}
                      </div>
                      <div className="login-key-fp" title={keyFile.fingerprint}>
                        SHA-256: <code>{keyFile.fingerprint.slice(0, 16)}…{keyFile.fingerprint.slice(-8)}</code>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn secondary icon small"
                    onClick={clearKeyFile}
                    title="Обрати інший файл ключа"
                    aria-label="Змінити файл ключа"
                    style={{ flexShrink: 0 }}
                  >
                    <X size={15} />
                  </button>
                </div>
              )}
            </label>

            {/* 2. Поле «Логін користувача» */}
            <label className="f">
              Логін користувача
              <input
                value={username}
                autoComplete="username"
                onChange={e => setUsername(e.target.value)}
                placeholder="u-001"
              />
            </label>

            {/* 3. Поле «Пароль захисту ключа» */}
            <label className="f">
              Пароль захисту ключа
              <div className="pw-field">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  autoComplete="current-password"
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Введіть пароль для розшифрування"
                />
                <button
                  type="button"
                  className="pw-toggle"
                  onClick={() => setShowPw(v => !v)}
                  aria-label={showPw ? 'Сховати пароль' : 'Показати пароль'}
                  title={showPw ? 'Сховати пароль' : 'Показати пароль'}
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
          </div>

          {err && (
            <div className="alert danger" role="alert" style={{ marginTop: '.65rem', fontSize: '.84rem' }}>
              {err}
            </div>
          )}

          {/* 4. Кнопка «Увійти за ключем» */}
          <div className="login-actions" style={{ marginTop: '.9rem' }}>
            <button
              type="submit"
              className="btn login-submit-btn"
              disabled={busy}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '.5rem' }}
            >
              {busy ? (
                'Перевірка підпису ключа…'
              ) : (
                <>
                  <CheckCircle2 size={16} />
                  Увійти за ключем
                </>
              )}
            </button>
          </div>

          <div style={{ marginTop: '1.15rem', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '.84rem' }}>
            <Link to="/public" style={{ color: 'var(--accent)', fontWeight: 500 }}>
              ← Відкритий публічний портал моніторингу програми
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
