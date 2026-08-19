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

  // Only steal focus on the true->false transition of `disabled`, not on every
  // effect re-run (an unstable `onScan`/`flush` identity from the parent used to
  // re-run this effect on every keystroke, occasionally re-focusing the hidden
  // input mid-typing and swallowing characters meant for a visible PIN field).
  const wasDisabledRef = useRef(disabled)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return

    const onKeyDown = (e) => {
      if (e.key === 'Enter') { flush(); return }

      const now = Date.now()
      if (now - lastKeyRef.current > MAX_CHAR_GAP_MS) {
        bufferRef.current = ''
      }
      lastKeyRef.current = now
      bufferRef.current += e.key
    }

    if (disabled) {
      wasDisabledRef.current = true
      return
    }

    el.addEventListener('keydown', onKeyDown)
    if (wasDisabledRef.current || document.activeElement === document.body) {
      el.focus()
    }
    wasDisabledRef.current = false
    return () => el.removeEventListener('keydown', onKeyDown)
  }, [disabled, flush])

  const onBlur = useCallback((e) => {
    if (disabled) return
    // Don't steal focus from real form inputs — that closes dropdowns
    const tag = e.relatedTarget?.tagName
    if (tag && ['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return
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
