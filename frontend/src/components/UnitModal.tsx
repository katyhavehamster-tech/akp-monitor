import { useEffect, useState } from 'react'
import { X, Building2 } from 'lucide-react'
import { api, type Any } from '../api'

interface UnitModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: (unit: { code: string; name: string; type?: string; note?: string }) => void
  initialUnit?: { code: string; name: string; type?: string; note?: string } | null
}

export function UnitModal({ isOpen, onClose, onSaved, initialUnit }: UnitModalProps) {
  const isEdit = !!initialUnit
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (initialUnit) {
      setCode(initialUnit.code || '')
      setName(initialUnit.name || '')
      setType(initialUnit.type || '')
      setNote(initialUnit.note || '')
    } else {
      setCode('')
      setName('')
      setType('')
      setNote('')
    }
    setErr('')
  }, [initialUnit, isOpen])

  if (!isOpen) return null

  const submit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setErr('')
    const cleanCode = code.trim().toUpperCase()
    const cleanName = name.trim()
    if (!cleanCode) {
      setErr('Вкажіть код підрозділу (наприклад, P15 або ВЗГ).')
      return
    }
    if (cleanCode.length > 10) {
      setErr('Код підрозділу не може бути довшим за 10 символів.')
      return
    }
    if (!cleanName) {
      setErr('Вкажіть назву підрозділу.')
      return
    }

    setBusy(true)
    try {
      if (isEdit) {
        const updated = await api<{ code: string; name: string; type?: string; note?: string }>(
          `units/${encodeURIComponent(cleanCode)}`,
          {
            method: 'PATCH',
            body: { name: cleanName, type: type.trim(), note: note.trim() },
          }
        )
        onSaved(updated)
      } else {
        const created = await api<{ code: string; name: string; type?: string; note?: string }>(
          'units',
          {
            method: 'POST',
            body: { code: cleanCode, name: cleanName, type: type.trim(), note: note.trim() },
          }
        )
        onSaved(created)
      }
      onClose()
    } catch (x: Any) {
      setErr((x as Error).message || 'Помилка збереження підрозділу.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '0.75rem',
      }}
      onClick={onClose}
    >
      <div
        className="modal-card"
        style={{
          background: 'var(--card-bg, #1a1f2c)',
          color: 'var(--ink, #fff)',
          borderRadius: '12px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
          width: '100%',
          maxWidth: '520px',
          maxHeight: '90vh',
          overflowY: 'auto',
          border: '1px solid var(--border, #333)',
          padding: '1.25rem',
          boxSizing: 'border-box',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <Building2 size={20} className="muted" />
            <h3 style={{ margin: 0, fontSize: '1.15rem' }}>
              {isEdit ? 'Редагувати підрозділ' : 'Новий підрозділ-виконавець'}
            </h3>
          </div>
          <button
            type="button"
            className="btn ghost mini"
            onClick={onClose}
            aria-label="Закрити"
            style={{ padding: '4px', borderRadius: '4px' }}
          >
            <X size={18} />
          </button>
        </div>

        <p className="muted" style={{ fontSize: '.84rem', margin: '0 0 1rem 0', lineHeight: 1.45 }}>
          {isEdit
            ? 'Зміни найменування та типу підрозділу автоматично фіксуються в журналі дій AuditLog (SHA-256).'
            : 'Підрозділ одразу стане доступним для призначення відповідальним виконавцем або співвиконавцем заходу.'}
        </p>

        {err && (
          <div className="alert danger" style={{ marginBottom: '1rem', fontSize: '.85rem' }}>
            {err}
          </div>
        )}

        <form onSubmit={submit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <label className="f" style={{ margin: 0 }}>
              <span>Код підрозділу <b style={{ color: 'var(--primary)' }}>*</b></span>
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value)}
                disabled={isEdit}
                placeholder="P15 або ВЗГ"
                maxLength={10}
                required
                style={{
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  opacity: isEdit ? 0.7 : 1,
                  cursor: isEdit ? 'not-allowed' : 'text',
                }}
              />
              <small className="muted" style={{ fontSize: '.75rem' }}>
                Короткий ідентифікатор (до 10 символів). Після створення код не змінюється.
              </small>
            </label>

            <label className="f" style={{ margin: 0 }}>
              <span>Повна назва підрозділу <b style={{ color: 'var(--primary)' }}>*</b></span>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Відділ взаємодії з громадськістю та ЗМІ"
                maxLength={300}
                required
              />
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
              <label className="f" style={{ margin: 0 }}>
                <span>Тип / категорія</span>
                <input
                  type="text"
                  value={type}
                  onChange={e => setType(e.target.value)}
                  placeholder="Факультет / Відділ"
                  maxLength={50}
                />
              </label>

              <label className="f" style={{ margin: 0 }}>
                <span>Примітка</span>
                <input
                  type="text"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Додаткова інформація"
                  maxLength={300}
                />
              </label>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '.6rem',
              justifyContent: 'flex-end',
              marginTop: '1.25rem',
            }}
          >
            <button
              type="button"
              className="btn secondary small"
              onClick={onClose}
              disabled={busy}
              style={{ minWidth: '80px' }}
            >
              Скасувати
            </button>
            <button
              type="submit"
              className="btn primary small"
              disabled={busy}
              style={{ minWidth: '120px' }}
            >
              {busy ? 'Збереження…' : isEdit ? 'Зберегти зміни' : 'Створити підрозділ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
