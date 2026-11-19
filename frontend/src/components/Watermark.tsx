import { useEffect, useState } from 'react'
import { useAuth } from '../auth'

export function Watermark() {
  const { profile } = useAuth()
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

  if (!profile) return null

  const text = `ІзОД / ДСК · ${profile.code} · ${profile.role} · ${time}`

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
