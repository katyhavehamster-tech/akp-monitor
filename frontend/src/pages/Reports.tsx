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
  const sys = useApi<Any>('settings')
  if (error) return <ErrorBox msg={error} />
  if (!data) return <Loading />
  const flagged = data.rows.filter((r: Any) => r.sluzhbove_sygnaly_pered_perenesenniam).length
  const counts: Record<string, number> = {}
  data.rows.forEach((r: Any) => { counts[r.stan_vykonannia] = (counts[r.stan_vykonannia] || 0) + 1 })
  const rawSig1 = data.signatory_name || sys.data?.signatory_name
  const rawSig2 = data.head_signatory_name || sys.data?.head_signatory_name
  const sig1 = (rawSig1 && rawSig1 !== 'Власне імʼя ПРІЗВИЩЕ') ? rawSig1 : 'Олександр КОВАЛЕНКО'
  const sig2 = (rawSig2 && rawSig2 !== 'Власне імʼя ПРІЗВИЩЕ') ? rawSig2 : 'Валерій СОКОЛОВ'

  return <>
    <Card className="no-print">
      <div className="report-toolbar">
        <div className="row report-selects">
          <select value={year} onChange={e => setYear(+e.target.value)} aria-label="Рік"><option>2026</option><option>2027</option></select>
          <select value={half} onChange={e => setHalf(+e.target.value)} aria-label="Півріччя"><option value={1}>І півріччя</option><option value={2}>ІІ півріччя</option></select>
          <label className="row check-inline"><input type="checkbox" checked={printForm} onChange={e => setPrintForm(e.target.checked)} /> вигляд друкованої форми</label>
        </div>
        <div className="row report-exports">
          <button type="button" className="btn secondary" onClick={() => download(`reports/portal?year=${year}&half=${half}&format=xlsx`, `zvit_portal_${year}_h${half}.xlsx`)}>XLSX (аркуш на розділ)</button>
          <button type="button" className="btn secondary" onClick={() => download(`reports/portal?year=${year}&half=${half}&format=csv`, `zvit_portal_${year}_h${half}.csv`)}>CSV</button>
          <button type="button" className="btn gold" onClick={() => download(`reports/portal?year=${year}&half=${half}&format=docx`, `zvit_portal_${year}_h${half}.docx`)}>Друкована форма (Word, ДСТУ 4163:2020)</button>
          <button type="button" className="btn secondary" onClick={() => { setPrintForm(true); setTimeout(() => window.print(), 150) }}>Друк</button>
        </div>
      </div>
      <p className="muted" style={{ marginTop: '.6rem' }}>Поля відповідають формі Порталу доброчесності: три розділи; «Фактичний строк виконання», «Стан виконання»,
        «Опис результату виконання заходу або пояснення причин невиконання». Для постійних заходів фактичний строк — кінець півріччя.
        {data.restricted_info ? ' Програма містить інформацію з обмеженим доступом — звіт подається в паперовому вигляді (друкована форма).' : ' Уповноважений переносить дані на Портал без перероблення.'}</p>
      <div className="row">{Object.entries(counts).map(([k, v]) => <Pill key={k} tone={PORTAL_TONE[k]}>{k}: {v}</Pill>)}
        {flagged > 0 && <Pill tone="bad">рядків із сигналами для перегляду перед перенесенням: {flagged}</Pill>}</div>
    </Card>
    <div className={printForm ? 'card' : 'print-only'}>
      <p style={{ textAlign: 'center', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '.25rem' }}>{data.organ}</p>
      <h2 style={{ textAlign: 'center', margin: '.25rem 0' }}>ЗВІТ<br />про виконання антикорупційної програми за {half === 1 ? 'І' : 'ІІ'} півріччя {year} року</h2>
      <p style={{ textAlign: 'center', marginBottom: '1rem' }}>{data.program}</p>
    </div>
    {data.sections.map((s: string, si: number) => <Card key={s} title={`Розділ ${si + 1}. ${s}`}>
      <div className="table-wrap"><table className="t"><thead><tr>
        <th style={{ width: 42 }}>№ з/п</th><th>Опис заходу</th><th>Найменування структурного підрозділу</th><th>Запланований строк</th>
        <th>Фактичний строк виконання</th><th>Стан виконання</th><th>Опис результату або пояснення причин невиконання</th>
        {!printForm && <th className="no-print">Сигнали (службове)</th>}
      </tr></thead><tbody>
        {data.rows.filter((r: Any) => r.rozdil_portal === s).map((r: Any) => <tr key={r.zakhid_id}
          style={!printForm && r.sluzhbove_sygnaly_pered_perenesenniam ? { background: 'var(--bad-bg)' } : {}}>
          <td>{r.nomer}</td><td style={{ minWidth: 220 }}>{r.opys_zakhodu}{!printForm && <><br /><small className="muted no-print">{r.zakhid_id}</small></>}</td>
          <td>{r.naimenuvannia_pidrozdilu}</td><td>{r.zaplanovanyi_strok}</td><td>{fmtDate(r.faktychnyi_strok_vykonannia) === '—' ? '' : fmtDate(r.faktychnyi_strok_vykonannia)}</td>
          <td>{printForm ? r.stan_vykonannia : <Pill tone={PORTAL_TONE[r.stan_vykonannia]}>{r.stan_vykonannia}</Pill>}</td>
          <td style={{ minWidth: 240 }}>{r.opys_rezultatu_abo_prychyn}{r.pidtverdni_materialy && <><br /><small className="muted">Підтвердження: {r.pidtverdni_materialy}</small></>}</td>
          {!printForm && <td className="no-print">{r.sluzhbove_sygnaly_pered_perenesenniam && <Pill tone="bad">{r.sluzhbove_sygnaly_pered_perenesenniam}</Pill>}</td>}
        </tr>)}
      </tbody></table></div>
    </Card>)}
    <div className={printForm ? 'card' : 'print-only'}>
      <div className="print-sig-grid">
        <div>Уповноважена особа з питань запобігання та виявлення корупції</div>
        <div><b>{sig1}</b></div>
      </div>
      <div className="print-sig-grid">
        <div>Керівник органу</div>
        <div><b>{sig2}</b></div>
      </div>
    </div>
    {data.snapshot && (
      <div className={printForm ? 'card' : 'print-only'} style={{ marginTop: '.85rem' }}>
        <div className="report-verify-box">
          <div className="report-verify-qr">
            <img src={data.snapshot.qr_code} alt="QR-код верифікації звіту" width={112} height={112} />
            <small className="muted">Відскануйте для перевірки</small>
          </div>
          <div className="report-verify-details">
            <div className="report-verify-header">
              <span className="report-verify-badge">ДСТУ 4163:2020 · ЕЛЕКТРОННА ВЕРИФІКАЦІЯ</span>
              <h4>Криптографічний захист цілісності звіту</h4>
            </div>
            <p className="muted" style={{ margin: '.2rem 0 .5rem', fontSize: '.84rem' }}>
              Документ зафіксовано в системі «АКП-Монітор» та підписано цифровим ключем сервера (HMAC-SHA256).
            </p>
            <div className="report-verify-grid">
              <div><span className="muted">ID зліпка:</span> <code>{data.snapshot.id}</code></div>
              <div><span className="muted">SHA-256 хеш даних:</span> <code className="break-all">{data.snapshot.report_hash}</code></div>
              <div><span className="muted">Підпис HMAC-SHA256:</span> <code className="break-all">{data.snapshot.signature}</code></div>
              <div><span className="muted">Дата фіксації:</span> {fmtDate(data.snapshot.created_at)}</div>
              <div>
                <span className="muted">Онлайн-верифікація:</span>{' '}
                <a href={data.snapshot.verify_url} target="_blank" rel="noopener noreferrer">
                  {window.location.origin + data.snapshot.verify_url}
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    )}
  </>
}

function Note() {
  const { period } = useAuth()
  const { data, error } = useApi<Any>(period ? `reports/note?period=${period}` : null, [period])
  const sys = useApi<Any>('settings')
  if (error) return <ErrorBox msg={error} />
  if (!data) return <Loading />
  const rawSig1 = data.signatory_name || sys.data?.signatory_name
  const sig1 = (rawSig1 && rawSig1 !== 'Власне імʼя ПРІЗВИЩЕ') ? rawSig1 : 'Олександр КОВАЛЕНКО'
  return <Card actions={<span className="no-print row">
    <button className="btn gold" onClick={() => download(`reports/note?period=${period}&format=docx`, `analitychna_dovidka_${period}.docx`)}>Завантажити Word (ДСТУ 4163:2020)</button>
    <button className="btn secondary" onClick={() => download(`reports/note?period=${period}&format=md`, `analitychna_dovidka_${period}.md`)}>Markdown</button>
    <button className="btn secondary" onClick={() => window.print()}>Друк / PDF</button></span>}>
    <Markdown text={data.markdown} />
    <div className="print-only">
      <div className="print-sig-grid">
        <div>Головний спеціаліст сектору з питань запобігання та виявлення корупції</div>
        <div><b>{sig1}</b></div>
      </div>
    </div>
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
        {f.missing.length > 0 && <pre className="code-pre">{JSON.stringify(f.missing, null, 1)}</pre>}
        {f.extra.length > 0 && <pre className="code-pre">{JSON.stringify(f.extra, null, 1)}</pre>}
      </Card>
      <Card title="Звіт для Порталу vs еталонний звіт">
        <div className={`alert ${r.ok ? 'success' : 'danger'}`}><b>{r.rows} з {r.etalon_rows}</b> рядків; розбіжностей у полях: {r.n_differences}.</div>
        <small className="muted">Еталон: dani/zvit_portal_2026_h1.csv. Порівнюються всі 11 полів кожного рядка.</small>
        {r.differences.length > 0 && <pre className="code-pre">{JSON.stringify(r.differences.slice(0, 10), null, 1)}</pre>}
      </Card>
    </div>
  </>
}
