import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../auth'

export function Watermark() {
  const { profile } = useAuth()
  const loc = useLocation()
  const [time, setTime] = useState('')

  useEffect(() => {
    const update = () => {
      const d = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      setTime(`${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`)
    }
    update()
    const timer = setInterval(update, 60000)
    return () => clearInterval(timer)
  }, [])

  // 1. Водяний знак відображається виключно для ролі «Аналітик» (ANAL)
  if (!profile || profile.role !== 'ANAL') return null

  // 2. Лише на сторінках перегляду аналітичних документів, опитувань та звітів
  const isDocumentOrReport =
    loc.pathname.startsWith('/surveys') ||
    loc.pathname.startsWith('/program/reports')

  if (!isDocumentOrReport) return null

  const text = `ІзОД / ДСК · ${profile.code} · ANAL · ${time}`

  return (
    <div className="watermark-overlay" aria-hidden="true">
      <div className="watermark-grid">
        {Array.from({ length: 30 }).map((_, i) => (
          <div key={i} className="watermark-item">
            {text}
          </div>
        ))}
      </div>
    </div>
  )
}
