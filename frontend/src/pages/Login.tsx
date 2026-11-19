import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Moon, Sun } from 'lucide-react'
import { ensureCsrf } from '../api'
import { useAuth } from '../auth'
import { Emblem, useTheme } from '../components/Layout'

export default function Login() {
  const { login } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    ensureCsrf().catch(() => {})
  }, [])

  const submit = async () => {
    if (busy) return
    const u = username.trim()
    if (!u || !password) {
      setErr('Будь ласка, введіть логін та пароль')
      return
    }
    setErr('')
    setBusy(true)
    try {
      await login(u, password)
      nav('/')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <div className="box">
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
          <div className="login-fields">
            <label className="f">Логін
              <input
                value={username}
                autoComplete="username"
                onChange={e => setUsername(e.target.value)}
                placeholder="Введіть логін"
                autoFocus
              />
            </label>
            <label className="f">Пароль
              <div className="pw-field">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  autoComplete="current-password"
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Введіть пароль"
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
          {err && <div className="alert danger" role="alert">{err}</div>}
          <div className="login-actions">
            <button type="submit" className="btn login-submit-btn" disabled={busy}>
              {busy ? 'Вхід…' : 'Увійти'}
            </button>
          </div>
          <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '.84rem' }}>
            <Link to="/public" style={{ color: 'var(--accent)', fontWeight: 500 }}>
              ← Відкритий публічний портал моніторингу програми
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
