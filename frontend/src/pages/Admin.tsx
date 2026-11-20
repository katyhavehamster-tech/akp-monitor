import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Download, KeyRound, Laptop, LogOut, Radio, RefreshCw, ShieldAlert, X } from 'lucide-react'
import { api, fmtDate, fmtDateTime, type Any } from '../api'
import { useAuth } from '../auth'
import { Card, ErrorBox, Loading, Pill, useApi } from '../components/ui'
import { downloadKeyFile, generateKeyFile, type KeyFileContainer } from '../keyFileCrypto'


const ROLES: [string, string][] = [['KOORD', 'Уповноважений (адміністратор програми)'], ['ADMIN', 'Технічний адміністратор'],
  ['KER', 'Керівник'], ['VYK', 'Виконавець'], ['ANAL', 'Аналітик']]

export function AdminUsers() {
  const { profile, reloadMe } = useAuth()
  const { data, error, reload } = useApi<Any[]>('users')
  const units = useApi<Any[]>('units')
  const sys = useApi<Any>('settings')
  const [f, setF] = useState<Any>({ role: 'VYK' })
  const [sig1, setSig1] = useState('')
  const [sig2, setSig2] = useState('')
  const [err, setErr] = useState('')
  const [pwFor, setPwFor] = useState<string | null>(null)
  const [delFor, setDelFor] = useState<string | null>(null)
  const [pw, setPw] = useState('')
  const [ok, setOk] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [createdKeyInfo, setCreatedKeyInfo] = useState<{
    userCode: string
    username: string
    role: string
    filename: string
    fingerprint: string
    keyFile: KeyFileContainer
  } | null>(null)

  useEffect(() => {
    if (sys.data) {
      setSig1(sys.data.signatory_name || '')
      setSig2(sys.data.head_signatory_name || '')
    }
  }, [sys.data])

  if (error) return <ErrorBox msg={error} />
  if (!data) return <Loading />

  const create = async () => {
    setErr('')
    const code = (f.code || '').trim().toUpperCase()
    if (!code) {
      setErr('Вкажіть код користувача (наприклад, U-020).')
      return
    }
    const keyPassword = (f.password || 'demo').trim()
    if (keyPassword.length < 4) {
      setErr('Пароль захисту ключа має містити щонайменше 4 символи.')
      return
    }
    setCreateBusy(true)
    try {
      const username = code.toLowerCase()
      // 1. Генерація криптографічного ключа ECDSA P-256 безпосередньо у браузері
      const { keyFile, filename } = await generateKeyFile(username, f.role || 'VYK', keyPassword)

      // 2. Автоматичне завантаження згенерованого файлу ключа
      downloadKeyFile(keyFile, filename)

      // 3. Створення користувача на сервері із передачею ЛИШЕ публічного ключа
      await api('users', {
        body: {
          ...f,
          code,
          public_key_pem: keyFile.crypto.public_key,
          fingerprint: keyFile.fingerprint,
        },
      })

      // 4. Відображення модального вікна успішного випуску (запобігання втраті ключа)
      setCreatedKeyInfo({
        userCode: code,
        username,
        role: f.role || 'VYK',
        filename,
        fingerprint: keyFile.fingerprint,
        keyFile,
      })
      setF({ role: 'VYK', password: '' })
      reload()
    } catch (e) {
      setErr((e as Error).message || 'Помилка створення облікового запису.')
    } finally {
      setCreateBusy(false)
    }
  }

  const patch = async (code: string, body: Any, msg = 'Збережено.') => {
    setErr(''); setOk('')
    try { await api(`users/${code}`, { method: 'PATCH', body }); setOk(`${code}: ${msg}`); reload(); sys.reload(); await reloadMe() } catch (e) { setErr((e as Error).message) }
  }
  const saveSignatories = async () => {
    setErr(''); setOk('')
    try {
      await api('settings', { method: 'PATCH', body: { signatory_name: sig1, head_signatory_name: sig2 } })
      setOk('ПІБ підписантів для звітів (Друк та Word) успішно збережено!')
      reload(); sys.reload(); await reloadMe()
    } catch (e) { setErr((e as Error).message) }
  }
  const removeUser = async (code: string) => {
    setErr(''); setOk('')
    try {
      await api(`users/${code}`, { method: 'DELETE' })
      setDelFor(null)
      setOk(`Користувача ${code} видалено.`)
      reload()
    } catch (e) { setErr((e as Error).message) }
  }
  return <>
    <h1>Користувачі та ролі</h1>
    <Card title="Умовні реквізити підписантів для друкованих форм і звітів Word (ДСТУ 4163:2020)">
      <div className="grid g3" style={{ alignItems: 'end' }}>
        <label className="f">Уповноважена особа / головний спеціаліст (умовне Власне імʼя ПРІЗВИЩЕ)
          <input value={sig1} onChange={e => setSig1(e.target.value)} placeholder="Олександр КОВАЛЕНКО" />
        </label>
        <label className="f">Керівник органу (умовне Власне імʼя ПРІЗВИЩЕ)
          <input value={sig2} onChange={e => setSig2(e.target.value)} placeholder="Валерій СОКОЛОВ" />
        </label>
        <div style={{ marginBottom: '.85rem' }}>
          <button type="button" className="btn" onClick={saveSignatories}>Зберегти реквізити</button>
        </div>
      </div>
      <small className="muted">Облікові записи в системі знеособлені (описані лише кодом, роллю, підрозділом і посадою — без персональних даних). Умовні імена вище підставляються виключно у реквізит «Підпис» паперових і Word-звітів за ДСТУ 4163:2020.</small>
    </Card>

    <Card title="Новий обліковий запис">
      <div className="grid g3" style={{ alignItems: 'end' }}>
        <label className="f">Код (логін)<input value={f.code || ''} onChange={e => setF({ ...f, code: e.target.value })} placeholder="U-020" /></label>
        <label className="f">Роль<select value={f.role} onChange={e => setF({ ...f, role: e.target.value })}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="f">Підрозділ<select value={f.unit || ''} onChange={e => setF({ ...f, unit: e.target.value })}><option value="">—</option>
          {units.data?.map(u => <option key={u.code} value={u.code}>{u.code} {u.name}</option>)}</select></label>
        <label className="f">Посада<input value={f.position || ''} onChange={e => setF({ ...f, position: e.target.value })} placeholder="Головний спеціаліст" /></label>
        <div className="admin-create-pw span2-lg">
          <label className="f" style={{ flex: 1, marginBottom: 0 }}>Пароль захисту ключа (.key)
            <input type="password" value={f.password || ''} onChange={e => setF({ ...f, password: e.target.value })} placeholder="demo" />
          </label>
          <button type="button" className="btn" disabled={createBusy} onClick={create}>
            {createBusy ? 'Генерація ключа…' : 'Створити та випустити .key'}
          </button>
        </div>
      </div>
      {err && <div className="alert danger">{err}</div>}
    </Card>
    {ok && <div className="alert success">{ok}</div>}
    <Card><div className="table-wrap"><table className="t"><thead><tr><th>Код</th><th>Роль</th><th>Підрозділ</th><th>Посада</th><th>Стан</th><th>Дії</th></tr></thead><tbody>
      {data.map(u => <tr key={u.code}>
        <td className="nowrap"><b>{u.code}</b><br /><small className="muted">{u.username}</small></td>
        <td style={{ minWidth: 175 }}><select style={{ width: '100%', minWidth: 160 }} value={u.role} onChange={e => patch(u.code, { role: e.target.value })}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
        <td style={{ minWidth: 90 }}><select style={{ width: '100%', minWidth: 74 }} value={u.unit?.code || ''} onChange={e => patch(u.code, { unit: e.target.value })}><option value="">—</option>
          {units.data?.map(x => <option key={x.code} value={x.code}>{x.code}</option>)}</select></td>
        <td style={{ minWidth: 180 }}><small>{u.position}</small></td>
        <td className="nowrap">{u.is_active ? <Pill tone="ok">активний</Pill> : <Pill tone="grey">заблоковано</Pill>}</td>
        <td>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <button type="button" className="btn secondary small" onClick={() => patch(u.code, { is_active: !u.is_active })}>{u.is_active ? 'Заблокувати' : 'Розблокувати'}</button>
            {pwFor === u.code
              ? <span className="row" style={{ flexWrap: 'nowrap' }}><input type="password" placeholder="новий пароль" value={pw} onChange={e => setPw(e.target.value)} style={{ width: 135, minWidth: 120 }} />
                <button type="button" className="btn small" disabled={!pw} onClick={async () => { await patch(u.code, { password: pw }, 'пароль змінено.'); setPwFor(null); setPw('') }}>Зберегти</button>
                <button type="button" className="btn secondary small" onClick={() => setPwFor(null)}>Скасувати</button></span>
              : <button type="button" className="btn secondary small" onClick={() => { setPwFor(u.code); setPw('') }}>Скинути пароль</button>}
            {profile?.code !== u.code && (
              delFor === u.code ? (
                <span className="row" style={{ flexWrap: 'nowrap' }}>
                  <button type="button" className="btn danger small" onClick={() => removeUser(u.code)}>Підтвердити</button>
                  <button type="button" className="btn secondary small" onClick={() => setDelFor(null)}>Ні</button>
                </span>
              ) : (
                <button type="button" className="btn danger small" onClick={() => setDelFor(u.code)}>Видалити</button>
              )
            )}
          </div>
        </td>
      </tr>)}
    </tbody></table></div></Card>

    {/* Модальне вікно успішного створення користувача та випуску ключа */}
    {createdKeyInfo && (
      <div className="modal-backdrop" onClick={() => setCreatedKeyInfo(null)}>
        <div className="modal" style={{ maxWidth: 540 }} onClick={e => e.stopPropagation()}>
          <div className="modal-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', minWidth: 0, flex: '1 1 auto' }}>
              <CheckCircle2 size={20} style={{ color: 'var(--ok, #10b981)', flexShrink: 0 }} />
              <h3 style={{ margin: 0, wordBreak: 'break-word', fontSize: '1.05rem' }}>Обліковий запис та ключ створено</h3>
            </div>
            <button
              type="button"
              className="modal-close-btn"
              onClick={() => setCreatedKeyInfo(null)}
              aria-label="Закрити"
              style={{ flexShrink: 0, marginLeft: 'auto' }}
            >
              <X size={18} />
            </button>
          </div>

          <div className="modal-body">
            <div className="alert success" style={{ margin: 0 }}>
              Обліковий запис <b>{createdKeyInfo.userCode}</b> успішно створено, а персональний файл ключа <b>{createdKeyInfo.filename}</b> згенеровано у браузері.
            </div>

            <div style={{ background: 'var(--surface-2, rgba(255,255,255,0.04))', border: '1px solid var(--line, #333)', borderRadius: 8, padding: '1rem', display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="muted" style={{ fontSize: '.84rem' }}>Файл ключа:</span>
                <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{createdKeyInfo.filename}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="muted" style={{ fontSize: '.84rem' }}>Користувач / Логін:</span>
                <span><b>{createdKeyInfo.userCode}</b> ({createdKeyInfo.username})</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="muted" style={{ fontSize: '.84rem' }}>Роль у системі:</span>
                <Pill tone="info">{createdKeyInfo.role}</Pill>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '.82rem', marginBottom: '.3rem' }}>SHA-256 відбиток публічного ключа:</div>
                <code style={{ fontSize: '.76rem', background: 'var(--surface-1, #111)', padding: '4px 8px', borderRadius: 4, display: 'block', wordBreak: 'break-all', color: 'var(--accent, #60a5fa)' }}>
                  {createdKeyInfo.fingerprint}
                </code>
              </div>
            </div>

            <button
              type="button"
              className="btn primary"
              style={{ padding: '.75rem 1rem', fontSize: '.95rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.5rem' }}
              onClick={() => downloadKeyFile(createdKeyInfo.keyFile, createdKeyInfo.filename)}
            >
              <Download size={18} />
              <span>Завантажити ключ ({createdKeyInfo.filename})</span>
            </button>

            <div className="hint" style={{ fontSize: '.82rem', margin: 0, lineHeight: 1.45 }}>
              Збережіть файл ключа у надійному місці. Приватний ключ існує виключно у завантаженому файлі та не передавався на сервер. Якщо автозавантаження заблоковано браузером, натисніть кнопку вище.
            </div>
          </div>

          <div className="modal-actions">
            <button
              type="button"
              className="btn secondary"
              onClick={() => setCreatedKeyInfo(null)}
            >
              Готово
            </button>
          </div>
        </div>
      </div>
    )}
  </>
}

export function AdminPeriods() {
  const { periods: ctxPeriods, reloadMe } = useAuth()
  const [local, setLocal] = useState<Any[] | null>(null)
  const periods = local || ctxPeriods
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const patch = async (code: string, body: Any) => {
    setErr(''); setOk('')
    try {
      const upd = await api(`periods/${code}`, { method: 'PATCH', body })
      setLocal(periods.map(p => p.code === code ? upd : p)); setOk(`${code}: збережено.`); await reloadMe()
    } catch (e) { setErr((e as Error).message) }
  }
  return <>
    <h1>Звітні вікна</h1>
    <div className="hint">Виконавці вносять інформацію 4 рази на рік — протягом вікна (за замовчуванням 5 днів) після завершення кварталу. Поза вікном доступний лише перегляд;
      уповноважений може вносити зміни будь-коли. Вікно можна відкрити позачергово (наприклад, для виправлень на вимогу координатора).</div>
    {err && <div className="alert danger">{err}</div>}
    {ok && <div className="alert success">{ok}</div>}
    <Card><div className="table-wrap"><table className="t"><thead><tr><th>Період</th><th>Квартал</th><th>Початок вікна</th><th>Кінець вікна</th><th>Стан</th><th>Позачергово</th></tr></thead><tbody>
      {periods.map(p => <tr key={p.code}>
        <td><b>{p.code}</b></td><td>{fmtDate(p.start)} – {fmtDate(p.end)}</td>
        <td><input type="date" defaultValue={p.window_start} onBlur={e => e.target.value !== p.window_start && patch(p.code, { window_start: e.target.value })} /></td>
        <td><input type="date" defaultValue={p.window_end} onBlur={e => e.target.value !== p.window_end && patch(p.code, { window_end: e.target.value })} /></td>
        <td>{p.is_open ? <Pill tone="ok">відкрите</Pill> : <Pill tone="grey">закрите</Pill>}</td>
        <td><label className="row" style={{ gap: '.3rem' }}><input type="checkbox" checked={p.force_open} onChange={e => patch(p.code, { force_open: e.target.checked })} /> відкрити</label></td>
      </tr>)}
    </tbody></table></div></Card>
  </>
}

const COUNT_NAMES: Record<string, string> = { measures: 'Заходів', risks: 'Ризиків', executions: 'Записів про виконання', evidence: 'Підтверджень',
  evidence_files: 'Файлів підтверджень', audit: 'Записів журналу', users: 'Користувачів', surveys: 'Опитувань' }

export function AdminSystem() {
  const { reloadMe } = useAuth()
  const s = useApi<Any>('settings')
  const h = useApi<Any>('system/health')
  const [sig1, setSig1] = useState('')
  const [sig2, setSig2] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (s.data) {
      setSig1(s.data.signatory_name || '')
      setSig2(s.data.head_signatory_name || '')
    }
  }, [s.data])

  if (s.error) return <ErrorBox msg={s.error} />
  if (!s.data || !h.data) return <Loading />
  const save = async (body: Any) => {
    await api('settings', { method: 'PATCH', body }); setMsg('Збережено.'); s.reload(); h.reload(); await reloadMe()
  }
  return <>
    <h1>Налаштування і стан системи</h1>
    <div className="grid g2" style={{ alignItems: 'start' }}>
      <Card title="Налаштування системи та реквізити підписантів (Друк та Word-звіти)">
        <label className="f">Робоча (демонстраційна) дата — порожньо = сьогодні
          <input type="date" defaultValue={s.data.today_override || ''} onBlur={e => save({ today_override: e.target.value || null })} /></label>
        <label className="f">Тривалість вікна внесення, днів<input type="number" defaultValue={s.data.window_days} onBlur={e => save({ window_days: e.target.value })} /></label>
        <label className="f">Нагадувати про строк за, днів<input type="number" defaultValue={s.data.reminder_days} onBlur={e => save({ reminder_days: e.target.value })} /></label>
        <label className="f">Мінімум відповідей для показу результатів опитування<input type="number" defaultValue={s.data.min_survey_group} onBlur={e => save({ min_survey_group: e.target.value })} /></label>
        <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '1rem 0' }} />
        <label className="row" style={{ gap: '.6rem', alignItems: 'flex-start', cursor: 'pointer', marginBottom: '1rem' }}>
          <input
            type="checkbox"
            checked={!!s.data.izod_audit_mode}
            onChange={e => save({ izod_audit_mode: e.target.checked })}
            style={{ marginTop: '.2rem' }}
          />
          <div>
            <b>Режим ІзОД: посилений аудит переглядів та експорту</b>
            <div className="muted" style={{ fontSize: '.85rem', marginTop: '.2rem' }}>
              Фіксувати в незмінному криптографічному ланцюжку SHA-256 не лише зміни даних, а й кожне відкриття картки заходу, вивантаження підтвердних файлів (Evidence) та експорт/друк звітів.
            </div>
          </div>
        </label>
        <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '1rem 0' }} />
        <label className="f">Власне імʼя та ПРІЗВИЩЕ уповноваженої особи / спеціаліста (для підпису при Друці та у Word)
          <input value={sig1} onChange={e => setSig1(e.target.value)} placeholder="Олександр КОВАЛЕНКО" /></label>
        <label className="f">Власне імʼя та ПРІЗВИЩЕ керівника органу (для підпису при Друці та у Word)
          <input value={sig2} onChange={e => setSig2(e.target.value)} placeholder="Валерій СОКОЛОВ" /></label>
        <div className="row" style={{ marginBottom: '.6rem' }}>
          <button className="btn" onClick={() => save({ signatory_name: sig1, head_signatory_name: sig2 })}>Зберегти реквізити підписантів</button>
        </div>
        {msg && <div className="alert success">{msg}</div>}
        <small className="muted">Кожна зміна налаштувань фіксується в журналі дій і автоматично підтягується під час друку та експорту Word-файлів.</small>
      </Card>
      <Card title="Стан системи">
        <dl className="kv">
          <dt>База даних</dt><dd>{h.data.db_engine}</dd>
          <dt>Зовнішні сервіси</dt><dd>{h.data.external_services}</dd>
          <dt>Журнал дій</dt><dd>{h.data.audit_chain.ok ? <Pill tone="ok">ланцюжок цілісний ({h.data.audit_chain.checked})</Pill> : <Pill tone="bad">порушено на #{h.data.audit_chain.broken_at}</Pill>}</dd>
          <dt>Файли підтверджень</dt><dd>{h.data.counts.evidence_files} файлів; {h.data.evidence_integrity_failed.length ? <Pill tone="bad">змінено: {h.data.evidence_integrity_failed.join(', ')}</Pill> : <Pill tone="ok">контрольні суми збігаються</Pill>}</dd>
          {Object.entries(h.data.counts).map(([k, v]) => [<dt key={k}>{COUNT_NAMES[k] || k}</dt>, <dd key={k + 'v'}>{String(v)}</dd>])}
        </dl>
        <p style={{ marginTop: '.8rem' }}><a href="/api/docs/" target="_blank" rel="noreferrer">Документація API (OpenAPI/Swagger)</a> · <a href="/django-admin/" target="_blank" rel="noreferrer">Адмін-панель Django</a></p>
      </Card>
    </div>
  </>
}

function parseDevice(ua: string): string {
  if (!ua || ua === '—') return 'Невідомий пристрій'
  let os = 'OS'
  if (ua.includes('Windows')) os = 'Windows'
  else if (ua.includes('Macintosh') || ua.includes('Mac OS')) os = 'macOS'
  else if (ua.includes('Android')) os = 'Android'
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS'
  else if (ua.includes('Linux')) os = 'Linux'

  let browser = 'Браузер'
  if (ua.includes('Edg/')) browser = 'Edge'
  else if (ua.includes('Chrome/')) browser = 'Chrome'
  else if (ua.includes('Firefox/')) browser = 'Firefox'
  else if (ua.includes('Safari/')) browser = 'Safari'

  return `${browser} (${os})`
}

export function AdminKeys() {
  const { data, error, reload } = useApi<Any[]>('admin/keys')
  const [tab, setTab] = useState<'keys' | 'sessions'>('keys')
  const [sessionsData, setSessionsData] = useState<{ sessions: Any[]; total_count: number; online_count: number } | null>(null)
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [modalUser, setModalUser] = useState<Any | null>(null)
  const [generatedKey, setGeneratedKey] = useState<{
    user: Any
    filename: string
    keyFile: KeyFileContainer
  } | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [revokeFor, setRevokeFor] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true)
    try {
      const res = await api<{ sessions: Any[]; total_count: number; online_count: number }>('admin/sessions')
      setSessionsData(res)
    } catch (e: any) {
      setErr((e as Error).message || 'Помилка завантаження сесій.')
    } finally {
      setLoadingSessions(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'sessions') {
      loadSessions()
    }
  }, [tab, loadSessions])

  if (error) return <ErrorBox msg={error} />
  if (!data) return <Loading />

  const closeModal = () => {
    if (busy) return
    setModalUser(null)
    setGeneratedKey(null)
    setPassword('')
    setErr('')
  }

  const issueKey = async () => {
    if (!modalUser) return
    const pw = password.trim()
    if (!pw || pw.length < 4) {
      setErr('Пароль захисту має містити щонайменше 4 символи.')
      return
    }

    setBusy(true)
    setErr('')
    try {
      // 1. Локальна генерація пари ключів у браузері через Web Crypto API
      const { keyFile, filename } = await generateKeyFile(modalUser.username, modalUser.role, pw)

      // 2. Автоматичне завантаження файлу .key на комп'ютер адміністратора
      downloadKeyFile(keyFile, filename)

      // 3. Реєстрація публічного ключа на сервері (приватний ключ НЕ передається)
      await api('admin/keys/register', {
        body: {
          user_code: modalUser.code,
          public_key_pem: keyFile.crypto.public_key,
          fingerprint: keyFile.fingerprint,
        },
      })

      setOk(`Ключ для ${modalUser.code} успішно випущено! Файл «${filename}» збережено.`)
      // Не закриваємо модальне вікно, а переводимо у стан успіху для збереження/повторного завантаження
      setGeneratedKey({
        user: modalUser,
        filename,
        keyFile,
      })
      setPassword('')
      reload()
      if (tab === 'sessions') loadSessions()
    } catch (e) {
      setErr((e as Error).message || 'Помилка випуску ключа.')
    } finally {
      setBusy(false)
    }
  }

  const revokeKey = async (code: string) => {
    setErr('')
    setOk('')
    try {
      await api(`admin/keys/${code}/revoke`, { method: 'POST' })
      setOk(`Ключ доступу користувача ${code} успішно відкликано. Активні сесії анульовано.`)
      setRevokeFor(null)
      reload()
      if (tab === 'sessions') loadSessions()
    } catch (e) {
      setErr((e as Error).message || 'Помилка відкликання ключа.')
    }
  }

  const terminateSession = async (sessionId: number, userCode: string) => {
    setBusy(true)
    setErr('')
    setOk('')
    try {
      await api(`admin/sessions/${sessionId}/terminate`, { method: 'POST' })
      setOk(`Активну сесію користувача ${userCode} успішно примусово завершено.`)
      await loadSessions()
    } catch (e: any) {
      setErr((e as Error).message || 'Помилка завершення сесії.')
    } finally {
      setBusy(false)
    }
  }

  const terminateUserSessions = async (userCode: string) => {
    if (!window.confirm(`Ви впевнені, що бажаєте примусово завершити всі активні сесії користувача ${userCode}?`)) {
      return
    }
    setBusy(true)
    setErr('')
    setOk('')
    try {
      const res = await api<{ ok: boolean; terminated_count: number }>(`admin/sessions/terminate-user/${encodeURIComponent(userCode)}`, { method: 'POST' })
      setOk(`Примусово завершено всі сесії користувача ${userCode} (${res.terminated_count} сеансів).`)
      await loadSessions()
    } catch (e: any) {
      setErr((e as Error).message || 'Помилка завершення сесій користувача.')
    } finally {
      setBusy(false)
    }
  }

  const terminateAllOtherSessions = async () => {
    if (!window.confirm('Ви впевнені, що бажаєте примусово завершити ВСІ активні сесії інших користувачів?')) {
      return
    }
    setBusy(true)
    setErr('')
    setOk('')
    try {
      const res = await api<{ ok: boolean; terminated_count: number }>('admin/sessions/terminate-all', { method: 'POST' })
      setOk(`Примусово завершено ${res.terminated_count} сесій користувачів.`)
      await loadSessions()
    } catch (e: any) {
      setErr((e as Error).message || 'Помилка завершення сесій.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ marginBottom: '.25rem' }}>Безпека та доступ (.key / Сесії)</h1>
          <div className="muted" style={{ fontSize: '.88rem' }}>
            Управління асиметричними електронними ключами ECDSA P-256, сертифікатами та активними сесіями
          </div>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: '1rem' }}>
        <button
          type="button"
          className={tab === 'keys' ? 'active' : ''}
          onClick={() => setTab('keys')}
        >
          <KeyRound size={16} style={{ marginRight: '.45rem' }} />
          Ключі доступу (.key)
        </button>
        <button
          type="button"
          className={tab === 'sessions' ? 'active' : ''}
          onClick={() => setTab('sessions')}
        >
          <Radio size={16} style={{ marginRight: '.45rem' }} />
          Активні сесії
          {sessionsData && (
            <span
              className="pill ok"
              style={{
                marginLeft: '.5rem',
                fontSize: '.74rem',
                padding: '2px 7px',
                fontWeight: 700,
              }}
            >
              {sessionsData.online_count} онлайн
            </span>
          )}
        </button>
      </div>

      {err && <div className="alert danger" style={{ marginBottom: '1rem' }}>{err}</div>}
      {ok && <div className="alert success" style={{ marginBottom: '1rem' }}>{ok}</div>}

      {tab === 'keys' ? (
        <>
          <div className="hint" style={{ marginBottom: '1rem' }}>
            <b>Безпека ключів за аналогією з КЕП:</b> Приватні ключі шифруються алгоритмом AES-256-GCM за допомогою пароля захисту та зберігаються виключно у власників ключів.
            Сервер зберігає лише публічний ключ та SHA-256 відбиток для перевірки цифрового підпису при вході.
          </div>

          <Card>
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Користувач</th>
                    <th>Роль</th>
                    <th>Підрозділ</th>
                    <th>Стан ключа</th>
                    <th>SHA-256 відбиток</th>
                    <th>Дата випуску</th>
                    <th style={{ minWidth: 200 }}>Дії</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map(u => (
                    <tr key={u.code}>
                      <td className="nowrap">
                        <b>{u.code}</b>
                        <br />
                        <small className="muted">{u.username}</small>
                      </td>
                      <td>{u.role_name || u.role}</td>
                      <td>{u.unit?.code ? `${u.unit.code} — ${u.unit.name}` : '—'}</td>
                      <td className="nowrap">
                        {u.status === 'active' && <Pill tone="ok">Активний</Pill>}
                        {u.status === 'revoked' && <Pill tone="bad">Відкликано</Pill>}
                        {u.status === 'none' && <Pill tone="grey">Не випущено</Pill>}
                      </td>
                      <td>
                        {u.fingerprint ? (
                          <code style={{ fontSize: '.78rem', background: 'var(--surface-2)', padding: '2px 5px', borderRadius: 4 }}>
                            {u.fingerprint.slice(0, 16)}…{u.fingerprint.slice(-8)}
                          </code>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="nowrap">
                        {u.issued_at ? (
                          <small>{fmtDateTime(u.issued_at)}</small>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <div className="row" style={{ flexWrap: 'nowrap', gap: '.4rem', alignItems: 'center' }}>
                          <button
                            type="button"
                            className="btn small"
                            style={{ whiteSpace: 'nowrap' }}
                            onClick={() => {
                              setModalUser(u)
                              setGeneratedKey(null)
                              setPassword('')
                              setErr('')
                            }}
                          >
                            {u.status === 'active' ? 'Перевипустити .key' : 'Випустити .key'}
                          </button>

                          {u.status === 'active' && (
                            revokeFor === u.code ? (
                              <span className="row" style={{ flexWrap: 'nowrap', gap: '.3rem', alignItems: 'center' }}>
                                <button
                                  type="button"
                                  className="btn danger small"
                                  onClick={() => revokeKey(u.code)}
                                >
                                  Підтвердити
                                </button>
                                <button
                                  type="button"
                                  className="btn secondary small"
                                  onClick={() => setRevokeFor(null)}
                                >
                                  Ні
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="btn secondary small danger"
                                style={{ whiteSpace: 'nowrap' }}
                                onClick={() => setRevokeFor(u.code)}
                              >
                                Відкликати
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : (
        /* Секція моніторингу активних сесій */
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.75rem', marginBottom: '1rem', paddingBottom: '.75rem', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
              <span style={{ fontSize: '1.05rem', fontWeight: 700 }}>
                Моніторинг активних сеансів
              </span>
              {sessionsData && (
                <span className="pill info" style={{ fontSize: '.78rem', fontWeight: 600 }}>
                  Онлайн: <b>{sessionsData.online_count}</b> з {sessionsData.total_count}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn small secondary"
                disabled={loadingSessions}
                onClick={loadSessions}
                title="Оновити список активних сесій"
              >
                <RefreshCw size={14} style={{ marginRight: '.35rem' }} className={loadingSessions ? 'spin' : ''} />
                Оновити
              </button>
              {sessionsData && sessionsData.total_count > 1 && (
                <button
                  type="button"
                  className="btn small danger"
                  disabled={busy}
                  onClick={terminateAllOtherSessions}
                  title="Примусово завершити сесії всіх користувачів, крім власної"
                >
                  <ShieldAlert size={14} style={{ marginRight: '.35rem' }} />
                  Завершити всі інші сесії
                </button>
              )}
            </div>
          </div>

          {loadingSessions && !sessionsData ? (
            <Loading />
          ) : !sessionsData || sessionsData.sessions.length === 0 ? (
            <div className="muted" style={{ padding: '1.5rem', textAlign: 'center' }}>
              Активних сесій не знайдено.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Користувач</th>
                    <th>Статус</th>
                    <th>Роль / Підрозділ</th>
                    <th>Відбиток ключа</th>
                    <th>Пристрій / Браузер</th>
                    <th>IP-адреса</th>
                    <th>Вхід / Активність</th>
                    <th style={{ minWidth: 160 }}>Дія</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionsData.sessions.map(s => (
                    <tr key={s.id} style={s.is_current ? { background: 'rgba(59, 130, 246, 0.04)' } : undefined}>
                      <td className="nowrap">
                        <b>{s.user_code}</b>
                        <br />
                        <small className="muted">{s.username}</small>
                        {s.full_name && s.full_name !== s.user_code && (
                          <div style={{ fontSize: '.76rem', color: 'var(--muted)' }}>{s.full_name}</div>
                        )}
                      </td>
                      <td className="nowrap">
                        {s.is_online ? (
                          <span style={{ color: 'var(--ok, #10b981)', display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontWeight: 600, fontSize: '.84rem' }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ok, #10b981)', display: 'inline-block' }} />
                            Онлайн
                          </span>
                        ) : (
                          <span style={{ color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '.84rem' }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--muted)', display: 'inline-block' }} />
                            Неактивний
                          </span>
                        )}
                      </td>
                      <td>
                        <Pill tone="info">{s.role_name || s.role}</Pill>
                        {s.unit && (
                          <div style={{ fontSize: '.76rem', color: 'var(--muted)', marginTop: '.2rem' }}>
                            {s.unit.code}
                          </div>
                        )}
                      </td>
                      <td>
                        {s.key_fingerprint ? (
                          <code style={{ fontSize: '.76rem', background: 'var(--surface-2)', padding: '2px 5px', borderRadius: 4 }} title={s.key_fingerprint}>
                            {s.key_fingerprint.slice(0, 12)}…{s.key_fingerprint.slice(-6)}
                          </code>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.84rem' }} title={s.user_agent}>
                          <Laptop size={14} className="muted" />
                          <span>{parseDevice(s.user_agent)}</span>
                        </div>
                      </td>
                      <td className="nowrap">
                        <code style={{ fontSize: '.8rem' }}>{s.ip_address}</code>
                      </td>
                      <td className="nowrap" style={{ fontSize: '.8rem' }}>
                        <div><span className="muted">Вхід:</span> {fmtDateTime(s.created_at)}</div>
                        <div><span className="muted">Активність:</span> {fmtDateTime(s.last_activity)}</div>
                      </td>
                      <td>
                        {s.is_current ? (
                          <span className="pill info" style={{ fontWeight: 600 }}>Поточна сесія (ви)</span>
                        ) : (
                          <div className="row" style={{ gap: '.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            <button
                              type="button"
                              className="btn small secondary danger"
                              disabled={busy}
                              onClick={() => terminateSession(s.id, s.user_code)}
                              title={`Примусово завершити сесію користувача ${s.user_code}`}
                            >
                              <LogOut size={13} style={{ marginRight: '.3rem' }} />
                              Завершити сесію
                            </button>
                            <button
                              type="button"
                              className="btn mini ghost danger"
                              disabled={busy}
                              onClick={() => terminateUserSessions(s.user_code)}
                              title={`Примусово завершити всі активні сесії користувача ${s.user_code}`}
                            >
                              Всі сесії користувача
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Модальне вікно випуску / перевипуску ключа */}
      {modalUser && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" style={{ maxWidth: 540 }} onClick={e => e.stopPropagation()}>
            {generatedKey ? (
              // Стан успішного випуску ключа (запобігання втраті файлу)
              <>
                <div className="modal-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', minWidth: 0, flex: '1 1 auto' }}>
                    <CheckCircle2 size={20} style={{ color: 'var(--ok, #10b981)', flexShrink: 0 }} />
                    <h3 style={{ margin: 0, wordBreak: 'break-word', fontSize: '1.05rem' }}>Ключ доступу успішно випущено</h3>
                  </div>
                  <button
                    type="button"
                    className="modal-close-btn"
                    onClick={closeModal}
                    aria-label="Закрити"
                    style={{ flexShrink: 0, marginLeft: 'auto' }}
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="modal-body">
                  <div className="alert success" style={{ margin: 0 }}>
                    Електронний ключ для <b>{generatedKey.user.code}</b> ({generatedKey.user.username}) успішно згенеровано та зареєстровано на сервері.
                  </div>

                  <div style={{ background: 'var(--surface-2, rgba(255,255,255,0.04))', border: '1px solid var(--line, #333)', borderRadius: 8, padding: '1rem', display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="muted" style={{ fontSize: '.84rem' }}>Файл особистого ключа:</span>
                      <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{generatedKey.filename}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="muted" style={{ fontSize: '.84rem' }}>Користувач / Роль:</span>
                      <span><b>{generatedKey.user.code}</b> · <Pill tone="info">{generatedKey.user.role_name || generatedKey.user.role}</Pill></span>
                    </div>
                    <div>
                      <div className="muted" style={{ fontSize: '.82rem', marginBottom: '.3rem' }}>SHA-256 відбиток публічного ключа:</div>
                      <code style={{ fontSize: '.76rem', background: 'var(--surface-1, #111)', padding: '4px 8px', borderRadius: 4, display: 'block', wordBreak: 'break-all', color: 'var(--accent, #60a5fa)' }}>
                        {generatedKey.keyFile.fingerprint}
                      </code>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn primary"
                    style={{ padding: '.75rem 1rem', fontSize: '.95rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.5rem' }}
                    onClick={() => downloadKeyFile(generatedKey.keyFile, generatedKey.filename)}
                  >
                    <Download size={18} />
                    <span>Завантажити ключ ({generatedKey.filename})</span>
                  </button>

                  <div className="hint" style={{ fontSize: '.82rem', margin: 0, lineHeight: 1.45 }}>
                    Збережіть файл ключа у надійному місці. Приватний ключ існує виключно у цьому файлі та ніколи не зберігається на сервері. Якщо завантаження заблоковано браузером, натисніть кнопку вище.
                  </div>
                </div>

                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={closeModal}
                  >
                    Готово
                  </button>
                </div>
              </>
            ) : (
              // Форма введення пароля для генерації ключа
              <>
                <div className="modal-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', minWidth: 0, flex: '1 1 auto' }}>
                    <KeyRound size={20} className="muted" style={{ flexShrink: 0 }} />
                    <h3 style={{ margin: 0, wordBreak: 'break-word', fontSize: '1.05rem' }}>
                      {modalUser.status === 'active' ? 'Перевипуск' : 'Випуск'} ключа доступу (.key)
                    </h3>
                  </div>
                  <button
                    type="button"
                    className="modal-close-btn"
                    disabled={busy}
                    onClick={closeModal}
                    aria-label="Закрити"
                    style={{ flexShrink: 0, marginLeft: 'auto' }}
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="modal-body">
                  <div>
                    <b>Користувач:</b> {modalUser.code} ({modalUser.username}) — {modalUser.role_name || modalUser.role}
                  </div>

                  <div className="hint" style={{ fontSize: '.84rem', lineHeight: 1.45 }}>
                    Пара ключів <b>ECDSA P-256</b> буде згенерована безпосередньо у вашому браузері. Приватний ключ шифрується <b>AES-256-GCM</b> за вказаним паролем і зберігається у завантаженому файлі <code>akp_{modalUser.username.toLowerCase()}.key</code>.
                    <br /><br />
                    На сервер передається <u>виключно публічний ключ</u>.
                  </div>

                  <label className="f" style={{ marginBottom: 0 }}>
                    Пароль захисту нового ключа
                    <input
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Введіть надійний пароль захисту"
                    />
                  </label>

                  {err && <div className="alert danger">{err}</div>}
                </div>

                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={busy}
                    onClick={closeModal}
                  >
                    Скасувати
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !password.trim()}
                    onClick={issueKey}
                  >
                    {busy ? 'Генерація та випуск…' : 'Згенерувати та завантажити .key'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

