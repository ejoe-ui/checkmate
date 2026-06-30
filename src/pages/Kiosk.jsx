import { useState, useCallback, useRef } from 'react'
import NfcListener from '../components/NfcListener'
import { resolveUid } from '../lib/nfc'
import styles from './Kiosk.module.css'

const IDLE_AFTER_MS = 3000

export default function Kiosk() {
  const [state, setState]         = useState('idle')
  const [student, setStudent]     = useState(null)
  const [equipment, setEquipment] = useState(null)
  const [manager, setManager]     = useState(null)
  const [message, setMessage]     = useState('')
  const [pin, setPin]             = useState('')
  const pinRef                    = useRef(null)

  const reset = useCallback(() => {
    setState('idle')
    setStudent(null)
    setEquipment(null)
    setManager(null)
    setMessage('')
    setPin('')
  }, [])

  const autoReset = useCallback((delay = IDLE_AFTER_MS) => {
    setTimeout(reset, delay)
  }, [reset])

  const handleScan = useCallback(async (uid) => {
    const result = await resolveUid(uid)

    if (result.type === 'unknown') {
      setState('unknown_tag')
      setMessage(`Unrecognized tag: ${uid}`)
      autoReset(4000)
      return
    }
    if (result.type === 'student') {
      setStudent(result.data)
      setState('student')
      return
    }
    if (result.type === 'equipment') {
      setEquipment(result.data)
      setState('equipment')
      return
    }
    if (result.type === 'manager') {
      setManager(result.data)
      setState('manager_pin')
      setTimeout(() => pinRef.current?.focus(), 50)
      return
    }
  }, [autoReset])

  const handlePinSubmit = useCallback(async (e) => {
    e.preventDefault()
    if (!pin || pin.length < 4) return
    setMessage('PIN verification coming in Phase 3')
    setState('error')
    autoReset()
  }, [pin, autoReset])

  return (
    <div className={styles.root}>
      <NfcListener onScan={handleScan} disabled={state === 'manager_pin'} />

      <header className={styles.header}>
        <span className={styles.logo}>♟ CheckMate</span>
        <span className={styles.sub}>RHS Media Equipment</span>
      </header>

      <main className={styles.main}>

        {state === 'idle' && (
          <div className={styles.prompt}>
            <div className={styles.icon}>📷</div>
            <h1>Tap your student ID or a piece of gear to get started</h1>
          </div>
        )}

        {state === 'student' && student && (
          <div className={styles.card}>
            <p className={styles.label}>Student identified</p>
            <h1>{student.name}</h1>
            <p className={styles.sub}>Tap the equipment you want to check out or return</p>
            <button className={styles.cancelBtn} onClick={reset}>Cancel</button>
          </div>
        )}

        {state === 'equipment' && equipment && (
          <div className={styles.card}>
            <p className={styles.label}>{equipment.category}</p>
            <h1>{equipment.name}</h1>
            <p className={styles.statusBadge} data-status={equipment.status}>{equipment.status}</p>
            <p className={styles.sub}>
              {equipment.status === 'available'
                ? 'Tap your student ID, then a manager fob to check this out'
                : 'Tap your student ID to return it'}
            </p>
            <button className={styles.cancelBtn} onClick={reset}>Cancel</button>
          </div>
        )}

        {state === 'manager_pin' && manager && (
          <div className={styles.card}>
            <p className={styles.label}>Manager</p>
            <h1>{manager.name}</h1>
            <form onSubmit={handlePinSubmit} className={styles.pinForm}>
              <input
                ref={pinRef}
                type="password"
                inputMode="numeric"
                maxLength={6}
                placeholder="Enter PIN"
                value={pin}
                onChange={e => setPin(e.target.value)}
                className={styles.pinInput}
                autoComplete="off"
              />
              <button type="submit" className={styles.primaryBtn}>Authorize</button>
            </form>
            <button className={styles.cancelBtn} onClick={reset}>Cancel</button>
          </div>
        )}

        {state === 'success' && (
          <div className={styles.card} data-result="success">
            <div className={styles.icon}>✅</div>
            <h1>{message || 'Done!'}</h1>
          </div>
        )}

        {(state === 'error' || state === 'unknown_tag') && (
          <div className={styles.card} data-result="error">
            <div className={styles.icon}>⚠️</div>
            <h1>{message}</h1>
            <button className={styles.cancelBtn} onClick={reset}>Dismiss</button>
          </div>
        )}

      </main>

      <footer className={styles.footer}>
        <a href="/dashboard">Dashboard →</a>
      </footer>
    </div>
  )
}
