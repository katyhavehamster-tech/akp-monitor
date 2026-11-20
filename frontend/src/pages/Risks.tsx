import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtDate, num, type Any } from '../api'
import { useAuth } from '../auth'
import {
  Bar,
  C,
  Card,
  CHART_ITEM_STYLE,
  CHART_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
  ErrorBox,
  Loading,
  Pill,
  progressColor,
  RISK_TONE,
  useApi,
} from '../components/ui'
import { Grid3X3, X } from 'lucide-react'

// Градація зон за Методологією НАЗК № 830/21
function getZone(score: number): {
  level: string
  label: string
  bg: string
  border: string
  text: string
  pillBg: string
} {
  if (score >= 10) {
    return {
      level: 'критичний',
      label: 'Критичний',
      bg: 'rgba(220, 38, 38, 0.16)',
      border: '#dc2626',
      text: '#ef4444',
      pillBg: '#dc2626',
    }
  }
  if (score >= 5) {
    return {
      level: 'високий',
      label: 'Високий',
      bg: 'rgba(234, 88, 12, 0.15)',
      border: '#ea580c',
      text: '#f97316',
      pillBg: '#ea580c',
    }
  }
  if (score >= 3) {
    return {
      level: 'середній',
      label: 'Помірний',
      bg: 'rgba(234, 179, 8, 0.15)',
      border: '#eab308',
      text: '#eab308',
      pillBg: '#ca8a04',
    }
  }
  return {
    level: 'низький',
    label: 'Низький',
    bg: 'rgba(22, 163, 74, 0.15)',
    border: '#16a34a',
    text: '#22c55e',
    pillBg: '#16a34a',
  }
}

const PROB_LABELS: Record<number, string> = {
  5: '5 · Майже напевно',
  4: '4 · Висока',
  3: '3 · Середня',
  2: '2 · Низька',
  1: '1 · Малоймовірна',
}

const IMPACT_LABELS: Record<number, string> = {
  1: '1 · Мізерні',
  2: '2 · Низькі',
  3: '3 · Середні',
  4: '4 · Високі',
  5: '5 · Катастрофічні',
}

export default function Risks() {
  const { period } = useAuth()
  const { data, error } = useApi<Any[]>(period ? `risks?period=${period}` : null, [period])

  const [selectedCell, setSelectedCell] = useState<[number, number] | null>(null)
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null)

  const risks: Any[] = useMemo(() => data || [], [data])

  // Мапа комірок: key = `${p}_${c}` -> масив ризиків
  const cellMap = useMemo(() => {
    const map = new Map<string, Any[]>()
    risks.forEach(r => {
      const p = Number(r.probability) || 1
      const c = Number(r.consequences) || 1
      const key = `${p}_${c}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(r)
    })
    return map
  }, [risks])

  // Статистика за рівнями
  const levelCounts = useMemo(() => {
    const counts = { критичний: 0, високий: 0, середній: 0, низький: 0 }
    risks.forEach(r => {
      const s = Number(r.score) || (Number(r.probability) * Number(r.consequences)) || 1
      const z = getZone(s)
      if (z.level in counts) {
        counts[z.level as keyof typeof counts]++
      }
    })
    return counts
  }, [risks])

  // Відфільтровані ризики
  const filteredRisks = useMemo(() => {
    if (selectedCell) {
      const [p, c] = selectedCell
      return risks.filter(r => (Number(r.probability) || 1) === p && (Number(r.consequences) || 1) === c)
    }
    if (selectedLevel) {
      return risks.filter(r => {
        const s = Number(r.score) || (Number(r.probability) * Number(r.consequences)) || 1
        return getZone(s).level === selectedLevel
      })
    }
    return risks
  }, [risks, selectedCell, selectedLevel])

  if (error) return <ErrorBox msg={error} />
  if (!data) return <Loading />

  const clearFilter = () => {
    setSelectedCell(null)
    setSelectedLevel(null)
  }

  const pValues = [5, 4, 3, 2, 1]
  const cValues = [1, 2, 3, 4, 5]

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.6rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>Корупційні ризики і їх зміна</h1>
          <p className="muted" style={{ margin: '.3rem 0 0' }}>
            Реєстр ризиків за Методологією НАЗК № 830/21: бал = імовірність × наслідки. Для кожного ризику — індикатор стану,
            за яким видно, чи ризик зменшується.
          </p>
        </div>
      </div>

      {/* Інтерактивна Теплова карта ризиків 5x5 */}
      <div style={{ marginTop: '1.25rem' }}>
        <Card
          title={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem' }}>
              <Grid3X3 size={18} style={{ color: 'var(--accent)' }} />
              Теплова карта ризиків 5×5 (Методологія НАЗК № 830/21)
            </span>
          }
        >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.6rem', marginBottom: '1rem' }}>
          <p className="muted" style={{ margin: 0, fontSize: '.84rem' }}>
            Натисніть на комірку або рівень для фільтрації списку ризиків унизу.
          </p>

          {/* Швидкі фільтри рівнів */}
          <div className="row" style={{ gap: '.35rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn small ${!selectedCell && !selectedLevel ? 'primary' : 'secondary'}`}
              onClick={clearFilter}
            >
              Всі рівні ({risks.length})
            </button>
            <button
              type="button"
              className={`btn small ${selectedLevel === 'критичний' ? 'primary' : 'secondary'}`}
              style={selectedLevel === 'критичний' ? { background: '#dc2626', borderColor: '#dc2626' } : {}}
              onClick={() => { setSelectedLevel(selectedLevel === 'критичний' ? null : 'критичний'); setSelectedCell(null) }}
            >
              🔴 Критичний ({levelCounts.критичний})
            </button>
            <button
              type="button"
              className={`btn small ${selectedLevel === 'високий' ? 'primary' : 'secondary'}`}
              style={selectedLevel === 'високий' ? { background: '#ea580c', borderColor: '#ea580c' } : {}}
              onClick={() => { setSelectedLevel(selectedLevel === 'високий' ? null : 'високий'); setSelectedCell(null) }}
            >
              🟠 Високий ({levelCounts.високий})
            </button>
            <button
              type="button"
              className={`btn small ${selectedLevel === 'середній' ? 'primary' : 'secondary'}`}
              style={selectedLevel === 'середній' ? { background: '#ca8a04', borderColor: '#ca8a04' } : {}}
              onClick={() => { setSelectedLevel(selectedLevel === 'середній' ? null : 'середній'); setSelectedCell(null) }}
            >
              🟡 Помірний ({levelCounts.середній})
            </button>
            <button
              type="button"
              className={`btn small ${selectedLevel === 'низький' ? 'primary' : 'secondary'}`}
              style={selectedLevel === 'низький' ? { background: '#16a34a', borderColor: '#16a34a' } : {}}
              onClick={() => { setSelectedLevel(selectedLevel === 'низький' ? null : 'низький'); setSelectedCell(null) }}
            >
              🟢 Низький ({levelCounts.низький})
            </button>
          </div>
        </div>

        {/* 5x5 Матриця */}
        <div style={{ overflowX: 'auto', paddingBottom: '.5rem' }}>
          <div style={{ minWidth: 620, display: 'grid', gridTemplateColumns: '130px repeat(5, 1fr)', gap: '6px' }}>
            {/* Шапка: Вісь Наслідків */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '.78rem', color: 'var(--muted)', background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '.4rem' }}>
              Ймовірність ↓ \ Наслідки →
            </div>
            {cValues.map(c => (
              <div key={c} style={{ textAlign: 'center', padding: '.45rem .2rem', background: 'var(--surface-2)', borderRadius: 'var(--radius)', fontWeight: 600, fontSize: '.76rem', color: 'var(--ink)' }}>
                {IMPACT_LABELS[c]}
              </div>
            ))}

            {/* Рядки ймовірності */}
            {pValues.map(p => (
              <div key={p} style={{ display: 'contents' }}>
                {/* Лейбл рядка (Ймовірність) */}
                <div style={{ display: 'flex', alignItems: 'center', padding: '.4rem .6rem', background: 'var(--surface-2)', borderRadius: 'var(--radius)', fontWeight: 600, fontSize: '.76rem', color: 'var(--ink)' }}>
                  {PROB_LABELS[p]}
                </div>

                {/* 5 Комірок рядка */}
                {cValues.map(c => {
                  const score = p * c
                  const zone = getZone(score)
                  const cellRisks = cellMap.get(`${p}_${c}`) || []
                  const isSelected = selectedCell && selectedCell[0] === p && selectedCell[1] === c
                  const hasRisks = cellRisks.length > 0

                  return (
                    <button
                      key={`${p}_${c}`}
                      type="button"
                      onClick={() => {
                        if (isSelected) {
                          setSelectedCell(null)
                        } else {
                          setSelectedCell([p, c])
                          setSelectedLevel(null)
                        }
                      }}
                      title={`Ймовірність: ${p}, Наслідки: ${c}. Бал: ${score} (${zone.label}). Ризиків: ${cellRisks.length}${hasRisks ? ` [${cellRisks.map(r => r.code).join(', ')}]` : ''}`}
                      style={{
                        background: zone.bg,
                        border: isSelected ? '2px solid var(--ink)' : `1px solid ${zone.border}`,
                        borderRadius: 'var(--radius)',
                        padding: '.6rem .3rem',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        minHeight: 68,
                        position: 'relative',
                        transition: 'transform .15s, box-shadow .15s',
                        boxShadow: isSelected ? '0 0 0 3px var(--accent)' : 'none',
                        outline: 'none',
                      }}
                    >
                      <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', padding: '0 .25rem' }}>
                        <span style={{ fontSize: '.72rem', fontWeight: 800, color: zone.text }}>
                          {score} б.
                        </span>
                        <span style={{ fontSize: '.64rem', color: 'var(--muted)' }}>
                          {p}×{c}
                        </span>
                      </div>

                      {hasRisks ? (
                        <div
                          style={{
                            background: zone.pillBg,
                            color: '#ffffff',
                            fontWeight: 700,
                            fontSize: '.75rem',
                            padding: '.2rem .5rem',
                            borderRadius: '10px',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                            marginTop: '.2rem',
                          }}
                        >
                          {cellRisks.length} {cellRisks.length === 1 ? 'ризик' : 'ризики'}
                        </div>
                      ) : (
                        <div style={{ fontSize: '.7rem', color: 'var(--muted)', opacity: 0.5, marginTop: '.2rem' }}>
                          —
                        </div>
                      )}

                      {hasRisks && (
                        <div style={{ fontSize: '.62rem', color: 'var(--ink)', opacity: 0.85, marginTop: '.15rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                          {cellRisks.map(r => r.code).join(', ')}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Легенда градації зон */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.6rem', marginTop: '1rem', paddingTop: '.85rem', borderTop: '1px solid var(--line)', fontSize: '.78rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: '#16a34a' }} />
              Низький рівень (1–2 б.)
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: '#ca8a04' }} />
              Помірний рівень (3–4 б.)
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: '#ea580c' }} />
              Високий рівень (5–9 б.)
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: '#dc2626' }} />
              Критичний рівень (10–25 б.)
            </span>
          </div>

          {(selectedCell || selectedLevel) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <span className="pill info" style={{ fontSize: '.76rem' }}>
                {selectedCell && `Фільтр: Ймовірність ${selectedCell[0]} × Наслідки ${selectedCell[1]} (${selectedCell[0] * selectedCell[1]} б.)`}
                {selectedLevel && `Фільтр за рівнем: ${selectedLevel.toUpperCase()}`}
                {' · '}Знайдено {filteredRisks.length}
              </span>
              <button
                type="button"
                className="btn ghost small"
                style={{ padding: '.15rem .45rem', fontSize: '.75rem' }}
                onClick={clearFilter}
              >
                <X size={13} style={{ marginRight: '.2rem' }} /> Скинути
              </button>
            </div>
          )}
        </div>
      </Card>
      </div>

      {/* Список ризиків */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '1.25rem 0 .75rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>
          Детальний перелік ризиків {filteredRisks.length !== risks.length ? `(${filteredRisks.length} з ${risks.length})` : `(${risks.length})`}
        </h2>
        {(selectedCell || selectedLevel) && (
          <button type="button" className="btn secondary small" onClick={clearFilter}>
            Показати всі {risks.length} ризиків
          </button>
        )}
      </div>

      {filteredRisks.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <p className="muted" style={{ margin: 0 }}>
              У цій комірці / зоні корупційних ризиків не зафіксовано.
            </p>
            <button type="button" className="btn secondary small" style={{ marginTop: '.75rem' }} onClick={clearFilter}>
              Скинути фільтр
            </button>
          </div>
        </Card>
      ) : (
        <div className="grid g2">
          {filteredRisks.map(r => (
            <Card key={r.code} title={<>{r.code} · {r.name}</>}>
              <div className="row">
                <Pill tone={RISK_TONE[r.level]}>
                  {r.level} ({r.score} б. = {r.probability}×{r.consequences})
                </Pill>
                <small className="muted">{r.process}</small>
                <span className="spacer" />
                <Pill tone={r.verdict === 'зменшується' ? 'ok' : r.verdict === 'повільно зменшується' ? 'warn' : 'bad'}>
                  {r.verdict}
                </Pill>
              </div>

              <p style={{ marginTop: '.5rem' }}>
                {r.indicator} ({r.direction === 'менше' ? 'має зменшуватися' : 'має зростати'})
              </p>

              <div className="row">
                <small>
                  Базове {num(r.baseline)} → зараз <b>{num(r.current)}</b> → ціль {num(r.target)} {r.unit}
                </small>
                <span className="spacer" />
                <small>{r.progress === null ? '—' : `${Math.round(r.progress * 100)}% шляху`}</small>
              </div>

              {r.progress !== null && <Bar value={r.progress * 100} color={progressColor(r.progress)} />}

              <div style={{ height: 140, marginTop: '.5rem' }}>
                <ResponsiveContainer>
                  <LineChart data={r.history.map((h: Any) => ({ ...h, date: fmtDate(h.date) }))}>
                    <CartesianGrid stroke={C.grid} />
                    <XAxis dataKey="date" fontSize={11} stroke={C.muted} />
                    <YAxis fontSize={11} stroke={C.muted} domain={['auto', 'auto']} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} itemStyle={CHART_ITEM_STYLE} labelStyle={CHART_LABEL_STYLE} />
                    <ReferenceLine y={r.target} stroke={C.ok} strokeDasharray="4 4" />
                    <Line dataKey="value" stroke="#3b4fd8" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <small>
                Заходи:{' '}
                {r.measures.length ? (
                  r.measures.map((c: string) => (
                    <Link key={c} to={`/program/measures/${c}`} style={{ marginRight: '.4rem' }}>
                      {c}
                    </Link>
                  ))
                ) : (
                  <b style={{ color: 'var(--bad)' }}>немає жодного заходу</b>
                )}
                {' · '}виконано {r.measures_done}/{r.measures_total} · власник {r.owner_unit}
              </small>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
