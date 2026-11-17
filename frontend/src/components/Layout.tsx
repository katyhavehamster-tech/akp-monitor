import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { fmtDate } from '../api'
import { useAuth, type Role } from '../auth'

export function Emblem({ size = 52 }: { size?: number }) {
  return <svg className="logo" width={size} height={size} viewBox="0 0 64 64" aria-hidden>
    <path d="M32 3 56 12v18c0 15-10 26-24 31C18 56 8 45 8 30V12z" fill="#0b2a5b" stroke="#e3a812" strokeWidth="3" />
    <path d="M21 33l7 7 15-16" fill="none" stroke="#e3a812" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

type Item = [string, string, Role[]]
const ALL: Role[] = ['KOORD', 'ADMIN', 'KER', 'VYK', 'ANAL']
const VIEW: Role[] = ['KOORD', 'ADMIN', 'KER', 'ANAL']

const MAIN: Item[] = [
  ['/surveys', 'Опитування', ['KOORD']],
  ['/my', 'Мої заходи', ['VYK']],
  ['/program', 'Виконання антикорупційної програми', VIEW],
  ['/admin', 'Технічне адміністрування', ['ADMIN']],
]

const PROGRAM_SUB: Item[] = [
  ['/program/dashboard', 'Моніторинг', VIEW],
  ['/program/measures', 'Реєстр заходів', VIEW],
  ['/program/approvals', 'Погодження', ['KOORD']],
  ['/program/flags', 'Сигнали (Risk Flags)', VIEW],
  ['/program/risks', 'Корупційні ризики', VIEW],
  ['/program/recommendations', 'Рекомендації', VIEW],
  ['/program/calendar', 'Календар строків', VIEW],
  ['/program/reports', 'Звіти', VIEW],
  ['/program/audit', 'Журнал дій', VIEW],
  ['/program/passport', 'Паспорт програми', VIEW],
]
const MY_SUB: Item[] = [
  ['/my', 'Мої заходи', ['VYK']],
  ['/my/calendar', 'Строки і нагадування', ['VYK']],
]
const ADMIN_SUB: Item[] = [
  ['/admin/users', 'Користувачі', ['ADMIN']],
  ['/admin/periods', 'Звітні вікна', ['ADMIN']],
  ['/admin/system', 'Налаштування і стан системи', ['ADMIN']],
]

export default function Layout() {
  const { profile, today, periods, period, setPeriod, logout } = useAuth()
  const loc = useLocation()
  const nav = useNavigate()
  if (!profile) return null
  const role = profile.role
  const sub = loc.pathname.startsWith('/program') ? PROGRAM_SUB : loc.pathname.startsWith('/my') ? MY_SUB
    : loc.pathname.startsWith('/admin') ? ADMIN_SUB : []
  const cur = periods.find(p => p.code === period)
  const cabinet = role === 'KOORD' ? 'Кабінет уповноваженого' : role === 'VYK' ? 'Кабінет виконавця'
    : role === 'ADMIN' ? 'Кабінет технічного адміністратора' : role === 'KER' ? 'Кабінет керівника' : 'Кабінет аналітика'

  return <>
    <div className="topbar"><div className="wrap">
      <span>Умовне відомство сектору безпеки і оборони · <b>синтетичні дані</b></span>
      <span>Робоча дата: <b>{fmtDate(today)}</b>{cur && <> · вікно внесення {cur.code}: {fmtDate(cur.window_start)}–{fmtDate(cur.window_end)} <b>{cur.is_open ? 'відкрите' : 'закрите'}</b></>}</span>
    </div></div>
    <header className="brand"><div className="wrap">
      <Emblem />
      <div className="title">
        <strong>АКП-Монітор</strong>
        <span>{cabinet} · цифрова система моніторингу виконання антикорупційної програми</span>
      </div>
      <div className="userbox">
        <label className="muted" style={{ fontSize: '.8rem' }}>Період&nbsp;
          <select value={period} onChange={e => setPeriod(e.target.value)}>
            {periods.map(p => <option key={p.code} value={p.code}>{p.code.replace('-Q', ' · ')} кв.</option>)}
          </select>
        </label>
        <span className="role-chip" title={profile.position}>{profile.role_name}{profile.unit ? ` · ${profile.unit.code}` : ''}</span>
        <button className="btn secondary small" onClick={() => { logout(); nav('/login') }}>Вийти</button>
      </div>
    </div></header>
    <nav className="mainnav"><div className="wrap">
      {MAIN.filter(i => i[2].includes(role)).map(([to, label]) =>
        <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'active' : ''}>{label}</NavLink>)}
    </div></nav>
    {sub.length > 1 && <nav className="subnav"><div className="wrap">
      {sub.filter(i => i[2].includes(role)).map(([to, label]) =>
        <NavLink key={to} to={to} end className={({ isActive }) => isActive ? 'active' : ''}>{label}</NavLink>)}
    </div></nav>}
    <main className="wrap"><Outlet /></main>
    <footer><div className="wrap">
      АКП-Монітор · прототип для IV Хакатону з питань виховання доброчесності та запобігання корупції (BITEC, 2026).
      Усі дані синтетичні; персональних даних, службової інформації та інформації з обмеженим доступом система не містить.
      Висновки формуються за явними правилами (<code>rules.yaml</code>), рішення ухвалює посадова особа. API: <a href="/api/docs/">/api/docs/</a>
    </div></footer>
  </>
}

export { ALL }
