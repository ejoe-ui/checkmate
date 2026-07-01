/*
  CheckMate — Kiosk.jsx  (Workstation Edition)
  ─────────────────────────────────────────────────────────────────────────────
  Split-panel workstation layout.
  Left 1/3  — checkout state machine (NFC flow, cart, duration, reason)
  Right 2/3 — live log with realtime subscription, search, late filter

  STATE MACHINE (left panel):
    locked        → tap manager badge → manager_pin
    manager_pin   → enter PIN → scan_student
    scan_student  → tap student NFC → scan_assets
    scan_assets   → tap equipment → cart builds → confirm checkout
    kit_checklist → scan items inside a kit bag
    return_scan   → Return button or Ctrl+R; tap equipment to return
    blocked       → student is suspended

  HEADER BUTTONS:
    Return equipment  — enters return mode
    Lock              — clears session immediately

  KEYBOARD SHORTCUTS:
    Ctrl+Enter  confirm checkout (from scan_assets)
    Ctrl+R      enter return mode
    Esc         back / lock

  EDGE FUNCTION:
    POST /functions/v1/checkmate-checkout
    Mode 1 — PIN verify:  { managerId, pin }
    Mode 2 — Checkout:    { managerId, pin:"SESSION", studentId, equipmentIds[], dueAt, reason, teacherName, className }
    Mode 3 — Return:      { managerId, pin:"SESSION", action:"return", equipmentId }
*/

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import NfcListener from '../components/NfcListener'
import { resolveUid } from '../lib/nfc'
import { supabase } from '../lib/supabase'
import styles from './Kiosk.module.css'

const SESSION_TIMEOUT_MS = 30 * 60 * 1000

const DURATIONS = [
  { key: 'end_of_day', label: 'End of day' },
  { key: 'tomorrow',   label: 'Tomorrow'   },
  { key: '3_days',     label: '3 days'     },
  { key: '5_days',     label: '5 days'     },
  { key: '1_week',     label: '1 week'     },
  { key: 'custom',     label: 'Custom'     },
]

const REASONS = [
  'Class project', 'News broadcast', 'Sports coverage',
  'Event coverage', 'Teacher loan', 'Other',
]

function computeDueDate(dur, custom) {
  const eod = (d) => { const r = new Date(d); r.setHours(15, 30, 0, 0); return r }
  const offset = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return eod(d) }
  switch (dur) {
    case 'end_of_day': return eod(new Date())
    case 'tomorrow':   return offset(1)
    case '3_days':     return offset(3)
    case '5_days':     return offset(5)
    case '1_week':     return offset(7)
    case 'custom':     return custom ? new Date(custom) : offset(7)
    default:           return offset(1)
  }
}

function formatDue(iso) {
  if (!iso) return '—'
  const diff = new Date(iso) - new Date()
  if (diff < 0) {
    const d = Math.floor(-diff / 86400000)
    const h = Math.floor(-diff / 3600000) % 24
    return d > 0 ? `${d}d overdue` : `${h}h overdue`
  }
  const d = Math.floor(diff / 86400000)
  const h = Math.floor(diff / 3600000) % 24
  if (d === 0) return h <= 0 ? 'Due now' : `${h}h left`
  return `${d}d ${h}h left`
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default function Kiosk() {
  // ── Checkout state ────────────────────────────────────────────────────────
  const [mode, setMode]                     = useState('locked')
  const [state, setState]                   = useState('locked')
  const [manager, setManager]               = useState(null)
  const [pin, setPin]                       = useState('')
  const [student, setStudent]               = useState(null)
  const [cart, setCart]                     = useState([])
  const [kitItem, setKitItem]               = useState(null)
  const [kitChecked, setKitChecked]         = useState({})
  const [message, setMessage]               = useState('')
  const [overrideNeeded, setOverrideNeeded] = useState(false)
  const [overridePin, setOverridePin]       = useState('')
  const [returnPending, setReturnPending]   = useState(null)

  // ── Checkout details ──────────────────────────────────────────────────────
  const [duration, setDuration]       = useState('tomorrow')
  const [customDue, setCustomDue]     = useState('')
  const [reason, setReason]           = useState('')
  const [teacherName, setTeacherName] = useState('')
  const [className, setClassName]     = useState('')
  const [teachers, setTeachers]       = useState([])

  // ── Right panel ───────────────────────────────────────────────────────────
  const [liveLog, setLiveLog]           = useState([])
  const [history, setHistory]           = useState([])
  const [rightTab, setRightTab]         = useState('open')
  const [searchQuery, setSearchQuery]   = useState('')
  const [filterLate, setFilterLate]     = useState(false)
  const [selectedRow, setSelectedRow]   = useState(null)

  // ── Clock ─────────────────────────────────────────────────────────────────
  const [clock, setClock] = useState('')

  const pinRef         = useRef(null)
  const overridePinRef = useRef(null)
  const sessionTimer   = useRef(null)

  const isPinInput = state === 'manager_pin' || overrideNeeded || !!returnPending

  // ── Clock ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => setClock(
      new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
    )
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  // ── Load teachers from PassAble ───────────────────────────────────────────
  useEffect(() => {
    supabase.from('teachers').select('id, name').order('name').then(({ data }) => {
      if (data) setTeachers(data)
    })
  }, [])

  // ── Live log + history ────────────────────────────────────────────────────
  const loadLiveData = useCallback(async () => {
    const [{ data: open }, { data: hist }] = await Promise.all([
      supabase
        .from('cm_open_checkouts')
        .select('*')
        .order('checked_out_at', { ascending: false }),
      supabase
        .from('cm_checkouts')
        .select(`
          id, checked_out_at, checked_in_at, due_at, reason, teacher_name, class_name,
          cm_students!student_id(name, email, phone, class_group),
          cm_equipment!equipment_id(name, category),
          cm_managers!manager_id(name)
        `)
        .not('checked_in_at', 'is', null)
        .order('checked_in_at', { ascending: false })
        .limit(100),
    ])
    if (open) setLiveLog(open)
    if (hist) setHistory(hist)
  }, [])

  // ── Realtime subscription ─────────────────────────────────────────────────
  useEffect(() => {
    loadLiveData()
    const channel = supabase.channel('checkmate_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cm_checkouts' }, loadLiveData)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [loadLiveData])

  // ── Derived counts + filtered rows ────────────────────────────────────────
  const lateCount = useMemo(() => {
    const now = new Date()
    return liveLog.filter(r => r.due_at && new Date(r.due_at) < now).length
  }, [liveLog])

  const filteredRows = useMemo(() => {
    let rows = rightTab === 'open'
      ? liveLog
      : history.map(r => ({
          ...r,
          student_name:       r.cm_students?.name,
          student_email:      r.cm_students?.email,
          student_phone:      r.cm_students?.phone,
          class_group:        r.cm_students?.class_group,
          equipment_name:     r.cm_equipment?.name,
          equipment_category: r.cm_equipment?.category,
          manager_name:       r.cm_managers?.name,
        }))
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      rows = rows.filter(r =>
        r.student_name?.toLowerCase().includes(q) ||
        r.equipment_name?.toLowerCase().includes(q) ||
        r.student_email?.toLowerCase().includes(q)
      )
    }
    if (filterLate && rightTab === 'open') {
      const now = new Date()
      rows = rows.filter(r => r.due_at && new Date(r.due_at) < now)
    }
    return rows
  }, [liveLog, history, rightTab, searchQuery, filterLate])

  // ── Session timeout ───────────────────────────────────────────────────────
  const resetSession = useCallback(() => {
    clearTimeout(sessionTimer.current)
    setMode('locked'); setState('locked'); setManager(null); setStudent(null)
    setCart([]); setKitItem(null); setKitChecked({}); setPin(''); setMessage('')
    setOverrideNeeded(false); setOverridePin(''); setReturnPending(null)
    setDuration('tomorrow'); setCustomDue(''); setReason(''); setTeacherName(''); setClassName('')
  }, [])

  const bumpSession = useCallback(() => {
    clearTimeout(sessionTimer.current)
    sessionTimer.current = setTimeout(resetSession, SESSION_TIMEOUT_MS)
  }, [resetSession])

  // ── Focus PIN input ───────────────────────────────────────────────────────
  useEffect(() => {
    if (state === 'manager_pin') pinRef.current?.focus()
  }, [state])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.key === 'Enter' && state === 'scan_assets') confirmCheckout()
      if (e.ctrlKey && e.key === 'r' && (state === 'scan_student' || state === 'scan_assets')) {
        e.preventDefault()
        setMode('return'); setState('return_scan')
      }
      if (e.key === 'Escape') {
        if (state === 'return_scan') { setReturnPending(null); setMode('checkout'); setState('scan_student') }
        else if (state !== 'locked' && state !== 'manager_pin') resetSession()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, cart])

  // ── NFC scan handler ──────────────────────────────────────────────────────
  const handleScan = useCallback(async (uid) => {
    bumpSession()
    const result = await resolveUid(uid)

    if (state === 'locked') {
      if (result.type === 'manager') {
        setManager(result.data); setState('manager_pin')
      } else {
        setMessage('Tap manager badge first')
        setTimeout(() => setMessage(''), 2000)
      }
      return
    }

    if (state === 'scan_student') {
      if (result.type !== 'student') return
      const s = result.data
      const { data: overdue } = await supabase
        .from('cm_open_checkouts').select('id').eq('student_nfc_uid', s.nfc_uid)
      if (s.status === 'Suspended') {
        setState('blocked'); setMessage(`${s.name} is suspended from equipment checkout.`); return
      }
      setStudent({ ...s, overdueCount: overdue?.length ?? 0 })
      setState('scan_assets')
      return
    }

    if (state === 'scan_assets') {
      if (result.type === 'equipment') {
        const item = result.data
        if (item.is_container) {
          const { data: contents } = await supabase
            .from('cm_kit_contents')
            .select('item_id, cm_equipment!item_id(id, name, nfc_uid)')
            .eq('container_id', item.id)
          setKitItem({ ...item, contents: contents?.map(c => c.cm_equipment) ?? [] })
          setKitChecked({}); setState('kit_checklist'); return
        }
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

    if (state === 'kit_checklist') {
      if (result.type === 'equipment') {
        const match = kitItem.contents.find(c => c.nfc_uid === uid)
        if (match) {
          setKitChecked(prev => ({ ...prev, [match.id]: true }))
          const allChecked = kitItem.contents.every(c => c.id === match.id || kitChecked[c.id])
          if (allChecked) {
            setCart(prev => [...prev, kitItem, ...kitItem.contents])
            setKitItem(null); setState('scan_assets')
          }
        }
      }
      return
    }

    if (state === 'return_scan') {
      if (result.type === 'equipment') {
        setReturnPending(result.data)
      } else {
        setMessage('Scan equipment, not a student or manager badge')
        setTimeout(() => setMessage(''), 2000)
      }
      return
    }
  }, [state, student, kitItem, kitChecked, bumpSession])

  // ── PIN submit ────────────────────────────────────────────────────────────
  const handlePinSubmit = useCallback(async (e) => {
    e.preventDefault()
    if (!pin || pin.length < 4) return
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/checkmate-checkout`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ managerId: manager.id, pin, studentId: null, equipmentIds: [] }),
        }
      )
      const json = await res.json()
      if (json.error) {
        setMessage(json.error); setTimeout(() => setMessage(''), 3000); return
      }
      setPin(''); setMode('checkout'); setState('scan_student'); bumpSession()
    } catch (err) {
      setMessage('Connection error: ' + err.message); setTimeout(() => setMessage(''), 4000)
    }
  }, [pin, manager, bumpSession])

  // ── Confirm checkout ──────────────────────────────────────────────────────
  const confirmCheckout = useCallback(async () => {
    if (!cart.length || !student || overrideNeeded) return
    const equipmentIds = cart.map(i => i.id)
    const dueAt = computeDueDate(duration, customDue).toISOString()
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/checkmate-checkout`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
          body: JSON.stringify({
            managerId: manager.id, pin: 'SESSION',
            studentId: student.id, equipmentIds, dueAt,
            reason: reason || null,
            teacherName: teacherName || null,
            className: className || null,
          }),
        }
      )
      const json = await res.json()
      if (json.error) { setMessage('Checkout failed: ' + json.error); return }
      setMessage(`✓ Checked out to ${student.name}`)
      setCart([]); setStudent(null); setReason(''); setTeacherName(''); setClassName('')
      setDuration('tomorrow'); setState('scan_student')
      setTimeout(() => setMessage(''), 3000)
    } catch (err) {
      setMessage('Error: ' + err.message); setTimeout(() => setMessage(''), 4000)
    }
  }, [cart, student, manager, overrideNeeded, duration, customDue, reason, teacherName, className])

  // ── Confirm return ────────────────────────────────────────────────────────
  const confirmReturn = useCallback(async () => {
    if (!returnPending) return
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/checkmate-checkout`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ action: 'return', managerId: manager.id, pin: 'SESSION', equipmentId: returnPending.id }),
        }
      )
      const json = await res.json()
      setMessage(json.error ? json.error : `✓ ${returnPending.name} returned`)
    } catch (err) {
      setMessage('Connection error: ' + err.message)
    }
    setReturnPending(null); setTimeout(() => setMessage(''), 3000)
  }, [returnPending, manager])

  // ── Remove from cart ──────────────────────────────────────────────────────
  const removeFromCart = useCallback((index) => {
    setCart(prev => {
      const next = prev.filter((_, i) => i !== index)
      if (!next.some(i => i.blocked)) setOverrideNeeded(false)
      return next
    })
  }, [])

  // ── Due date display string ───────────────────────────────────────────────
  const dueDateDisplay = useMemo(() => {
    const d = computeDueDate(duration, customDue)
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
           ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }, [duration, customDue])

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className={styles.root}>
      <NfcListener onScan={handleScan} disabled={isPinInput} />

      {/* ── HEADER ── */}
      <header className={styles.header}>
        <span className={styles.logo}>♟ CheckMate</span>
        {manager && <span className={styles.managerBadge}>🔓 {manager.name}</span>}
        {mode === 'return' && <span className={styles.modeBadge}>RETURN MODE</span>}
        <span className={styles.headerSpacer} />
        {state !== 'locked' && state !== 'manager_pin' && (
          <>
            <button className={styles.returnBtn}
              onClick={() => { setMode('return'); setState('return_scan') }}>
              ↩ Return equipment
            </button>
            <button className={styles.lockBtn} onClick={resetSession}>
              🔒 Lock
            </button>
          </>
        )}
        <span className={styles.clock}>{clock}</span>
      </header>

      {/* ══════════════════════════════════════════════════════════════════
          LEFT PANEL — checkout flow
      ══════════════════════════════════════════════════════════════════ */}
      <div className={styles.left}>

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
              <input ref={pinRef} type="password" inputMode="numeric" maxLength={6}
                placeholder="PIN" value={pin} onChange={e => setPin(e.target.value)}
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
            <h1>Scan student ID card</h1>
            {message && <p className={styles.flashMsg}>{message}</p>}
            <p className={styles.hint}>Ctrl+R to return · Esc to lock</p>
          </div>
        )}

        {/* BLOCKED */}
        {state === 'blocked' && (
          <div className={styles.card} data-result="error">
            <div className={styles.icon}>🚫</div>
            <h1>{message}</h1>
            <button className={styles.cancelBtn} onClick={() => setState('scan_student')}>Dismiss</button>
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
                  <div key={i} className={styles.cartItem} data-blocked={item.blocked || undefined}>
                    <span className={styles.cartCategory}>{item.category}</span>
                    <span className={styles.cartName}>{item.name}</span>
                    {item.blocked && <span className={styles.blockedTag}>BLOCKED</span>}
                    <button className={styles.removeBtn} onClick={() => removeFromCart(i)} aria-label="Remove">✕</button>
                  </div>
                ))
              }
            </div>

            {/* Duration + context — only when cart has items */}
            {cart.length > 0 && (
              <>
                <div className={styles.durationWrap}>
                  <span className={styles.fieldLabel}>Return by</span>
                  <div className={styles.durationPills}>
                    {DURATIONS.map(d => (
                      <button key={d.key}
                        className={`${styles.durationPill} ${duration === d.key ? styles.pillActive : ''}`}
                        onClick={() => setDuration(d.key)}>
                        {d.label}
                      </button>
                    ))}
                  </div>
                  {duration === 'custom' && (
                    <input type="datetime-local" className={styles.customDateInput}
                      value={customDue} onChange={e => setCustomDue(e.target.value)} />
                  )}
                  <span className={styles.dueDisplay}>Due: {dueDateDisplay}</span>
                </div>

                <div className={styles.contextWrap}>
                  <div className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>Reason</span>
                    <select className={styles.selectField} value={reason} onChange={e => setReason(e.target.value)}>
                      <option value="">— optional —</option>
                      {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>Teacher</span>
                    <select className={styles.selectField} value={teacherName} onChange={e => setTeacherName(e.target.value)}>
                      <option value="">— optional —</option>
                      {teachers.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                    </select>
                  </div>
                  <div className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>Class</span>
                    <input className={styles.textField} placeholder="e.g. Period 3"
                      value={className} onChange={e => setClassName(e.target.value)} />
                  </div>
                </div>
              </>
            )}

            {overrideNeeded && (
              <div className={styles.overrideBox}>
                <p>⚠ Permission mismatch — instructor PIN required</p>
                <form onSubmit={(e) => {
                  e.preventDefault()
                  if (overridePin === '1234') {
                    setCart(prev => prev.map(i => ({ ...i, blocked: false })))
                    setOverrideNeeded(false); setOverridePin('')
                  }
                }} className={styles.pinForm}>
                  <input ref={overridePinRef} type="password" inputMode="numeric" maxLength={6}
                    placeholder="Instructor PIN" value={overridePin}
                    onChange={e => setOverridePin(e.target.value)}
                    className={styles.pinInput} autoComplete="off" />
                  <button type="submit" className={styles.primaryBtn}>Override</button>
                </form>
              </div>
            )}

            {message && <p className={styles.flashMsg}>{message}</p>}

            <div className={styles.cartActions}>
              <button className={styles.cancelBtn}
                onClick={() => { setStudent(null); setCart([]); setState('scan_student') }}>
                ← New student
              </button>
              <button className={styles.primaryBtn}
                onClick={confirmCheckout}
                disabled={!cart.length || overrideNeeded}>
                Confirm checkout
              </button>
            </div>
          </div>
        )}

        {/* KIT CHECKLIST */}
        {state === 'kit_checklist' && kitItem && (
          <div className={styles.card}>
            <p className={styles.label}>Kit bag</p>
            <h1>{kitItem.name}</h1>
            <p className={styles.sub}>Scan each item to verify contents</p>
            <div className={styles.checklist}>
              {kitItem.contents.map(item => (
                <div key={item.id} className={styles.checklistItem} data-checked={!!kitChecked[item.id]}>
                  <span>{kitChecked[item.id] ? '✅' : '⬜'}</span>
                  <span>{item.name}</span>
                </div>
              ))}
            </div>
            <button className={styles.cancelBtn} onClick={() => setState('scan_assets')}>
              Skip verification
            </button>
          </div>
        )}

        {/* RETURN — scan prompt */}
        {state === 'return_scan' && !returnPending && (
          <div className={styles.prompt}>
            <div className={styles.icon}>📥</div>
            <h1>Scan equipment to return</h1>
            {message && <p className={styles.flashMsg}>{message}</p>}
            <p className={styles.hint}>Esc to exit return mode</p>
          </div>
        )}

        {/* RETURN — confirm card */}
        {state === 'return_scan' && returnPending && (
          <div className={styles.card}>
            <p className={styles.label}>Return equipment</p>
            <h1>{returnPending.name}</h1>
            <p className={styles.sub}>{returnPending.category}</p>
            <div className={styles.cartActions}>
              <button className={styles.cancelBtn} onClick={() => setReturnPending(null)}>← Cancel</button>
              <button className={styles.primaryBtn} onClick={confirmReturn}>Confirm return</button>
            </div>
          </div>
        )}

      </div>

      {/* ══════════════════════════════════════════════════════════════════
          RIGHT PANEL — live log
      ══════════════════════════════════════════════════════════════════ */}
      <div className={styles.right}>
        <div className={styles.rightHeader}>
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${rightTab === 'open' ? styles.tabActive : ''}`}
              onClick={() => setRightTab('open')}>
              Open checkouts
              {lateCount > 0 && <span className={styles.lateBadge}>{lateCount} late</span>}
            </button>
            <button
              className={`${styles.tab} ${rightTab === 'history' ? styles.tabActive : ''}`}
              onClick={() => setRightTab('history')}>
              History
            </button>
          </div>
          <div className={styles.searchRow}>
            <span className={styles.searchIcon}>🔍</span>
            <input className={styles.searchInput}
              placeholder="Search students or equipment…"
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            {rightTab === 'open' && (
              <button
                className={`${styles.filterPill} ${filterLate ? styles.filterActive : ''}`}
                onClick={() => setFilterLate(f => !f)}>
                {filterLate ? '✕ Late only' : 'Late only'}
              </button>
            )}
          </div>
        </div>

        <div className={styles.tableWrap}>
          {filteredRows.length === 0 ? (
            <p className={styles.emptyLog}>
              {searchQuery || filterLate
                ? 'No matches'
                : rightTab === 'open'
                  ? 'No equipment currently checked out'
                  : 'No history yet'}
            </p>
          ) : (
            <table className={styles.logTable}>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Equipment</th>
                  <th>{rightTab === 'open' ? 'Due' : 'Returned'}</th>
                  <th>Reason</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(row => {
                  const isLate = row.due_at && !row.checked_in_at && new Date(row.due_at) < new Date()
                  const status = row.checked_in_at ? 'returned' : isLate ? 'late' : 'out'
                  return (
                    <tr key={row.id} className={styles.logRow} onClick={() => setSelectedRow(row)}>
                      <td>
                        <div className={styles.studentCol}>
                          <span className={styles.sName}>{row.student_name}</span>
                          <span className={styles.sSub}>{row.student_email || row.class_group || '—'}</span>
                        </div>
                      </td>
                      <td>
                        <div className={styles.eqCol}>
                          <span className={styles.eqName}>{row.equipment_name}</span>
                          <span className={styles.eqCat}>{row.equipment_category}</span>
                        </div>
                      </td>
                      <td>
                        <div className={styles.dueCol}>
                          <span className={styles.dueDate}>
                            {formatDate(row.checked_in_at || row.due_at)}
                          </span>
                          {!row.checked_in_at && (
                            <span className={`${styles.dueCountdown} ${isLate ? styles.dueLate : ''}`}>
                              {formatDue(row.due_at)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={styles.reasonCell}>
                          {row.reason || row.teacher_name || '—'}
                        </span>
                      </td>
                      <td>
                        <span className={`${styles.statusBadge} ${styles['status_' + status]}`}>
                          {status === 'returned' ? 'In' : status === 'late' ? 'Late' : 'Out'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          STUDENT DETAIL SLIDE-IN
      ══════════════════════════════════════════════════════════════════ */}
      {selectedRow && (
        <div className={styles.detailOverlay} onClick={() => setSelectedRow(null)}>
          <div className={styles.detailPanel} onClick={e => e.stopPropagation()}>
            <button className={styles.detailClose} onClick={() => setSelectedRow(null)}>✕</button>
            <p className={styles.label}>Student</p>
            <h2 className={styles.detailName}>{selectedRow.student_name}</h2>
            {selectedRow.class_group && (
              <span className={styles.classTag}>{selectedRow.class_group}</span>
            )}

            <div className={styles.detailMeta}>
              {selectedRow.student_email && (
                <div className={styles.detailRow}>
                  <span>Email</span><span>{selectedRow.student_email}</span>
                </div>
              )}
              {selectedRow.student_phone && (
                <div className={styles.detailRow}>
                  <span>Phone</span><span>{selectedRow.student_phone}</span>
                </div>
              )}
              {selectedRow.teacher_name && (
                <div className={styles.detailRow}>
                  <span>Teacher</span><span>{selectedRow.teacher_name}</span>
                </div>
              )}
              {selectedRow.class_name && (
                <div className={styles.detailRow}>
                  <span>Class</span><span>{selectedRow.class_name}</span>
                </div>
              )}
            </div>

            <div className={styles.detailSection}>
              <p className={styles.label}>This checkout</p>
              <div className={styles.detailRow}>
                <span>Equipment</span><span>{selectedRow.equipment_name}</span>
              </div>
              <div className={styles.detailRow}>
                <span>Category</span><span>{selectedRow.equipment_category}</span>
              </div>
              <div className={styles.detailRow}>
                <span>Checked out</span><span>{formatDate(selectedRow.checked_out_at)}</span>
              </div>
              <div className={styles.detailRow}>
                <span>Due</span>
                <span style={{ color: selectedRow.checked_in_at ? undefined : new Date(selectedRow.due_at) < new Date() ? '#f87171' : '#a78bfa' }}>
                  {formatDate(selectedRow.due_at)}
                </span>
              </div>
              {selectedRow.checked_in_at && (
                <div className={styles.detailRow}>
                  <span>Returned</span><span>{formatDate(selectedRow.checked_in_at)}</span>
                </div>
              )}
              {selectedRow.reason && (
                <div className={styles.detailRow}>
                  <span>Reason</span><span>{selectedRow.reason}</span>
                </div>
              )}
              {selectedRow.manager_name && (
                <div className={styles.detailRow}>
                  <span>Manager</span><span>{selectedRow.manager_name}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <footer className={styles.footer}>
        <a href="/dashboard">Dashboard →</a>
      </footer>
    </div>
  )
}
