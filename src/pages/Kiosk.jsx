import { useState, useCallback, useRef, useEffect } from 'react'
import NfcListener from '../components/NfcListener'
import { resolveUid } from '../lib/nfc'
import { supabase } from '../lib/supabase'
import styles from './Kiosk.module.css'

const SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 min

export default function Kiosk() {
  const [mode, setMode]           = useState('locked')    // locked | checkout | return
  const [state, setState]         = useState('locked')
  const [manager, setManager]     = useState(null)
  const [pin, setPin]             = useState('')
  const [student, setStudent]     = useState(null)
  const [cart, setCart]           = useState([])
  const [kitItem, setKitItem]     = useState(null)       // container being checked
  const [kitChecked, setKitChecked] = useState({})       // itemId → bool
  const [message, setMessage]     = useState('')
  const [overrideNeeded, setOverrideNeeded] = useState(false)
  const [overridePin, setOverridePin] = useState('')
  const pinRef         = useRef(null)
  const overridePinRef = useRef(null)
  const sessionTimer   = useRef(null)

  const isPinInput = state === 'manager_pin' || overrideNeeded

  // ── Session timeout ──────────────────────────────────────
  const resetSession = useCallback(() => {
    clearTimeout(sessionTimer.current)
    setMode('locked')
    setState('locked')
    setManager(null)
    setStudent(null)
    setCart([])
    setKitItem(null)
    setKitChecked({})
    setPin('')
    setMessage('')
    setOverrideNeeded(false)
    setOverridePin('')
  }, [])

  const bumpSession = useCallback(() => {
    clearTimeout(sessionTimer.current)
    sessionTimer.current = setTimeout(resetSession, SESSION_TIMEOUT_MS)
  }, [resetSession])

  // ── Keyboard shortcuts ───────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.key === 'Enter' && state === 'scan_assets') confirmCheckout()
      if (e.ctrlKey && e.key === 'r' && (state === 'scan_student' || state === 'scan_assets')) {
        e.preventDefault()
        setMode('return')
        setState('return_scan')
      }
      if (e.key === 'Escape') {
        if (state === 'return_scan') { setMode('checkout'); setState('scan_student') }
        else if (state !== 'locked' && state !== 'manager_pin') resetSession()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, cart])

  // ── NFC scan handler ─────────────────────────────────────
  const handleScan = useCallback(async (uid) => {
    bumpSession()
    const result = await resolveUid(uid)

    // LOCKED — only accept manager fob
    if (state === 'locked') {
      if (result.type === 'manager') {
        setManager(result.data)
        setState('manager_pin')
        setTimeout(() => pinRef.current?.focus(), 50)
      } else {
        setMessage('Tap manager badge first')
        setTimeout(() => setMessage(''), 2000)
      }
      return
    }

    // SCAN STUDENT
    if (state === 'scan_student') {
      if (result.type !== 'student') return
      const s = result.data
      // Check overdue
      const { data: overdue } = await supabase
        .from('cm_open_checkouts')
        .select('id')
        .eq('student_nfc_uid', s.nfc_uid)
      if (s.status === 'Suspended') {
        setState('blocked')
        setMessage(`${s.name} is suspended from equipment checkout.`)
        return
      }
      setStudent({ ...s, overdueCount: overdue?.length ?? 0 })
      setState('scan_assets')
      return
    }

    // SCAN ASSETS — building cart
    if (state === 'scan_assets') {
      if (result.type === 'equipment') {
        const item = result.data
        // Container/kit bag
        if (item.is_container) {
          const { data: contents } = await supabase
            .from('cm_kit_contents')
            .select('item_id, cm_equipment!item_id(id, name, nfc_uid)')
            .eq('container_id', item.id)
          setKitItem({ ...item, contents: contents?.map(c => c.cm_equipment) ?? [] })
          setKitChecked({})
          setState('kit_checklist')
          return
        }
        // Permission check
        if (item.allowed_groups !== 'Any' && student?.class_group &&
            item.allowed_groups !== student.class_group) {
          setOverrideNeeded(true)
          setCart(prev => [...prev, { ...item, blocked: true }])
          setTimeout(() => overridePinRef.current?.focus(), 50)
          return
        }
        setCart(prev => [...prev, item])
      }
      return
    }

    // KIT CHECKLIST — scan items inside bag
    if (state === 'kit_checklist') {
      if (result.type === 'equipment') {
        const match = kitItem.contents.find(c => c.nfc_uid === uid)
        if (match) {
          setKitChecked(prev => ({ ...prev, [match.id]: true }))
          // All checked? Add bag + contents to cart and return to scan_assets
          const allChecked = kitItem.contents.every(
            c => c.id === match.id || kitChecked[c.id]
          )
          if (allChecked) {
            setCart(prev => [...prev, kitItem, ...kitItem.contents])
            setKitItem(null)
            setState('scan_assets')
          }
        }
      }
      return
    }

    // RETURN MODE
    if (state === 'return_scan') {
      if (result.type === 'equipment') {
        const { data: open } = await supabase
          .from('cm_checkouts')
          .select('id, student_id')
          .eq('equipment_id', result.data.id)
          .is('checked_in_at', null)
          .single()
        if (!open) {
          setMessage(`${result.data.name} is not checked out`)
          setTimeout(() => setMessage(''), 3000)
          return
        }
        // Close the checkout
        await supabase.from('cm_checkouts')
          .update({ checked_in_at: new Date().toISOString() })
          .eq('id', open.id)
        await supabase.from('cm_equipment')
          .update({ status: 'available' })
          .eq('id', result.data.id)
        setMessage(`✓ ${result.data.name} returned`)
        setTimeout(() => setMessage(''), 3000)
      }
      return
    }
  }, [state, student, kitItem, kitChecked, bumpSession])

  // ── PIN submit ───────────────────────────────────────────
  const handlePinSubmit = useCallback(async (e) => {
  e.preventDefault()
  if (!pin || pin.length < 4) return
  try {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/checkmate-checkout`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ managerId: manager.id, pin, studentId: null, equipmentIds: [] }),
      }
    )
    const json = await res.json()
    if (json.error) {
      setMessage(json.error)
      setTimeout(() => setMessage(''), 3000)
      return
    }
    setPin('')
    setState('scan_student')
    bumpSession()
  } catch (err) {
    setMessage('Connection error: ' + err.message)
    setTimeout(() => setMessage(''), 4000)
  }
}, [pin, manager, bumpSession])

  // ── Confirm checkout ─────────────────────────────────────
  const confirmCheckout = useCallback(async () => {
    if (!cart.length || !student || overrideNeeded) return
    const equipmentIds = cart.map(i => i.id)
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/checkmate-checkout`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ managerId: manager.id, pin: 'SESSION', studentId: student.id, equipmentIds }),
      }
    )
    const json = await res.json()
    if (json.error) { setMessage('Checkout failed: ' + json.error); return }
    setMessage(`✓ Checked out to ${student.name}`)
    setCart([])
    setStudent(null)
    setState('scan_student')
    setTimeout(() => setMessage(''), 3000)
  }, [cart, student, manager, overrideNeeded])

  return (
    <div className={styles.root}>
      <NfcListener onScan={handleScan} disabled={isPinInput} />

      <header className={styles.header}>
        <span className={styles.logo}>♟ CheckMate</span>
        {manager && <span className={styles.managerBadge}>🔓 {manager.name}</span>}
        {mode === 'return' && <span className={styles.modeBadge}>RETURN MODE</span>}
        <span className={styles.sub}>RHS Media Equipment</span>
      </header>

      <main className={styles.main}>

        {/* LOCKED */}
        {state === 'locked' && (
          <div className={styles.prompt}>
            <div className={styles.icon}>🔒</div>
            <h1>Tap manager badge to begin</h1>
            {message && <p className={styles.flashMsg}>{message}</p>}
          </div>
        )}

        {/* MANAGER PIN */}
        {state === 'manager_pin' && (
          <div className={styles.card}>
            <p className={styles.label}>Manager</p>
            <h1>{manager?.name}</h1>
            <form onSubmit={handlePinSubmit} className={styles.pinForm}>
              <input ref={pinRef} type="password" inputMode="numeric"
                maxLength={6} placeholder="PIN" value={pin}
                onChange={e => setPin(e.target.value)}
                className={styles.pinInput} autoComplete="off" />
              <button type="submit" className={styles.primaryBtn}>Unlock</button>
            </form>
            {message && <p className={styles.errorMsg}>{message}</p>}
          </div>
        )}

        {/* SCAN STUDENT */}
        {state === 'scan_student' && (
          <div className={styles.prompt}>
            <div className={styles.icon}>🪪</div>
            <h1>Scan Student ID Card</h1>
            {message && <p className={styles.flashMsg}>{message}</p>}
            <p className={styles.hint}>Ctrl+R for Return Mode · Esc to lock</p>
          </div>
        )}

        {/* BLOCKED */}
        {state === 'blocked' && (
          <div className={styles.card} data-result="error">
            <div className={styles.icon}>🚫</div>
            <h1>{message}</h1>
            <button className={styles.cancelBtn} onClick={() => setState('scan_student')}>
              Dismiss
            </button>
          </div>
        )}

        {/* SCAN ASSETS */}
        {state === 'scan_assets' && student && (
          <div className={styles.assetView}>
            <div className={styles.studentBar}>
              <span className={styles.label}>Student</span>
              <span className={styles.studentName}>{student.name}</span>
              {student.class_group && <span className={styles.classTag}>{student.class_group}</span>}
              {student.overdueCount > 0 && (
                <span className={styles.overdueTag}>⚠ {student.overdueCount} overdue</span>
              )}
            </div>

            <div className={styles.cart}>
              {cart.length === 0
                ? <p className={styles.cartEmpty}>Scan equipment to add to cart</p>
                : cart.map((item, i) => (
                  <div key={i} className={styles.cartItem} data-blocked={item.blocked}>
                    <span className={styles.cartCategory}>{item.category}</span>
                    <span className={styles.cartName}>{item.name}</span>
                    {item.blocked && <span className={styles.blockedTag}>BLOCKED</span>}
                  </div>
                ))
              }
            </div>

            {overrideNeeded && (
              <div className={styles.overrideBox}>
                <p>⚠ Permission mismatch — instructor PIN required</p>
                <form onSubmit={(e) => {
                  e.preventDefault()
                  if (overridePin === '1234') {
                    setCart(prev => prev.map(i => ({ ...i, blocked: false })))
                    setOverrideNeeded(false)
                    setOverridePin('')
                  }
                }} className={styles.pinForm}>
                  <input ref={overridePinRef} type="password" inputMode="numeric"
                    maxLength={6} placeholder="Instructor PIN"
                    value={overridePin} onChange={e => setOverridePin(e.target.value)}
                    className={styles.pinInput} autoComplete="off" />
                  <button type="submit" className={styles.primaryBtn}>Override</button>
                </form>
              </div>
            )}

            {message && <p className={styles.flashMsg}>{message}</p>}

            <div className={styles.cartActions}>
              <button className={styles.cancelBtn}
                onClick={() => { setStudent(null); setCart([]); setState('scan_student') }}>
                ← New Student
              </button>
              <button className={styles.primaryBtn}
                onClick={confirmCheckout}
                disabled={!cart.length || overrideNeeded}>
                Confirm Checkout — Ctrl+Enter
              </button>
            </div>
          </div>
        )}

        {/* KIT CHECKLIST */}
        {state === 'kit_checklist' && kitItem && (
          <div className={styles.card}>
            <p className={styles.label}>Kit Bag</p>
            <h1>{kitItem.name}</h1>
            <p className={styles.sub}>Scan each item inside to verify contents</p>
            <div className={styles.checklist}>
              {kitItem.contents.map(item => (
                <div key={item.id} className={styles.checklistItem}
                  data-checked={!!kitChecked[item.id]}>
                  <span>{kitChecked[item.id] ? '✅' : '⬜'}</span>
                  <span>{item.name}</span>
                </div>
              ))}
            </div>
            <button className={styles.cancelBtn}
              onClick={() => setState('scan_assets')}>
              Skip Kit Verification
            </button>
          </div>
        )}

        {/* RETURN MODE */}
        {state === 'return_scan' && (
          <div className={styles.prompt}>
            <div className={styles.icon}>📥</div>
            <h1>Scan Equipment to Return</h1>
            {message && <p className={styles.flashMsg}>{message}</p>}
            <p className={styles.hint}>Esc to exit return mode</p>
          </div>
        )}

      </main>

      <footer className={styles.footer}>
        <a href="/dashboard">Dashboard →</a>
      </footer>
    </div>
  )
}
