import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Moon, Sun } from 'lucide-react'
import { api, type Any } from '../api'
import { useAuth } from '../auth'
import { Emblem, useTheme } from '../components/Layout'

const ROLE_ORDER = ['KOORD', 'KER', 'VYK', 'ADMIN', 'ANAL']
const ROLE_HINT: Record<string, string> = {
  KOORD: 'Повний доступ: опитування, усі розділи програми, погодження, звіти',
  KER: 'Перегляд усієї інформації без права змін',
  VYK: 'Заповнює лише заходи свого підрозділу у відкрите вікно (4 рази на рік, 5 днів)',
  ADMIN: 'Технічна підтримка: користувачі, звітні вікна, налаштування, цілісність',
  ANAL: 'Перегляд аналітики',
}

export default function Login() {
  const { login } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const nav = useNavigate()
  const [users, setUsers] = useState<Any[]>([])
  const [username, setUsername] = useState('u-002')
  const [password, setPassword] = useState('demo')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { api('auth/demo-users').then(setUsers).catch(() => setUsers([])) }, [])

  const submit = async (u = username) => {
    if (busy) return
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

  return <div className="login"><div className="box">
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
    <form className="card" onSubmit={e => { e.preventDefault(); submit() }}>
      <div className="grid g2" style={{ alignItems: 'end' }}>
        <label className="f">Логін
          <input
            value={username}
            autoComplete="username"
            onChange={e => setUsername(e.target.value)}
            placeholder="u-002"
          />
        </label>
        <label className="f">Пароль
          <div className="pw-field">
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              autoComplete="current-password"
              onChange={e => setPassword(e.target.value)}
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
      <div className="row login-actions">
        <button type="submit" className="btn" disabled={busy}>{busy ? 'Вхід…' : 'Увійти'}</button>
        <span className="muted">Демо-пароль для всіх облікових записів: <code>demo</code></span>
      </div>
    </form>
    {users.length > 0 && (
      <div className="card">
        <h2>Демо-входи за ролями</h2>
        <p className="muted">Користувачі описані лише роллю, підрозділом і посадою — без імен і персональних даних.</p>
        {ROLE_ORDER.map(role => {
          const list = users.filter(u => u.role === role)
          if (!list.length) return null
          return <div key={role} style={{ marginBottom: '1rem' }}>
            <h3>{list[0].role_name} <small className="muted">— {ROLE_HINT[role]}</small></h3>
            <div className="users">{list.map(u =>
              <button type="button" key={u.code} disabled={busy} className={`user-card ${username === u.username ? 'sel' : ''}`}
                onClick={() => { setUsername(u.username); submit(u.username) }}>
                <b>{u.code}{u.unit ? ` · ${u.unit.code}` : ''}</b><span>{u.unit ? u.unit.name : u.position}</span>
              </button>)}</div>
          </div>
        })}
      </div>
    )}
  </div></div>
}
