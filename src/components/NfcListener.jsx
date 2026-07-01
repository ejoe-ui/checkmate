import { useEffect, useRef, useCallback } from 'react'

const MAX_CHAR_GAP_MS = 80

export default function NfcListener({ onScan, disabled = false }) {
  const inputRef   = useRef(null)
  const bufferRef  = useRef('')
  const lastKeyRef = useRef(0)

  const flush = useCallback(() => {
    const uid = bufferRef.current.trim()
    bufferRef.current = ''
    if (uid.length >= 4) onScan(uid)
  }, [onScan])

  useEffect(() => {
    const el = inputRef.current
    if (!el || disabled) return

    const onKeyDown = (e) => {
      if (e.key === 'Enter') { flush(); return }

      const now = Date.now()
      if (now - lastKeyRef.current > MAX_CHAR_GAP_MS) {
        bufferRef.current = ''
      }
      lastKeyRef.current = now
      bufferRef.current += e.key
    }

    el.addEventListener('keydown', onKeyDown)
    el.focus()
    return () => el.removeEventListener('keydown', onKeyDown)
  }, [disabled, flush])

  const onBlur = useCallback((e) => {
    if (disabled) return
    // Don't steal focus from real form inputs — that closes dropdowns
    const tag = e.relatedTarget?.tagName
    if (tag && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tag)) return
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [disabled])

  return (
    <input
      ref={inputRef}
      onBlur={onBlur}
      readOnly
      aria-hidden="true"
      style={{
        position: 'fixed',
        opacity: 0,
        width: 1,
        height: 1,
        top: 0,
        left: 0,
        pointerEvents: 'none',
      }}
    />
  )
}
