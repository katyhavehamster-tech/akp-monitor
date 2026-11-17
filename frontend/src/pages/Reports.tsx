import { useState } from 'react'
import { download, fmtDate, type Any } from '../api'
import { useAuth } from '../auth'
import { Card, ErrorBox, Loading, Markdown, Pill, PORTAL_TONE, Tabs, useApi } from '../components/ui'

export default function Reports() {
  const [tab, setTab] = useState('portal')
  return <>
    <h1 className="no-print">Звіти</h1>
    <div className="no-print"><Tabs value={tab} onChange={setTab} tabs={[['portal', 'Звіт для Порталу НАЗК (півріччя)'], ['note', 'Аналітична довідка'],
      ['internal', 'Внутрішній звіт'], ['check', 'Самоперевірка на наборі організаторів']]} /></div>
    {tab === 'portal' && <Portal />}
    {tab === 'note' && <Note />}
    {tab === 'internal' && <Internal />}
    {tab === 'check' && <Check />}
  </>
}

function Portal() {
  const [year, setYear] = useState(2026)
  const [half, setHalf] = useState(1)
  const [printForm, setPrintForm] = useState(false)
  const { data, error } = useApi<Any>(`reports/portal?year=${year}&half=${half}`, [year, half])
  if (error) return <ErrorBox msg={error} />
  if (!data) return <Loading />
  const flagged = data.rows.filter((r: Any) => r.sluzhbove_sygnaly_pered_perenesenniam).length
  const counts: Record<string, number> = {}
  data.rows.forEach((r: Any) => { counts[r.stan_vykonannia] = (counts[r.stan_vykonannia] || 0) + 1 })
  return <>
    <Card className="no-print">
      <div className="row">
        <select value={year} onChange={e => setYear(+e.target.value)}><option>2026</option><option>2027</option></select>
        <select value={half} onChange={e => setHalf(+e.target.value)}><option value={1}>І півріччя</option><option value={2}>ІІ півріччя</option></select>
        <span className="spacer" />
        <button className="btn secondary" onClick={() => download(`reports/portal?year=${year}&half=${half}&format=xlsx`, `zvit_portal_${year}_h${half}.xlsx`)}>XLSX (аркуш на розділ)</button>
        <button className="btn secondary" onClick={() => download(`reports/portal?year=${year}&half=${half}&format=csv`, `zvit_portal_${year}_h${half}.csv`)}>CSV</button>
        <button className="btn gold" onClick={() => download(`reports/portal?year=${year}&half=${half}&format=docx`, `zvit_portal_${year}_h${half}.docx`)}>Друкована форма (Word, ДСТУ 4163:2020)</button>
        <button className="btn secondary" onClick={() => { setPrintForm(true); setTimeout(() => window.print(), 150) }}>Друк</button>
        <label className="row" style={{ gap: '.3rem' }}><input type="checkbox" checked={printForm} onChange={e => setPrintForm(e.target.checked)} /> вигляд друкованої форми</label>
      </div>
      <p className="muted" style={{ marginTop: '.6rem' }}>Поля відповідають формі Порталу доброчесності: три розділи; «Фактичний строк виконання», «Стан виконання»,
        «Опис результату виконання заходу або пояснення причин невиконання». Для постійних заходів фактичний строк — кінець півріччя.
        {data.restricted_info ? ' Програма містить інформацію з обмеженим доступом — звіт подається в паперовому вигляді (друкована форма).' : ' Уповноважений переносить дані на Портал без перероблення.'}</p>
      <div className="row">{Object.entries(counts).map(([k, v]) => <Pill key={k} tone={PORTAL_TONE[k]}>{k}: {v}</Pill>)}
        {flagged > 0 && <Pill tone="bad">рядків із сигналами для перегляду перед перенесенням: {flagged}</Pill>}</div>
    </Card>
    {printForm && <div className="card">
      <p style={{ textAlign: 'right' }}>Національне агентство з питань запобігання корупції</p>
      <h2 style={{ textAlign: 'center' }}>ЗВІТ<br />про виконання антикорупційної програми за {half === 1 ? 'І' : 'ІІ'} півріччя {year} року</h2>
      <p style={{ textAlign: 'center' }}>{data.program}<br />{data.organ}</p>
    </div>}
    {data.sections.map((s: string, si: number) => <Card key={s} title={`Розділ ${si + 1}. ${s}`}>
      <div className="table-wrap"><table className="t"><thead><tr>
        <th>№</th><th>Опис заходу</th><th>Найменування структурного підрозділу</th><th>Запланований строк</th>
        <th>Фактичний строк виконання</th><th>Стан виконання</th><th>Опис результату або пояснення причин невиконання</th>
        {!printForm && <th className="no-print">Сигнали (службове)</th>}
      </tr></thead><tbody>
        {data.rows.filter((r: Any) => r.rozdil_portal === s).map((r: Any) => <tr key={r.zakhid_id}
          style={!printForm && r.sluzhbove_sygnaly_pered_perenesenniam ? { background: '#fff8f7' } : {}}>
          <td>{r.nomer}</td><td style={{ minWidth: 260 }}>{r.opys_zakhodu}{!printForm && <><br /><small className="muted">{r.zakhid_id}</small></>}</td>
          <td>{r.naimenuvannia_pidrozdilu}</td><td>{r.zaplanovanyi_strok}</td><td>{fmtDate(r.faktychnyi_strok_vykonannia) === '—' ? '' : fmtDate(r.faktychnyi_strok_vykonannia)}</td>
          <td>{printForm ? r.stan_vykonannia : <Pill tone={PORTAL_TONE[r.stan_vykonannia]}>{r.stan_vykonannia}</Pill>}</td>
          <td style={{ minWidth: 280 }}>{r.opys_rezultatu_abo_prychyn}{r.pidtverdni_materialy && <><br /><small className="muted">Підтвердження: {r.pidtverdni_materialy}</small></>}</td>
          {!printForm && <td className="no-print">{r.sluzhbove_sygnaly_pered_perenesenniam && <Pill tone="bad">{r.sluzhbove_sygnaly_pered_perenesenniam}</Pill>}</td>}
        </tr>)}
      </tbody></table></div>
    </Card>)}
    {printForm && <div className="card"><p>Уповноважена особа з питань запобігання та виявлення корупції ____________________ (підпис)</p>
      <p>Керівник органу ____________________ (підпис) «___» ____________ {year} р.</p></div>}
  </>
}

function Note() {
  const { period } = useAuth()
  const { data, error } = useApi<Any>(period ? `reports/note?period=${period}` : null, [period])
  if (error) return <ErrorBox msg={error} />
  if (!data) return <Loading />
  return <Card actions={<span className="no-print row">
    <button className="btn gold" onClick={() => download(`reports/note?period=${period}&format=docx`, `analitychna_dovidka_${period}.docx`)}>Завантажити Word (ДСТУ 4163:2020)</button>
    <button className="btn secondary" onClick={() => download(`reports/note?period=${period}&format=md`, `analitychna_dovidka_${period}.md`)}>Markdown</button>
    <button className="btn secondary" onClick={() => window.print()}>Друк / PDF</button></span>}>
    <Markdown text={data.markdown} />
  </Card>
}

function Internal() {
  const { period } = useAuth()
  return <Card title={`Внутрішній звіт · ${period}`}>
    <p>Усі заходи зі статусами, актуальними строками, погодженням, сигналами і ризиком невиконання, плюс окремий аркуш сигналів з правилами.
      Формується з тих самих даних, що внесли виконавці, — без повторного введення.</p>
    <div className="row">
      <button className="btn" onClick={() => download(`reports/internal?period=${period}&format=xlsx`, `vnutrishnii_zvit_${period}.xlsx`)}>Завантажити XLSX</button>
      <button className="btn secondary" onClick={() => download(`reports/internal?period=${period}&format=csv`, `vnutrishnii_zvit_${period}.csv`)}>CSV</button>
      <button className="btn secondary" onClick={() => download('audit/export', 'zhurnal_dii.csv')}>Журнал дій (CSV)</button>
      <a className="btn secondary" href="/api/docs/" target="_blank" rel="noreferrer">API для інтеграції</a>
    </div>
  </Card>
}

function Check() {
  const { data, error } = useApi<Any>('selfcheck')
  if (error) return <ErrorBox msg={error} />
  if (!data) return <Loading />
  const f = data.flags, r = data.report
  return <>
    <div className="grid g2">
      <Card title="Сигнали vs ключ організаторів">
        <div className={`alert ${f.ok ? 'success' : 'danger'}`}><b>{f.matched} з {f.expected}</b> навмисних кейсів знайдено; зайвих сигналів: {f.extra.length}, пропущених: {f.missing.length}.</div>
        <small className="muted">Ключ: kliuch/ochikuvani-sygnaly.csv. Порівнюється трійка (код правила, обʼєкт, ідентифікатор).</small>
        {f.missing.length > 0 && <pre>{JSON.stringify(f.missing, null, 1)}</pre>}
        {f.extra.length > 0 && <pre>{JSON.stringify(f.extra, null, 1)}</pre>}
      </Card>
      <Card title="Звіт для Порталу vs еталонний звіт">
        <div className={`alert ${r.ok ? 'success' : 'danger'}`}><b>{r.rows} з {r.etalon_rows}</b> рядків; розбіжностей у полях: {r.n_differences}.</div>
        <small className="muted">Еталон: dani/zvit_portal_2026_h1.csv. Порівнюються всі 11 полів кожного рядка.</small>
        {r.differences.length > 0 && <pre>{JSON.stringify(r.differences.slice(0, 10), null, 1)}</pre>}
      </Card>
    </div>
  </>
}
