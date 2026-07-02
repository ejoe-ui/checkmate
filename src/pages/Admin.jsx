/*
  CheckMate Admin — Admin.jsx
  ─────────────────────────────────────────────────────────────────────────────
  Full admin panel at /admin
  Tabs: Equipment | Students | Managers
  Auth: manager PIN gate (same managers as kiosk)
*/

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import styles from './Admin.module.css'

const ADMIN_FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/checkmate-admin`
const ANON_KEY     = import.meta.env.VITE_SUPABASE_ANON_KEY

const EQUIPMENT_STATUSES = ['Available', 'Checked Out', 'Maintenance', 'Retired', 'Lost']
const EQUIPMENT_CATEGORIES = ['Camera', 'Lens', 'Audio', 'Lighting', 'Tripod', 'Bag', 'Drone', 'Computer', 'Accessory', 'Other']
const FORM_STATUSES = [
  { value: 'form_on_file', label: 'Form on file' },
  { value: 'pending',      label: 'Pending'      },
  { value: 'no_form',      label: 'No form'      },
  { value: 'restricted',   label: 'Restricted'   },
]

const CONDITION_OUT_LABELS = {
  good:             '✓ Good condition',
  minor_wear:       '〰 Minor wear',
  missing_part:     '📦 Missing part/accessory',
  existing_damage:  '⚠ Existing damage',
  needs_inspection: '🔍 Needs inspection',
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function formatDue(iso) {
  if (!iso) return { label: '—', overdue: false }
  const diff = new Date(iso) - new Date()
  const overdue = diff < 0
  if (overdue) {
    const h = Math.floor(-diff / 3600000)
    const d = Math.floor(-diff / 86400000)
    return { label: d > 0 ? `${d}d overdue` : `${h}h overdue`, overdue: true }
  }
  const d = Math.floor(diff / 86400000)
  const h = Math.floor(diff / 3600000) % 24
  const dateStr = new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return { label: d === 0 ? `Today · ${h}h left` : `${dateStr} · ${d}d left`, overdue: false }
}

// ── API helper ──────────────────────────────────────────────────────────────
async function adminCall(action, payload = {}) {
  const res = await fetch(ADMIN_FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ action, ...payload }),
  })
  return res.json()
}

// ── Small avatar component ──────────────────────────────────────────────────
function Avatar({ name, photoUrl, photoAvailable, size = 'sm' }) {
  const [imgErr, setImgErr] = useState(false)
  const cls = size === 'sm' ? styles.avatarSm : ''
  const initCls = size === 'sm' ? styles.avatarSmInitials : ''
  const initials = name?.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() ?? '?'
  if (photoAvailable && photoUrl && !imgErr) {
    return <img src={photoUrl} alt="" className={cls} onError={() => setImgErr(true)} />
  }
  return <span className={initCls}>{initials}</span>
}

// ── Form status badge ────────────────────────────────────────────────────────
const FORM_BADGE = {
  form_on_file: ['Form on file', styles.form_ok],
  pending:      ['Pending',      styles.form_pending],
  no_form:      ['No form',      styles.form_none],
  restricted:   ['Restricted',   styles.form_restricted],
}
function FormBadge({ status, onClick }) {
  const [label, cls] = FORM_BADGE[status] ?? FORM_BADGE.no_form
  return (
    <span className={`${styles.formBadge} ${cls}`} onClick={onClick} title="Click to change">
      {label}
    </span>
  )
}

// ── Equipment status badge ───────────────────────────────────────────────────
const STATUS_CLS = {
  'Available':   styles.status_available,
  'Checked Out': styles.status_checked_out,
  'Maintenance': styles.status_maintenance,
  'Retired':     styles.status_retired,
  'Lost':        styles.status_lost,
}
function StatusBadge({ status }) {
  return (
    <span className={`${styles.statusBadge} ${STATUS_CLS[status] ?? ''}`}>{status}</span>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// EQUIPMENT TAB
// ═══════════════════════════════════════════════════════════════════════════
function EquipmentTab({ manager, pin }) {
  const [equipment, setEquipment] = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [editItem, setEditItem]   = useState(null) // null = closed, {} = new, item = edit

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await adminCall('equipment.list')
    if (data) setEquipment(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    if (!search) return equipment
    const q = search.toLowerCase()
    return equipment.filter(e =>
      e.name?.toLowerCase().includes(q) ||
      e.category?.toLowerCase().includes(q) ||
      e.serial_number?.toLowerCase().includes(q) ||
      e.asset_id?.toLowerCase().includes(q) ||
      e.nfc_uid?.toLowerCase().includes(q)
    )
  }, [equipment, search])

  // Stats
  const stats = useMemo(() => ({
    total:      equipment.length,
    available:  equipment.filter(e => e.status === 'Available').length,
    out:        equipment.filter(e => e.status === 'Checked Out').length,
    issues:     equipment.filter(e => ['Maintenance','Lost'].includes(e.status)).length,
  }), [equipment])

  async function handleSave(item) {
    const { error } = await adminCall('equipment.upsert', { managerId: manager.id, pin, equipment: item })
    if (error) { alert('Save failed: ' + error); return }
    setEditItem(null)
    load()
  }

  async function handleStatusChange(equipmentId, status) {
    await adminCall('equipment.setStatus', { managerId: manager.id, pin, equipmentId, status })
    load()
  }

  async function handleRetire(equipmentId) {
    if (!confirm('Mark this item as Retired?')) return
    await adminCall('equipment.delete', { managerId: manager.id, pin, equipmentId })
    load()
  }

  return (
    <div className={styles.content}>
      {/* Stats */}
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <div className={styles.statNum}>{stats.total}</div>
          <div className={styles.statLabel}>Total items</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statNum} style={{ color: '#37B37E' }}>{stats.available}</div>
          <div className={styles.statLabel}>Available</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statNum} style={{ color: '#8A5600' }}>{stats.out}</div>
          <div className={styles.statLabel}>Checked out</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statNum} style={{ color: '#dc2626' }}>{stats.issues}</div>
          <div className={styles.statLabel}>Needs attention</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <input className={styles.searchInput} placeholder="Search equipment…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <button className={styles.primaryBtn} onClick={() => setEditItem({})}>+ Add equipment</button>
      </div>

      {/* Table */}
      {loading ? (
        <div className={styles.emptyState}><span className={styles.emptyIcon}>⏳</span><p className={styles.emptyTitle}>Loading…</p></div>
      ) : filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>📷</span>
          <p className={styles.emptyTitle}>{search ? 'No matches' : 'No equipment yet'}</p>
          <p className={styles.emptyHint}>{search ? 'Try a different search.' : 'Add your first item to get started.'}</p>
        </div>
      ) : (
        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th></th>
                <th>Name</th>
                <th>Category</th>
                <th>Status</th>
                <th>NFC UID</th>
                <th>Serial / Asset ID</th>
                <th>Location</th>
                <th>Cost</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => (
                <tr key={item.id}>
                  <td style={{ width: 44, padding: '6px 8px 6px 14px' }}>
                    {item.photo_url
                      ? <img src={item.photo_url} alt="" className={styles.equipThumb} onError={e => { e.target.style.display='none' }} />
                      : <span className={styles.equipThumbEmpty}>📷</span>}
                  </td>
                  <td>
                    <strong>{item.name}</strong>
                    {item.equipment_notes && <div className={styles.tdMuted}>{item.equipment_notes}</div>}
                  </td>
                  <td className={styles.tdMuted}>{item.category}</td>
                  <td>
                    <select className={styles.inlineSelect} value={item.status}
                      onChange={e => handleStatusChange(item.id, e.target.value)}>
                      {EQUIPMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className={styles.tdMono}>{item.nfc_uid || <span className={styles.tdMuted}>—</span>}</td>
                  <td>
                    <div className={styles.tdMono}>{item.serial_number || '—'}</div>
                    {item.asset_id && <div className={styles.tdMuted}>ID: {item.asset_id}</div>}
                  </td>
                  <td className={styles.tdMuted}>{item.storage_location || '—'}</td>
                  <td className={styles.tdMuted}>
                    {item.replacement_cost ? `$${Number(item.replacement_cost).toFixed(0)}` : '—'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className={styles.secondaryBtn} onClick={() => setEditItem(item)}>Edit</button>
                      <button className={styles.dangerBtn} onClick={() => handleRetire(item.id)}>Retire</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Equipment modal */}
      {editItem !== null && (
        <EquipmentModal
          item={editItem}
          onSave={handleSave}
          onClose={() => setEditItem(null)}
        />
      )}
    </div>
  )
}

function EquipmentModal({ item, onSave, onClose }) {
  const isNew = !item.id
  const [form, setForm] = useState({
    id:               item.id ?? undefined,
    name:             item.name ?? '',
    category:         item.category ?? 'Camera',
    status:           item.status ?? 'Available',
    nfc_uid:          item.nfc_uid ?? '',
    serial_number:    item.serial_number ?? '',
    asset_id:         item.asset_id ?? '',
    storage_location: item.storage_location ?? '',
    replacement_cost: item.replacement_cost ?? '',
    equipment_notes:  item.equipment_notes ?? '',
    photo_url:        item.photo_url ?? '',
    is_container:     item.is_container ?? false,
  })

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.modalClose} onClick={onClose}>✕</button>
        <h2 className={styles.modalTitle}>{isNew ? 'Add equipment' : 'Edit equipment'}</h2>

        <div className={styles.formGrid}>
          <div className={`${styles.formField} ${styles.fullWidth}`}>
            <label className={styles.formLabel}>Name *</label>
            <input className={styles.formInput} value={form.name}
              onChange={e => set('name', e.target.value)} placeholder="e.g. Canon EOS R6 #1" />
          </div>
          <div className={styles.formField}>
            <label className={styles.formLabel}>Category</label>
            <select className={styles.formSelect} value={form.category}
              onChange={e => set('category', e.target.value)}>
              {EQUIPMENT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className={styles.formField}>
            <label className={styles.formLabel}>Status</label>
            <select className={styles.formSelect} value={form.status}
              onChange={e => set('status', e.target.value)}>
              {EQUIPMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className={styles.formField}>
            <label className={styles.formLabel}>NFC UID (tag)</label>
            <input className={styles.formInput} value={form.nfc_uid}
              onChange={e => set('nfc_uid', e.target.value)} placeholder="Scan or enter tag UID" />
          </div>
          <div className={styles.formField}>
            <label className={styles.formLabel}>Serial number</label>
            <input className={styles.formInput} value={form.serial_number}
              onChange={e => set('serial_number', e.target.value)} />
          </div>
          <div className={styles.formField}>
            <label className={styles.formLabel}>Asset ID (school tag)</label>
            <input className={styles.formInput} value={form.asset_id}
              onChange={e => set('asset_id', e.target.value)} />
          </div>
          <div className={styles.formField}>
            <label className={styles.formLabel}>Storage location</label>
            <input className={styles.formInput} value={form.storage_location}
              onChange={e => set('storage_location', e.target.value)} placeholder="e.g. Cabinet A, Shelf 2" />
          </div>
          <div className={styles.formField}>
            <label className={styles.formLabel}>Replacement cost ($)</label>
            <input className={styles.formInput} type="number" value={form.replacement_cost}
              onChange={e => set('replacement_cost', e.target.value)} placeholder="0.00" />
          </div>
          <div className={`${styles.formField} ${styles.fullWidth}`}>
            <label className={styles.formLabel}>Notes</label>
            <textarea className={styles.formTextarea} value={form.equipment_notes}
              onChange={e => set('equipment_notes', e.target.value)}
              placeholder="Condition notes, accessories included, etc." />
          </div>
          <div className={`${styles.formField} ${styles.fullWidth}`}>
            <label className={styles.formLabel}>Photo URL</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <input className={styles.formInput} style={{ flex: 1 }} value={form.photo_url}
                onChange={e => set('photo_url', e.target.value)}
                placeholder="https://…  (link to equipment photo)" />
              {form.photo_url && (
                <img src={form.photo_url} alt="" className={styles.equipThumbPreview}
                  onError={e => { e.target.style.display = 'none' }} />
              )}
            </div>
          </div>
          <div className={styles.formField}>
            <label className={styles.formLabel}>Kit / container?</label>
            <select className={styles.formSelect} value={form.is_container ? 'yes' : 'no'}
              onChange={e => set('is_container', e.target.value === 'yes')}>
              <option value="no">No — single item</option>
              <option value="yes">Yes — kit bag with contents</option>
            </select>
          </div>
        </div>

        <div className={styles.modalActions}>
          <button className={styles.secondaryBtn} onClick={onClose}>Cancel</button>
          <button className={styles.primaryBtn}
            disabled={!form.name.trim()}
            onClick={() => onSave(form)}>
            {isNew ? 'Add equipment' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECKOUTS TAB
// ═══════════════════════════════════════════════════════════════════════════
const NOTE_TYPE_LABELS = {
  contacted:       '✓ Contacted',
  extended_due:    '📅 Extended',
  marked_resolved: '✅ Resolved',
  other:           '📝 Note',
}

function formatNoteTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function CheckoutsTab({ manager, pin }) {
  const [checkouts, setCheckouts]           = useState([])
  const [loading, setLoading]               = useState(true)
  const [search, setSearch]                 = useState('')
  const [selectedCheckout, setSelectedCheckout] = useState(null)
  const [overdueNotes, setOverdueNotes]     = useState([])
  const [notesLoading, setNotesLoading]     = useState(false)
  const [noteText, setNoteText]             = useState('')
  const [noteType, setNoteType]             = useState('contacted')
  const [extendDate, setExtendDate]         = useState('')
  const [showNoteForm, setShowNoteForm]     = useState(false)
  const [saving, setSaving]                 = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('cm_open_checkouts')
      .select('*')
      .order('checked_out_at', { ascending: false })
    if (data) setCheckouts(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 30 s
  useEffect(() => {
    const id = setInterval(load, 30000)
    return () => clearInterval(id)
  }, [load])

  const now = new Date()

  const filtered = useMemo(() => {
    if (!search) return checkouts
    const q = search.toLowerCase()
    return checkouts.filter(c =>
      c.student_name?.toLowerCase().includes(q) ||
      c.equipment_name?.toLowerCase().includes(q) ||
      c.manager_name?.toLowerCase().includes(q)
    )
  }, [checkouts, search])

  const stats = useMemo(() => ({
    total:   checkouts.length,
    overdue: checkouts.filter(c => c.due_at && new Date(c.due_at) < now).length,
  }), [checkouts])

  async function loadNotes(checkoutId) {
    setNotesLoading(true)
    const { data } = await adminCall('checkout.getOverdueNotes', { managerId: manager.id, pin, checkoutId })
    setOverdueNotes(data || [])
    setNotesLoading(false)
  }

  async function openDetail(checkout) {
    setSelectedCheckout(checkout)
    setNoteText('')
    setExtendDate('')
    setShowNoteForm(false)
    setNoteType('contacted')
    await loadNotes(checkout.id)
  }

  async function quickContacted() {
    if (saving) return
    setSaving(true)
    await adminCall('checkout.addOverdueNote', {
      managerId: manager.id, pin,
      checkoutId: selectedCheckout.id,
      studentId:  selectedCheckout.student_id,
      note:       'Contacted student',
      noteType:   'contacted',
    })
    await loadNotes(selectedCheckout.id)
    setSaving(false)
  }

  async function saveNote() {
    if (!noteText.trim() || saving) return
    setSaving(true)
    const isExtend = noteType === 'extended_due'
    const extendedDueAt = isExtend && extendDate ? new Date(extendDate).toISOString() : null
    await adminCall('checkout.addOverdueNote', {
      managerId: manager.id, pin,
      checkoutId:    selectedCheckout.id,
      studentId:     selectedCheckout.student_id,
      note:          noteText.trim(),
      noteType,
      extendedDueAt,
    })
    if (extendedDueAt) {
      setCheckouts(prev => prev.map(c => c.id === selectedCheckout.id ? { ...c, due_at: extendedDueAt } : c))
      setSelectedCheckout(prev => ({ ...prev, due_at: extendedDueAt }))
    }
    setNoteText('')
    setExtendDate('')
    setShowNoteForm(false)
    await loadNotes(selectedCheckout.id)
    setSaving(false)
  }

  return (
    <div className={styles.content}>
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <div className={styles.statNum} style={{ color: '#8A5600' }}>{stats.total}</div>
          <div className={styles.statLabel}>Currently out</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statNum} style={{ color: stats.overdue > 0 ? '#dc2626' : '#A8ABB8' }}>
            {stats.overdue}
          </div>
          <div className={styles.statLabel}>Overdue</div>
        </div>
      </div>

      <div className={styles.toolbar}>
        <input className={styles.searchInput} placeholder="Search student or equipment…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <button className={styles.secondaryBtn} onClick={load}>↻ Refresh</button>
      </div>

      {loading ? (
        <div className={styles.emptyState}><span className={styles.emptyIcon}>⏳</span><p className={styles.emptyTitle}>Loading…</p></div>
      ) : filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>✓</span>
          <p className={styles.emptyTitle}>{search ? 'No matches' : 'All equipment is in'}</p>
          <p className={styles.emptyHint}>Nothing is checked out right now.</p>
        </div>
      ) : (
        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Student</th>
                <th>Equipment</th>
                <th>Checked out</th>
                <th>Due</th>
                <th>Condition out</th>
                <th>Reason</th>
                <th>Manager</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const due = formatDue(c.due_at)
                return (
                  <tr key={c.id} className={styles.clickableRow}
                    onClick={() => openDetail(c)}>
                    <td>
                      <div className={styles.studentCell}>
                        <Avatar name={c.student_name} photoUrl={c.student_photo_url} photoAvailable={c.student_photo_available} />
                        <div>
                          <div><strong>{c.student_name}</strong></div>
                          {c.class_group && <div className={styles.tdMuted}>{c.class_group}</div>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <strong>{c.equipment_name}</strong>
                      <div className={styles.tdMuted}>{c.equipment_category}</div>
                    </td>
                    <td className={styles.tdMuted}>{formatDate(c.checked_out_at)}</td>
                    <td>
                      <span className={due.overdue ? styles.overdueBadge : styles.tdMuted}>
                        {due.label}
                      </span>
                    </td>
                    <td className={styles.tdMuted}>{CONDITION_OUT_LABELS[c.condition_out] ?? c.condition_out ?? '—'}</td>
                    <td className={styles.tdMuted}>{c.reason || '—'}</td>
                    <td className={styles.tdMuted}>{c.manager_name}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Overdue detail / note panel ─────────────────────────────────── */}
      {selectedCheckout && (
        <div className={styles.modalOverlay} onClick={() => setSelectedCheckout(null)}>
          <div className={styles.overduePanel} onClick={e => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setSelectedCheckout(null)}>✕</button>

            {/* Header */}
            <div className={styles.overduePanelHeader}>
              <div>
                <p className={styles.overduePanelLabel}>Checkout detail</p>
                <h3 className={styles.overduePanelName}>{selectedCheckout.student_name}</h3>
                <p className={styles.overduePanelSub}>{selectedCheckout.equipment_name} · {selectedCheckout.equipment_category}</p>
              </div>
              {(() => {
                const due = formatDue(selectedCheckout.due_at)
                return due.overdue
                  ? <span className={styles.overduePanelBadge}>OVERDUE · {due.label}</span>
                  : <span className={styles.onTimePanelBadge}>{due.label}</span>
              })()}
            </div>

            {/* Meta row */}
            <div className={styles.overdueMeta}>
              <div className={styles.overdueMetaItem}>
                <span className={styles.overdueMetaLabel}>Checked out</span>
                <span>{formatDate(selectedCheckout.checked_out_at)}</span>
              </div>
              <div className={styles.overdueMetaItem}>
                <span className={styles.overdueMetaLabel}>Due</span>
                <span>{formatDate(selectedCheckout.due_at)}</span>
              </div>
              {selectedCheckout.teacher_name && (
                <div className={styles.overdueMetaItem}>
                  <span className={styles.overdueMetaLabel}>Teacher responsible</span>
                  <span>{selectedCheckout.teacher_name}</span>
                </div>
              )}
              {selectedCheckout.approved_by && (
                <div className={styles.overdueMetaItem}>
                  <span className={styles.overdueMetaLabel}>Approved by</span>
                  <span>{selectedCheckout.approved_by}</span>
                </div>
              )}
              {selectedCheckout.reason && (
                <div className={styles.overdueMetaItem}>
                  <span className={styles.overdueMetaLabel}>Reason</span>
                  <span>{selectedCheckout.reason}</span>
                </div>
              )}
              {selectedCheckout.condition_out && selectedCheckout.condition_out !== 'good' && (
                <div className={styles.overdueMetaItem}>
                  <span className={styles.overdueMetaLabel}>Condition at checkout</span>
                  <span>{CONDITION_OUT_LABELS[selectedCheckout.condition_out] ?? selectedCheckout.condition_out}</span>
                </div>
              )}
            </div>

            {/* Quick actions */}
            <div className={styles.overdueQuickActions}>
              <button className={styles.quickActionBtn} onClick={quickContacted} disabled={saving}>
                ✓ Contacted
              </button>
              <button className={styles.quickActionBtn}
                onClick={() => { setNoteType('extended_due'); setShowNoteForm(true) }}
                disabled={saving}>
                📅 Extend
              </button>
              <button className={styles.quickActionBtn}
                onClick={() => { setNoteType('other'); setShowNoteForm(true) }}
                disabled={saving}>
                📝 Add note
              </button>
            </div>

            {/* Note form */}
            {showNoteForm && (
              <div className={styles.noteForm}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <select className={styles.inlineSelect} value={noteType} onChange={e => setNoteType(e.target.value)}>
                    <option value="contacted">✓ Contacted student</option>
                    <option value="extended_due">📅 Extended due date</option>
                    <option value="marked_resolved">✅ Marked resolved</option>
                    <option value="other">📝 Other note</option>
                  </select>
                </div>
                {noteType === 'extended_due' && (
                  <input type="datetime-local" className={styles.formInput}
                    style={{ marginBottom: 8 }}
                    value={extendDate} onChange={e => setExtendDate(e.target.value)} />
                )}
                <textarea className={styles.formTextarea}
                  placeholder={
                    noteType === 'contacted'       ? 'e.g. Reminded student in Period 3…' :
                    noteType === 'extended_due'    ? 'Reason for extension…' :
                    noteType === 'marked_resolved' ? 'How was it resolved?…' :
                    'Add a note…'
                  }
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  rows={3}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                  <button className={styles.secondaryBtn}
                    onClick={() => { setShowNoteForm(false); setNoteText(''); setExtendDate('') }}>
                    Cancel
                  </button>
                  <button className={styles.primaryBtn}
                    onClick={saveNote}
                    disabled={saving || !noteText.trim()}>
                    {saving ? '…' : 'Save'}
                  </button>
                </div>
              </div>
            )}

            {/* Note timeline */}
            <div className={styles.noteTimeline}>
              <p className={styles.overdueMetaLabel} style={{ marginBottom: 10 }}>
                Note history {overdueNotes.length > 0 ? `(${overdueNotes.length})` : ''}
              </p>
              {notesLoading ? (
                <p className={styles.tdMuted}>Loading…</p>
              ) : overdueNotes.length === 0 ? (
                <p className={styles.tdMuted} style={{ fontSize: 12, fontStyle: 'italic' }}>
                  No notes yet. Use quick actions above to log contact or extend the due date.
                </p>
              ) : (
                overdueNotes.map(n => (
                  <div key={n.id} className={styles.noteEntry}>
                    <div className={styles.noteEntryHeader}>
                      <span className={styles.noteTypeTag}>
                        {NOTE_TYPE_LABELS[n.action] ?? '📝 Note'}
                      </span>
                      <span className={styles.noteEntryTime}>
                        {formatNoteTime(n.created_at)} · {n.cm_managers?.name ?? 'Unknown'}
                      </span>
                    </div>
                    <p className={styles.noteEntryText}>{n.note}</p>
                    {n.extended_due_at && (
                      <p className={styles.noteEntryExtend}>
                        New due date: {formatDate(n.extended_due_at)}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// STUDENTS TAB
// ═══════════════════════════════════════════════════════════════════════════
function StudentsTab({ manager, pin }) {
  const [students, setStudents]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [syncing, setSyncing]     = useState(false)
  const [syncMsg, setSyncMsg]     = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await adminCall('student.list')
    if (data) setStudents(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    if (!search) return students
    const q = search.toLowerCase()
    return students.filter(s =>
      s.name?.toLowerCase().includes(q) ||
      s.email?.toLowerCase().includes(q) ||
      s.class_group?.toLowerCase().includes(q)
    )
  }, [students, search])

  const formStats = useMemo(() => ({
    total:      students.length,
    onFile:     students.filter(s => s.equipment_form_status === 'form_on_file').length,
    noForm:     students.filter(s => s.equipment_form_status === 'no_form').length,
    restricted: students.filter(s => s.equipment_form_status === 'restricted').length,
  }), [students])

  async function handleFormStatus(studentId, formStatus) {
    await adminCall('student.setFormStatus', { managerId: manager.id, pin, studentId, formStatus })
    setStudents(prev => prev.map(s =>
      s.id === studentId ? { ...s, equipment_form_status: formStatus } : s
    ))
  }

  async function handleSyncAllPhotos() {
    setSyncing(true)
    setSyncMsg('')
    const { ok, synced, error } = await adminCall('student.syncAllPhotos', { managerId: manager.id, pin })
    setSyncing(false)
    if (error) { setSyncMsg('Sync failed: ' + error); return }
    setSyncMsg(`✓ Synced ${synced} photos from PassAble`)
    load()
  }

  return (
    <div className={styles.content}>
      {/* Stats */}
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <div className={styles.statNum}>{formStats.total}</div>
          <div className={styles.statLabel}>Total students</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statNum} style={{ color: '#166534' }}>{formStats.onFile}</div>
          <div className={styles.statLabel}>Form on file</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statNum} style={{ color: '#dc2626' }}>{formStats.noForm}</div>
          <div className={styles.statLabel}>No form</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statNum} style={{ color: '#dc2626' }}>{formStats.restricted}</div>
          <div className={styles.statLabel}>Restricted</div>
        </div>
      </div>

      {/* Photo sync banner */}
      <div className={styles.syncBanner}>
        <span>📸 Student photos sync from PassAble Lifetouch records.</span>
        <button className={styles.secondaryBtn} onClick={handleSyncAllPhotos} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync all photos'}
        </button>
      </div>
      {syncMsg && <p style={{ fontSize: 12, color: '#166534', margin: '0 0 12px' }}>{syncMsg}</p>}

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <input className={styles.searchInput} placeholder="Search students…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <span style={{ fontSize: 12, color: '#7A7D8C', marginLeft: 'auto' }}>
          Click a form status badge to change it
        </span>
      </div>

      {/* Table */}
      {loading ? (
        <div className={styles.emptyState}><span className={styles.emptyIcon}>⏳</span><p className={styles.emptyTitle}>Loading…</p></div>
      ) : filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>🎒</span>
          <p className={styles.emptyTitle}>{search ? 'No matches' : 'No students found'}</p>
        </div>
      ) : (
        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Student</th>
                <th>Class</th>
                <th>Email</th>
                <th>NFC UID</th>
                <th>Equipment form</th>
                <th>Photo</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id}>
                  <td>
                    <div className={styles.studentCell}>
                      <Avatar name={s.name} photoUrl={s.photo_url} photoAvailable={s.photo_available} />
                      <strong>{s.name}</strong>
                    </div>
                  </td>
                  <td className={styles.tdMuted}>{s.class_group || '—'}</td>
                  <td className={styles.tdMuted}>{s.email || '—'}</td>
                  <td className={styles.tdMono}>{s.nfc_uid || <span className={styles.tdMuted}>—</span>}</td>
                  <td>
                    <select className={styles.inlineSelect}
                      value={s.equipment_form_status ?? 'no_form'}
                      onChange={e => handleFormStatus(s.id, e.target.value)}>
                      {FORM_STATUSES.map(f => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {s.photo_available
                      ? <span style={{ fontSize: 11, color: '#166534' }}>✓ Synced</span>
                      : <span style={{ fontSize: 11, color: '#A8ABB8' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MANAGERS TAB
// ═══════════════════════════════════════════════════════════════════════════
function ManagersTab() {
  const [managers, setManagers] = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    adminCall('manager.list').then(({ data }) => {
      if (data) setManagers(data)
      setLoading(false)
    })
  }, [])

  return (
    <div className={styles.content}>
      {loading ? (
        <div className={styles.emptyState}><span className={styles.emptyIcon}>⏳</span><p className={styles.emptyTitle}>Loading…</p></div>
      ) : (
        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>NFC UID</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {managers.map(m => (
                <tr key={m.id}>
                  <td><strong>{m.name}</strong></td>
                  <td className={styles.tdMono}>{m.nfc_uid || '—'}</td>
                  <td>
                    <span className={`${styles.statusBadge} ${m.active ? styles.status_available : styles.status_retired}`}>
                      {m.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ fontSize: 11, color: '#A8ABB8', marginTop: 14 }}>
        To add or remove managers, use Supabase → Table Editor → cm_managers.
      </p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTH GATE
// ═══════════════════════════════════════════════════════════════════════════
function AuthGate({ onAuth }) {
  const [managers, setManagers]   = useState([])
  const [managerId, setManagerId] = useState('')
  const [pin, setPin]             = useState('')
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(false)

  useEffect(() => {
    supabase.from('cm_managers').select('id, name').eq('active', true).order('name')
      .then(({ data }) => { if (data) setManagers(data) })
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!managerId || !pin) return
    setLoading(true); setError('')
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/checkmate-checkout`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON_KEY}` },
          body: JSON.stringify({ managerId, pin, studentId: null, equipmentIds: [] }),
        }
      )
      const json = await res.json()
      if (json.error) { setError(json.error); setLoading(false); return }
      const mgr = managers.find(m => m.id === managerId)
      onAuth(mgr, pin)
    } catch (err) {
      setError('Connection error')
    }
    setLoading(false)
  }

  return (
    <div className={styles.body}>
      <div className={styles.authGate}>
        <span style={{ fontSize: 40 }}>🔒</span>
        <h2>Admin Access</h2>
        <p>Enter your manager credentials to continue.</p>
        <form onSubmit={handleSubmit}>
          <div className={styles.authRow}>
            <select className={styles.authSelect} value={managerId}
              onChange={e => setManagerId(e.target.value)}>
              <option value="">Select manager…</option>
              {managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <input className={styles.authInput} type="password" inputMode="numeric"
              placeholder="PIN" maxLength={6} value={pin}
              onChange={e => setPin(e.target.value)} autoFocus />
            <button className={styles.primaryBtn} type="submit" disabled={loading || !managerId || !pin}>
              {loading ? '…' : 'Unlock'}
            </button>
          </div>
        </form>
        {error && <p className={styles.authError}>{error}</p>}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// ROOT ADMIN PAGE
// ═══════════════════════════════════════════════════════════════════════════
export default function Admin() {
  const [manager, setManager] = useState(null)
  const [pin, setPin]         = useState('')
  const [tab, setTab]         = useState('equipment')

  function handleAuth(mgr, p) {
    setManager(mgr)
    setPin(p)
  }

  return (
    <div className={styles.root}>
      {/* Header */}
      <header className={styles.header}>
        <span className={styles.logo}>
          ♟ RHS CheckMate
          <span className={styles.logoSub}>Equipment Checkout System</span>
        </span>
        <span className={styles.adminBadge}>ADMIN</span>
        {manager && (
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginLeft: 6 }}>
            {manager.name}
          </span>
        )}
        <span className={styles.headerSpacer} />
        {manager && (
          <button className={styles.backBtn}
            onClick={() => { setManager(null); setPin('') }}>
            🔒 Lock
          </button>
        )}
        <a className={styles.backBtn} href="/">← Kiosk</a>
      </header>

      {/* Auth gate */}
      {!manager ? (
        <AuthGate onAuth={handleAuth} />
      ) : (
        <>
          {/* Tabs */}
          <div className={styles.body}>
            <div className={styles.tabs}>
              <button
                className={`${styles.tab} ${tab === 'equipment' ? styles.tabActive : ''}`}
                onClick={() => setTab('equipment')}>
                📷 Equipment
              </button>
              <button
                className={`${styles.tab} ${tab === 'checkouts' ? styles.tabActive : ''}`}
                onClick={() => setTab('checkouts')}>
                📋 Checkouts
              </button>
              <button
                className={`${styles.tab} ${tab === 'students' ? styles.tabActive : ''}`}
                onClick={() => setTab('students')}>
                🎒 Students
              </button>
              <button
                className={`${styles.tab} ${tab === 'managers' ? styles.tabActive : ''}`}
                onClick={() => setTab('managers')}>
                👤 Managers
              </button>
            </div>

            {tab === 'equipment' && <EquipmentTab manager={manager} pin={pin} />}
            {tab === 'checkouts' && <CheckoutsTab manager={manager} pin={pin} />}
            {tab === 'students'  && <StudentsTab  manager={manager} pin={pin} />}
            {tab === 'managers'  && <ManagersTab />}
          </div>
        </>
      )}
    </div>
  )
}
