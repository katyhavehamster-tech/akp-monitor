import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Any } from '../api'
import { useAuth } from '../auth'
import { Emblem } from '../components/Layout'

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
  const nav = useNavigate()
  const [users, setUsers] = useState<Any[]>([])
  const [username, setUsername] = useState('u-002')
  const [password, setPassword] = useState('demo')
  const [err, setErr] = useState('')
  useEffect(() => { api('auth/demo-users').then(setUsers).catch(() => setUsers([])) }, [])

  const submit = async (u = username) => {
    setErr('')
    try { await login(u, password); nav('/') } catch (e) { setErr((e as Error).message) }
  }

  return <div className="login"><div className="box">
    <div className="head"><Emblem size={60} />
      <div><h1>АКП-Монітор</h1><p>Цифрова система моніторингу виконання антикорупційної програми</p></div>
    </div>
    <div className="card">
      <div className="grid g2" style={{ alignItems: 'end' }}>
        <label className="f">Логін<input value={username} onChange={e => setUsername(e.target.value)} /></label>
        <label className="f">Пароль<input type="password" value={password} onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()} /></label>
      </div>
      {err && <div className="alert danger">{err}</div>}
      <div className="row"><button className="btn" onClick={() => submit()}>Увійти</button>
        <span className="muted">Демо-пароль для всіх облікових записів: <code>demo</code></span></div>
    </div>
    <div className="card">
      <h2>Демо-входи за ролями</h2>
      <p className="muted">Користувачі описані лише роллю, підрозділом і посадою — без імен і персональних даних.</p>
      {ROLE_ORDER.map(role => {
        const list = users.filter(u => u.role === role)
        if (!list.length) return null
        return <div key={role} style={{ marginBottom: '1rem' }}>
          <h3>{list[0].role_name} <small className="muted">— {ROLE_HINT[role]}</small></h3>
          <div className="users">{list.map(u =>
            <button key={u.code} className={`user-card ${username === u.username ? 'sel' : ''}`}
              onClick={() => { setUsername(u.username); submit(u.username) }}>
              <b>{u.code}{u.unit ? ` · ${u.unit.code}` : ''}</b><span>{u.unit ? u.unit.name : u.position}</span>
            </button>)}</div>
        </div>
      })}
    </div>
  </div></div>
}
