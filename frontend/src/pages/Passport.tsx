import { api, fmtDate, type Any } from '../api'
import { useAuth } from '../auth'
import { Card, ErrorBox, Loading, useApi } from '../components/ui'

export default function Passport() {
  const { profile } = useAuth()
  const { data, error, reload } = useApi<Any>('program')
  const rules = useApi<Any>('rules')
  if (error) return <ErrorBox msg={error} />
  if (!data) return <Loading />
  const toggle = async () => { await api('program/update', { method: 'PATCH', body: { restricted_info: !data.restricted_info } }); reload() }
  return <>
    <h1>Електронний паспорт програми</h1>
    <Card>
      <h2>{data.name}</h2>
      <dl className="kv">
        <dt>Орган</dt><dd>{data.organ}</dd>
        <dt>Строк дії</dt><dd>{fmtDate(data.period_start)} – {fmtDate(data.period_end)}</dd>
        <dt>Затверджено</dt><dd>{data.approved}</dd>
        <dt>Погодження НАЗК</dt><dd>{data.nazk_status}</dd>
        <dt>Координатор програми</dt><dd>{data.coordinator_unit?.code} {data.coordinator_unit?.name}</dd>
        <dt>Інформація з обмеженим доступом (ІзОД)</dt><dd>
          {data.restricted_info ? (
            <span>
              <span className="pill warn" style={{ marginRight: '.4rem' }}>Режим ІзОД активний</span>
              так — друкована форма / посилений аудит переглядів та вивантажень (SHA-256)
            </span>
          ) : (
            <span>ні — стандартний моніторинг (звіт заповнюється на Порталі НАЗК)</span>
          )}
          {profile?.role === 'KOORD' && <> <button className="btn secondary small" onClick={toggle} style={{ marginLeft: '.5rem' }}>змінити</button></>}</dd>
        <dt>Обсяг</dt><dd>{data.measures} заходів, {data.risks} корупційних ризиків</dd>
      </dl>
      <h3 style={{ marginTop: '1rem' }}>Цілі програми</h3><p>{data.goals}</p>
      <p><small className="muted">{data.note}</small></p>
    </Card>
    <Card title="Структура програми">
      <div className="table-wrap"><table className="t"><tbody>{data.sections.map((s: Any) => <tr key={s.code}><td style={{ width: 60 }}><b>{s.number}</b></td><td>{s.portal_name}</td><td>{s.measures} заходів</td></tr>)}</tbody></table></div>
    </Card>
    {rules.data && <Card title="Явні правила системи (rules.yaml)">
      <p className="muted">Пороги і формулювання можна змінити без програміста. Висновки з наслідками система робить лише за цими правилами (п. 4 Політики використання ШІ).</p>
      <div className="table-wrap"><table className="t"><thead><tr><th>Код</th><th>Сигнал</th><th>Правило</th><th>Важливість</th></tr></thead><tbody>
        {rules.data.flags.map((f: Any) => <tr key={f.code}><td><b>{f.code}</b></td><td>{f.title}</td><td><small>{f.rule}</small></td><td>{f.severity}</td></tr>)}
      </tbody></table></div>
      <h3 style={{ marginTop: '1rem' }}>Ризик невиконання заходу</h3>
      <ul>{Object.entries(rules.data.nonexecution_risk).filter(([k]) => k !== 'params').map(([k, v]: [string, Any]) =>
        <li key={k}>+{v.points} — {v.text.replace('{due_soon_days}', rules.data.nonexecution_risk.params.due_soon_days)}</li>)}</ul>
      <small className="muted">Рівень: 0 — низький, 1–2 — середній, ≥3 — високий.</small>
    </Card>}
  </>
}
