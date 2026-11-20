import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, BookOpen, CalendarClock, CalendarDays, ChevronDown, ChevronRight, ClipboardCheck, ClipboardList, FileText, Flag, History,
  KeyRound, LayoutDashboard, Lightbulb, ListChecks, LogOut, Menu, MessageSquareText, Moon, PanelLeftClose, PanelLeftOpen,
  Settings, ShieldAlert, Sun, Users, X,
} from 'lucide-react'
import { fmtDate } from '../api'
import logoUrl from '../assets/hnuvs-logo.png'
import { useAuth, type Role } from '../auth'
import { Watermark } from './Watermark'

export function Emblem({ size = 48, className = '' }: { size?: number; className?: string }) {
  const [src, setSrc] = useState<string>(logoUrl)
  return (
    <img
      className={`logo ${className}`.trim()}
      src={src}
      width={size}
      height={size}
      alt="Емблема ХНУВС"
      decoding="async"
      draggable={false}
      onError={() => { if (src !== '/hnuvs-logo.png') setSrc('/hnuvs-logo.png') }}
      style={{ width: size, height: size }}
    />
  )
}

export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('akp_theme')
      if (saved === 'dark' || saved === 'light') return saved
    } catch { /* ignore */ }
    return 'light'
  })

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
      root.classList.remove('light')
    } else {
      root.classList.add('light')
      root.classList.remove('dark')
    }
    try { localStorage.setItem('akp_theme', theme) } catch { /* ignore */ }
  }, [theme])

  const toggleTheme = () => setTheme(prev => (prev === 'light' ? 'dark' : 'light'))
  return { theme, toggleTheme }
}

type Icon = ComponentType<{ size?: number; strokeWidth?: number }>
type Item = [string, string, Role[], Icon]
const ALL: Role[] = ['KOORD', 'ADMIN', 'KER', 'VYK', 'AUDIT']
const VIEW: Role[] = ['KOORD', 'ADMIN', 'KER', 'AUDIT']

const GROUPS: { label: string; items: Item[] }[] = [
  { label: 'Мій кабінет', items: [
    ['/my', 'Мої заходи', ['VYK'], ClipboardList],
    ['/my/calendar', 'Строки і нагадування', ['VYK'], CalendarClock],
  ] },
  { label: 'Антикорупційна програма', items: [
    ['/program/dashboard', 'Моніторинг', VIEW, LayoutDashboard],
    ['/program/measures', 'Реєстр заходів', VIEW, ListChecks],
    ['/program/approvals', 'Погодження', ['KOORD', 'ADMIN'], ClipboardCheck],
    ['/program/flags', 'Сигнали (Risk Flags)', VIEW, Flag],
    ['/program/risks', 'Корупційні ризики', VIEW, ShieldAlert],
    ['/program/recommendations', 'Рекомендації', VIEW, Lightbulb],
    ['/program/calendar', 'Календар строків', VIEW, CalendarDays],
    ['/program/reports', 'Звіти', VIEW, FileText],
    ['/program/audit', 'Журнал дій', VIEW, History],
    ['/program/passport', 'Паспорт програми', VIEW, BookOpen],
  ] },
  { label: 'Дослідження', items: [
    ['/surveys', 'Опитування', ['KOORD', 'ADMIN', 'AUDIT'], MessageSquareText],
  ] },
  { label: 'Адміністрування', items: [
    ['/admin/users', 'Користувачі', ['ADMIN'], Users],
    ['/admin/keys', 'Ключі доступу (.key)', ['ADMIN'], KeyRound],
    ['/admin/periods', 'Звітні вікна', ['ADMIN'], CalendarClock],
    ['/admin/system', 'Налаштування і стан системи', ['ADMIN'], Settings],
  ] },
]

const CABINET: Record<Role, string> = {
  KOORD: 'Кабінет уповноваженого', VYK: 'Кабінет виконавця', ADMIN: 'Кабінет техадміністратора',
  KER: 'Кабінет керівника', AUDIT: 'Кабінет внутрішнього аудитора',
}

const ROLE_TITLE: Record<Role, string> = {
  KOORD: 'Уповноважений',
  ADMIN: 'Технічний адміністратор',
  KER: 'Керівник',
  VYK: 'Виконавець',
  AUDIT: 'Внутрішній аудитор',
}

export default function Layout() {
  const { profile, today, periods, period, setPeriod, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const loc = useLocation()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  if (!profile) return null
  const role = profile.role
  const cur = periods.find(p => p.code === period)
  const groups = useMemo(() => {
    return GROUPS.map(g => ({ ...g, items: g.items.filter(i => i[2].includes(role)) })).filter(g => g.items.length)
  }, [role])
  const current = useMemo(() => {
    return GROUPS.flatMap(g => g.items).filter(i => loc.pathname.startsWith(i[0])).sort((a, b) => b[0].length - a[0].length)[0]
  }, [loc.pathname])
  const activeGroup = useMemo(() => {
    return groups.find(g => current && g.items.includes(current))
  }, [groups, current])
  const isDetailMeasure = loc.pathname.startsWith('/program/measures/') && loc.pathname !== '/program/measures'
  const detailCode = isDetailMeasure ? loc.pathname.split('/').pop() : null
  const section = role === 'VYK' && isDetailMeasure ? 'Мій кабінет' : activeGroup?.label
  const sectionDefaultPath = role === 'VYK' ? '/my' : (activeGroup?.items[0]?.[0] || (role === 'ADMIN' ? '/admin/users' : '/program/dashboard'))
  const currentLabel = isDetailMeasure ? (role === 'VYK' ? (detailCode || '') : `Захід ${detailCode}`) : (current?.[1] || 'АКП-Монітор')
  const initials = (profile.unit?.code || profile.role).slice(0, 3)
  const showSidebarLabels = !collapsed || open

  useEffect(() => {
    setOpen(false)
    setUserMenuOpen(false)
  }, [loc.pathname])

  useEffect(() => {
    if (!open && !userMenuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    if (open) document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, userMenuOpen])

  const canGoBack = isDetailMeasure || loc.pathname !== sectionDefaultPath

  const handleStepBack = () => {
    if (isDetailMeasure) {
      nav('/program/measures')
    } else if (window.history.length > 1) {
      nav(-1)
    } else {
      nav(sectionDefaultPath)
    }
  }

  const handleLogout = async () => {
    setUserMenuOpen(false)
    setOpen(false)
    await logout()
    nav('/login')
  }

  return <div className={`app ${open ? 'nav-open' : ''} ${collapsed ? 'sb-collapsed' : ''}`}>
    <aside className="sidebar" aria-label="Навігація">
      <div className="sb-brand">
        <Link to="/" className="sb-logo-link" title="На головну" onClick={() => setOpen(false)}>
          <Emblem size={38} />
        </Link>
        {showSidebarLabels && <div className="sb-brand-text"><strong>АКП-Монітор</strong><span>{CABINET[role]}</span></div>}
        <button
          type="button"
          className="btn ghost small icon sb-toggle-desktop"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Розгорнути бокову панель' : 'Згорнути бокову панель'}
          aria-label={collapsed ? 'Розгорнути бокову панель' : 'Згорнути бокову панель'}
        >
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
        <button type="button" className="btn ghost small icon sb-close" onClick={() => setOpen(false)} aria-label="Закрити меню"><X size={18} /></button>
      </div>
      <div className="sb-scroll">
        {groups.map(g => <div className="sb-group" key={g.label}>
          {showSidebarLabels && <div className="sb-label">{g.label}</div>}
          {g.items.map(([to, label, , Ico]) =>
            <NavLink key={to} to={to} end={to === '/my'} title={label} onClick={() => setOpen(false)} className={({ isActive }) => `sb-link ${isActive ? 'active' : ''}`}>
              <Ico size={18} strokeWidth={1.75} />{showSidebarLabels && <span>{label}</span>}
            </NavLink>)}
        </div>)}
      </div>
    </aside>
    <div className="scrim" onClick={() => setOpen(false)} aria-hidden />

    <div className="content">
      <header className="header">
        <button type="button" className="btn ghost icon menu-btn" onClick={() => setOpen(true)} aria-label="Відкрити меню"><Menu size={19} /></button>
        {collapsed && (
          <button type="button" className="btn ghost small icon hide-sm" onClick={() => setCollapsed(false)} title="Розгорнути панель">
            <PanelLeftOpen size={18} />
          </button>
        )}
        <nav className="crumbs" aria-label="Навігаційний шлях">
          {canGoBack && (
            <button type="button" className="crumb-back-btn" onClick={handleStepBack} title="Повернутися на попередню сторінку">
              <ArrowLeft size={15} />
              <span className="crumb-back-text">Назад</span>
            </button>
          )}
          {section && (
            <>
              {loc.pathname !== sectionDefaultPath ? (
                <button
                  type="button"
                  onClick={() => nav(sectionDefaultPath)}
                  className="crumb-link hide-sm"
                  title={`Перейти у розділ «${section}»`}
                >
                  {section}
                </button>
              ) : (
                <span className="hide-sm">{section}</span>
              )}
              <ChevronRight size={15} className="hide-sm" style={{ flexShrink: 0 }} />
            </>
          )}
          {isDetailMeasure && (
            <>
              <button
                type="button"
                onClick={() => nav(role === 'VYK' ? '/my' : '/program/measures')}
                className="crumb-link hide-sm"
                title={role === 'VYK' ? 'Повернутися до моїх заходів' : 'Повернутися до реєстру заходів'}
              >
                {role === 'VYK' ? 'Мої заходи' : 'Реєстр заходів'}
              </button>
              <ChevronRight size={15} className="hide-sm" style={{ flexShrink: 0 }} />
            </>
          )}
          <b className="crumb-current-title">{currentLabel}</b>
        </nav>
        <div className="tools">
          {cur && <span className={`chip hide-md ${cur.is_open ? 'open' : 'closed'}`}
            title={`Вікно внесення ${cur.code}: ${fmtDate(cur.window_start)}–${fmtDate(cur.window_end)}`}>
            <i className="dot" />Вікно {cur.is_open ? 'відкрите' : 'закрите'}
          </span>}
          {today && <span className="chip hide-md" title="Робоча дата системи">{fmtDate(today)}</span>}
          <label className="select-wrap" title="Звітний період">
            <CalendarDays size={15} />
            <select value={period} onChange={e => setPeriod(e.target.value)} aria-label="Звітний період">
              {periods.map(p => <option key={p.code} value={p.code}>{p.code.replace('-Q', ' · ')} кв.</option>)}
            </select>
          </label>
          <button
            type="button"
            className="btn secondary small icon hide-xs"
            onClick={toggleTheme}
            title={theme === 'light' ? 'Увімкнути темну тему' : 'Увімкнути світлу тему'}
            aria-label="Перемкнути тему"
          >
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          <div className="header-user-wrap">
            <button
              type="button"
              className="header-account-btn"
              onClick={() => setUserMenuOpen(v => !v)}
              title={`${ROLE_TITLE[role] || CABINET[role]} · ${profile.code}`}
              aria-label="Обліковий запис"
              aria-expanded={userMenuOpen}
            >
              <span className="avatar">{initials}</span>
              <span className="header-account-name hide-sm">{profile.code}</span>
              <ChevronDown size={14} className="header-account-caret hide-sm" />
            </button>
            {userMenuOpen && (
              <>
                <div className="user-pop-scrim" onClick={() => setUserMenuOpen(false)} aria-hidden />
                <div className="user-popover" role="dialog" aria-label="Профіль користувача">
                  <div className="user-popover-head">
                    <div className="avatar">{initials}</div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <b>{ROLE_TITLE[role] || profile.role_name || CABINET[role]} · {profile.code}</b>
                      {profile.unit && <small>{profile.unit.code} · {profile.unit.name}</small>}
                      {profile.position && <small>{profile.position}</small>}
                    </div>
                  </div>
                  {(cur || today) && (
                    <div className="user-popover-meta show-sm">
                      {cur && (
                        <div className="meta-line">
                          <span className="muted">Вікно {cur.code}:</span>
                          <span className={`pill ${cur.is_open ? 'ok' : 'grey'}`}>
                            {cur.is_open ? 'відкрите' : 'закрите'} ({fmtDate(cur.window_start)}–{fmtDate(cur.window_end)})
                          </span>
                        </div>
                      )}
                      {today && (
                        <div className="meta-line">
                          <span className="muted">Робоча дата:</span>
                          <b>{fmtDate(today)}</b>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="user-popover-actions">
                    <button type="button" className="btn secondary small show-xs" style={{ width: '100%', marginBottom: '.5rem' }} onClick={toggleTheme}>
                      {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
                      <span>{theme === 'light' ? 'Темна тема' : 'Світла тема'}</span>
                    </button>
                    <button type="button" className="btn danger small" style={{ width: '100%' }} onClick={handleLogout}>
                      <LogOut size={15} />
                      <span>Вийти з акаунту</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="page"><Outlet /></main>
      <Watermark />
      <footer><div className="wrap">
        © {new Date().getFullYear()} Харківський національний університет внутрішніх справ (ХНУВС) · АКП-Монітор. Усі права захищені.
      </div></footer>
    </div>
  </div>
}

export { ALL }
