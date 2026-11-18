import { useEffect, useState } from 'react'
import { api, fmtDate, type Any } from '../api'
import { useAuth } from '../auth'
import { Card, ErrorBox, Loading, Pill, useApi } from '../components/ui'

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
    try { await api('users', { body: f }); setF({ role: 'VYK' }); reload() } catch (e) { setErr((e as Error).message) }
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
          <label className="f" style={{ flex: 1, marginBottom: 0 }}>Пароль
            <input type="password" value={f.password || ''} onChange={e => setF({ ...f, password: e.target.value })} placeholder="demo" />
          </label>
          <button type="button" className="btn" onClick={create}>Створити</button>
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
