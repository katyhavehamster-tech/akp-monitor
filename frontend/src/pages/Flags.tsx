import { useNavigate } from 'react-router-dom'
import { type Any } from '../api'
import { useAuth } from '../auth'
import { Card, ErrorBox, Loading, useApi } from '../components/ui'

export default function FlagsPage() {
  const { period } = useAuth()
  const nav = useNavigate()
  const { data, error } = useApi<Any>(period ? `flags?period=${period}` : null, [period])
  if (error) return <ErrorBox msg={error} />
  if (!data) return <Loading />
  return <>
    <h1>Сигнали Risk Flags · {data.period}</h1>
    <p className="muted">Кожен сигнал має явне правило з <code>rules.yaml</code>, яке видно користувачу. Модель ШІ висновків не робить.</p>
    {data.catalog.map((c: Any) => {
      const items = data.items.filter((f: Any) => f.code === c.code)
      return <Card key={c.code} title={<>{c.code} · {c.title} <small className="muted">({items.length})</small></>}>
        <p><small className="muted">Правило: {c.rule}</small></p>
        {items.length ? <div className="table-wrap"><table className="t"><tbody>{items.map((f: Any, i: number) =>
          <tr key={i} className={f.object === 'zakhid' ? 'click' : ''} onClick={() => f.object === 'zakhid' && nav(`/program/measures/${f.id}`)}>
            <td style={{ width: 110 }}><b>{f.id}</b><br /><small className="muted">{f.object === 'zakhid' ? 'захід' : f.object === 'pidrozdil' ? 'підрозділ' : 'ризик'}</small></td>
            <td>{f.explanation}{f.measure_content && <div className="clamp"><small className="muted">{f.measure_content}</small></div>}</td>
            <td style={{ width: 70 }}><small>{f.unit}</small></td>
          </tr>)}</tbody></table></div> : <p className="muted">Сигналів немає.</p>}
      </Card>
    })}
  </>
}
