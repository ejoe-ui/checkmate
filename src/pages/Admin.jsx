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

const EQUIPMENT_STATUSES = ['Available', 'Checked Out', 'Damaged', 'Needs Inspection', 'Maintenance', 'Retired', 'Lost']
const EQUIPMENT_CATEGORIES = ['Camera', 'Lens', 'Audio', 'Lighting', 'Tripod', 'Bag', 'Drone', 'Computer', 'Accessory', 'Other']
const FORM_STATUSES = [
  { value: 'form_on_file', label: 'Form on file' },
  { value: 'pending',      label: 'Pending'      },
  { value: 'no_form',      label: 'No form'      },
  { value: 'restricted',   label: 'Restricted'   },
  { value: 'temp_pass',    label: 'Temp pass'    },
]

function formatTempExpiry(iso) {
  if (!iso) return null
  const exp = new Date(iso)
  const now = new Date()
  if (exp < now) return { label: 'Expired', overdue: true }
  const diffMs = exp - now
  const diffH  = Math.floor(diffMs / 3600000)
  const diffD  = Math.floor(diffMs / 86400000)
  const timeStr = exp.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (diffD === 0) return { label: `Expires today at ${timeStr}`, overdue: false }
  return { label: `Expires ${exp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${timeStr}`, overdue: false }
}

const CONDITION_OUT_LABELS = {
  good:             '✓ Good condition',
  minor_wear:       '〰 Minor wear',
  missing_part:     '📦 Missing part/accessory',
  existing_damage:  '⚠ Existing damage',
  needs_inspection: '🔍 Needs inspection',
}

const CONDITION_IN_LABELS = {
  returned_ok:          '✓ Returned OK',
  returned_with_issue:  '⚠ Returned with issue',
  missing_accessory:    '📦 Missing accessory',
  damaged:              '💥 Damaged',
  needs_inspection:     '🔍 Needs inspection',
}

const CONDITION_IN_ISSUE = new Set(['returned_with_issue', 'missing_accessory', 'damaged', 'needs_inspection'])

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
  const cls      = size === 'lg' ? styles.avatarLg      : styles.avatarSm
  const initCls  = size === 'lg' ? styles.avatarLgInitials : styles.avatarSmInitials
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
  'Available':        styles.status_available,
  'Checked Out':      styles.status_checked_out,
  'Damaged':          styles.status_damaged,
  'Needs Inspection': styles.status_needs_inspection,
  'Maintenance':      styles.status_maintenance,
  'Retired':          styles.status_retired,
  'Lost':             styles.status_lost,
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
  const [equipment, setEquipment]           = useState([])
  const [loading, setLoading]               = useState(true)
  const [search, setSearch]                 = useState('')
  const [editItem, setEditItem]             = useState(null) // null = closed, {} = new, item = edit
  const [selectedEquipment, setSelectedEq] = useState(null) // detail panel

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
    issues:     equipment.filter(e => ['Damaged','Needs Inspection','Maintenance','Lost'].includes(e.status)).length,
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
                    <button className={styles.equipNameBtn} onClick={() => setSelectedEq(item)}>
                      <strong>{item.name}</strong>
                    </button>
                    {item.equipment_notes && <div className={styles.tdMuted}>{item.equipment_notes}</div>}
                    {item.condition_notes && (
                      <div className={styles.conditionNoteInline}>⚠ {item.condition_notes}</div>
                    )}
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

      {/* Equipment detail panel */}
      {selectedEquipment && (
        <EquipmentDetailPanel
          item={selectedEquipment}
          manager={manager}
          pin={pin}
          onClose={() => setSelectedEq(null)}
          onResolved={() => { setSelectedEq(null); load() }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// EQUIPMENT DETAIL PANEL
// ─────────────────────────────────────────────────────────────────────────────
const NEEDS_RESOLVE = new Set(['Damaged', 'Needs Inspection', 'Maintenance'])

function EquipmentDetailPanel({ item, manager, pin, onClose, onResolved }) {
  const [tab, setTab]               = useState('info')   // 'info' | 'history'
  const [history, setHistory]       = useState([])
  const [histLoading, setHistLoad]  = useState(false)
  const [resolveStatus, setRStatus] = useState('Available')
  const [resolveNote, setRNote]     = useState(item.condition_notes ?? '')
  const [saving, setSaving]         = useState(false)

  useEffect(() => {
    if (tab === 'history') loadHistory()
  }, [tab])

  async function loadHistory() {
    setHistLoad(true)
    const { data } = await adminCall('equipment.getHistory', { equipmentId: item.id })
    if (data) setHistory(data)
    setHistLoad(false)
  }

  async function handleResolve() {
    setSaving(true)
    const { error } = await adminCall('equipment.resolve', {
      managerId: manager.id, pin,
      equipmentId: item.id,
      status: resolveStatus,
      conditionNotes: resolveNote || null,
    })
    setSaving(false)
    if (error) { alert('Error: ' + error); return }
    onResolved()
  }

  const needsResolve = NEEDS_RESOLVE.has(item.status)
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
  const fmtTime = d => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

  return (
    <div className={styles.detailOverlay} onClick={onClose}>
      <div className={styles.detailPanel} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.detailHeader}>
          <div>
            <div className={styles.detailName}>{item.name}</div>
            <div className={styles.detailMeta}>{item.category}{item.serial_number ? ` · S/N: ${item.serial_number}` : ''}{item.asset_id ? ` · Asset: ${item.asset_id}` : ''}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusBadge status={item.status} />
            <button className={styles.detailClose} onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className={styles.subTabRow}>
          <button className={`${styles.subTab} ${tab === 'info' ? styles.subTabActive : ''}`} onClick={() => setTab('info')}>Info & Condition</button>
          <button className={`${styles.subTab} ${tab === 'history' ? styles.subTabActive : ''}`} onClick={() => setTab('history')}>Checkout History</button>
        </div>

        {/* Info tab */}
        {tab === 'info' && (
          <div className={styles.detailBody}>
            {/* Current condition notes */}
            {item.condition_notes ? (
              <div className={styles.conditionBox}>
                <div className={styles.conditionBoxLabel}>Last condition note</div>
                <div className={styles.conditionBoxText}>{item.condition_notes}</div>
                {item.condition_updated_at && (
                  <div className={styles.conditionBoxMeta}>
                    Updated {fmtDate(item.condition_updated_at)}{item.condition_updated_by ? ` by ${item.condition_updated_by}` : ''}
                  </div>
                )}
              </div>
            ) : (
              <div className={styles.conditionBoxEmpty}>No condition notes on file.</div>
            )}

            {/* Quick info */}
            <div className={styles.infoGrid}>
              <div><span className={styles.infoLabel}>Location</span><span>{item.storage_location || '—'}</span></div>
              <div><span className={styles.infoLabel}>NFC UID</span><span className={styles.tdMono}>{item.nfc_uid || '—'}</span></div>
              <div><span className={styles.infoLabel}>Replacement cost</span><span>{item.replacement_cost ? `$${Number(item.replacement_cost).toFixed(0)}` : '—'}</span></div>
              {item.equipment_notes && <div className={styles.fullSpan}><span className={styles.infoLabel}>Notes</span><span>{item.equipment_notes}</span></div>}
            </div>

            {/* Resolve section */}
            {needsResolve && (
              <div className={styles.resolveSection}>
                <div className={styles.resolveSectionTitle}>⚙ Resolve condition</div>
                <div className={styles.resolveRow}>
                  <div className={styles.formField} style={{ flex: 1 }}>
                    <label className={styles.formLabel}>Set status to</label>
                    <select className={styles.formSelect} value={resolveStatus} onChange={e => setRStatus(e.target.value)}>
                      <option value="Available">✓ Available — clear to check out</option>
                      <option value="Maintenance">Maintenance — hold, needs repair</option>
                      <option value="Damaged">Damaged — document only</option>
                      <option value="Retired">Retired — remove from circulation</option>
                    </select>
                  </div>
                </div>
                <div className={styles.formField}>
                  <label className={styles.formLabel}>Resolution note</label>
                  <textarea className={styles.formTextarea} rows={2}
                    value={resolveNote} onChange={e => setRNote(e.target.value)}
                    placeholder="e.g. Lens replaced, camera tested and working" />
                </div>
                <button className={styles.primaryBtn} disabled={saving} onClick={handleResolve}>
                  {saving ? 'Saving…' : 'Save resolution'}
                </button>
              </div>
            )}

            {/* If not in issue state, still allow adding a note */}
            {!needsResolve && (
              <div className={styles.resolveSection} style={{ background: 'none', border: 'none', paddingTop: 0 }}>
                <div className={styles.formField}>
                  <label className={styles.formLabel}>Update condition note</label>
                  <textarea className={styles.formTextarea} rows={2}
                    value={resolveNote} onChange={e => setRNote(e.target.value)}
                    placeholder="Optional note about current condition" />
                </div>
                <button className={styles.secondaryBtn} disabled={saving} onClick={handleResolve}>
                  {saving ? 'Saving…' : 'Save note'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* History tab */}
        {tab === 'history' && (
          <div className={styles.detailBody}>
            {histLoading ? (
              <div className={styles.emptyState}><p className={styles.emptyTitle}>Loading…</p></div>
            ) : history.length === 0 ? (
              <div className={styles.emptyState}><p className={styles.emptyTitle}>No checkout history yet.</p></div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Checked out</th>
                    <th>Returned</th>
                    <th>Condition out</th>
                    <th>Condition in</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(h => {
                    const hasIssue = h.condition_in && h.condition_in !== 'returned_ok'
                    return (
                      <tr key={h.id} className={hasIssue ? styles.issueRow : ''}>
                        <td><strong>{h.cm_students?.name ?? '—'}</strong></td>
                        <td className={styles.tdMuted}>{fmtTime(h.checked_out_at)}</td>
                        <td className={styles.tdMuted}>{h.checked_in_at ? fmtTime(h.checked_in_at) : <span className={styles.issueTag}>Still out</span>}</td>
                        <td className={styles.tdMuted}>{CONDITION_OUT_LABELS[h.condition_out] ?? h.condition_out ?? '—'}</td>
                        <td>{h.condition_in ? (
                          <span className={hasIssue ? styles.issueTag : ''}>
                            {CONDITION_IN_LABELS[h.condition_in] ?? h.condition_in}
                          </span>
                        ) : '—'}</td>
                        <td className={styles.tdMuted}>{h.condition_notes || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
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
  const [subTab, setSubTab]                 = useState('active') // 'active' | 'history' | 'issues'
  const [checkouts, setCheckouts]           = useState([])
  const [history, setHistory]               = useState([])
  const [loading, setLoading]               = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
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

    if (!data) { setLoading(false); return }

    // Generate fresh signed URLs for student photos.
    // cm_open_checkouts.student_photo_url is the stored value in cm_students
    // (stale or null). Regenerate the same way as student.list in checkmate-admin.
    const photoIds = [...new Set(
      data.filter(c => c.student_photo_available && c.student_id).map(c => c.student_id)
    )]

    const urlMap = new Map()
    if (photoIds.length > 0) {
      const { data: students } = await supabase
        .from('cm_students')
        .select('id, photo_file')
        .in('id', photoIds)

      await Promise.all((students || []).map(async (s) => {
        if (!s.photo_file) return
        const { data: sig1 } = await supabase.storage
          .from('lifetouch-raw').createSignedUrl(s.photo_file, 3600)
        if (sig1?.signedUrl) { urlMap.set(s.id, sig1.signedUrl); return }
        const { data: sig2 } = await supabase.storage
          .from('student-photos').createSignedUrl(s.photo_file, 3600)
        if (sig2?.signedUrl) urlMap.set(s.id, sig2.signedUrl)
      }))
    }

    setCheckouts(data.map(c =>
      urlMap.has(c.student_id) ? { ...c, student_photo_url: urlMap.get(c.student_id) } : c
    ))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh active tab every 30 s
  useEffect(() => {
    const id = setInterval(() => { if (subTab === 'active') load() }, 30000)
    return () => clearInterval(id)
  }, [load, subTab])

  const loadHistory = useCallback(async (issuesOnly = false) => {
    setHistoryLoading(true)
    const { data } = await adminCall('checkout.listHistory', {
      managerId: manager.id, pin, issuesOnly, limit: 200,
    })
    const rows = data || []

    // Generate fresh signed URLs for student photos in history rows
    const photoFileMap = new Map()
    rows.forEach(r => {
      if (r.cm_students?.id && r.cm_students?.photo_file && !photoFileMap.has(r.cm_students.id)) {
        photoFileMap.set(r.cm_students.id, r.cm_students.photo_file)
      }
    })
    const photoUrlMap = new Map()
    await Promise.all([...photoFileMap.entries()].map(async ([id, file]) => {
      const { data: s1 } = await supabase.storage.from('lifetouch-raw').createSignedUrl(file, 3600)
      if (s1?.signedUrl) { photoUrlMap.set(id, s1.signedUrl); return }
      const { data: s2 } = await supabase.storage.from('student-photos').createSignedUrl(file, 3600)
      if (s2?.signedUrl) photoUrlMap.set(id, s2.signedUrl)
    }))

    setHistory(rows.map(r =>
      r.cm_students && photoUrlMap.has(r.cm_students.id)
        ? { ...r, cm_students: { ...r.cm_students, photo_url: photoUrlMap.get(r.cm_students.id), photo_available: true } }
        : r
    ))
    setHistoryLoading(false)
  }, [manager, pin])

  // Load history when switching to those tabs
  useEffect(() => {
    if (subTab === 'history') loadHistory(false)
    if (subTab === 'issues')  loadHistory(true)
  }, [subTab, loadHistory])

  const now = new Date()

  const filtered = useMemo(() => {
    const source = subTab === 'active' ? checkouts : history
    if (!search) return source
    const q = search.toLowerCase()
    return source.filter(c => {
      // history rows use nested objects; active rows use flat columns
      const sName = c.student_name ?? c.cm_students?.name ?? ''
      const eName = c.equipment_name ?? c.cm_equipment?.name ?? ''
      const mName = c.manager_name ?? c.cm_managers?.name ?? ''
      return sName.toLowerCase().includes(q) ||
             eName.toLowerCase().includes(q) ||
             mName.toLowerCase().includes(q)
    })
  }, [checkouts, history, search, subTab])

  const stats = useMemo(() => {
    const now2 = new Date()
    return {
      total:   checkouts.length,
      overdue: checkouts.filter(c => c.due_at && new Date(c.due_at) < now2).length,
      issues:  history.filter(c => CONDITION_IN_ISSUE.has(c.condition_in)).length,
    }
  }, [checkouts, history])

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
      {/* Stats */}
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
        <div className={styles.statCard}>
          <div className={styles.statNum} style={{ color: stats.issues > 0 ? '#dc2626' : '#A8ABB8' }}>
            {stats.issues}
          </div>
          <div className={styles.statLabel}>Returned w/ issue</div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className={styles.subTabRow}>
        {[
          { key: 'active',  label: 'Active' },
          { key: 'history', label: 'History' },
          { key: 'issues',  label: '⚠ Issues' },
        ].map(t => (
          <button key={t.key}
            className={`${styles.subTab} ${subTab === t.key ? styles.subTabActive : ''}`}
            onClick={() => { setSubTab(t.key); setSearch('') }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <input className={styles.searchInput}
          placeholder={`Search ${subTab === 'active' ? 'active' : 'returned'} checkouts…`}
          value={search} onChange={e => setSearch(e.target.value)} />
        <button className={styles.secondaryBtn}
          onClick={() => subTab === 'active' ? load() : loadHistory(subTab === 'issues')}>
          ↻ Refresh
        </button>
      </div>

      {/* Active checkouts table */}
      {subTab === 'active' && (loading ? (
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
                  <tr key={c.id} className={styles.clickableRow} onClick={() => openDetail(c)}>
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
      ))}

      {/* History / Issues table */}
      {(subTab === 'history' || subTab === 'issues') && (historyLoading ? (
        <div className={styles.emptyState}><span className={styles.emptyIcon}>⏳</span><p className={styles.emptyTitle}>Loading…</p></div>
      ) : filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>{subTab === 'issues' ? '✓' : '📋'}</span>
          <p className={styles.emptyTitle}>{search ? 'No matches' : subTab === 'issues' ? 'No issues on record' : 'No history yet'}</p>
        </div>
      ) : (
        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Student</th>
                <th>Equipment</th>
                <th>Checked out</th>
                <th>Returned</th>
                <th>Condition in</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const sName = c.student_name ?? c.cm_students?.name ?? '—'
                const sClass = c.class_group ?? c.cm_students?.class_group ?? ''
                const eName = c.equipment_name ?? c.cm_equipment?.name ?? '—'
                const eCat  = c.equipment_category ?? c.cm_equipment?.category ?? ''
                const hasIssue = CONDITION_IN_ISSUE.has(c.condition_in)
                return (
                  <tr key={c.id} className={styles.clickableRow}
                    onClick={() => setSelectedCheckout({ ...c, _isHistory: true })}>
                    <td>
                      <div className={styles.studentCell}>
                        <Avatar name={sName} photoUrl={c.cm_students?.photo_url} photoAvailable={!!c.cm_students?.photo_url} />
                        <div>
                          <div><strong>{sName}</strong></div>
                          {sClass && <div className={styles.tdMuted}>{sClass}</div>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <strong>{eName}</strong>
                      <div className={styles.tdMuted}>{eCat}</div>
                    </td>
                    <td className={styles.tdMuted}>{formatDate(c.checked_out_at)}</td>
                    <td className={styles.tdMuted}>{formatDate(c.checked_in_at)}</td>
                    <td>
                      {hasIssue
                        ? <span className={styles.issueTag}>{CONDITION_IN_LABELS[c.condition_in] ?? c.condition_in}</span>
                        : <span className={styles.tdMuted}>{CONDITION_IN_LABELS[c.condition_in] ?? '—'}</span>}
                    </td>
                    <td className={styles.tdMuted}>{c.condition_notes || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}

      {/* ── Detail panel (active overdue / history) ────────────────────── */}
      {selectedCheckout && (
        <div className={styles.modalOverlay} onClick={() => setSelectedCheckout(null)}>
          <div className={styles.overduePanel} onClick={e => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setSelectedCheckout(null)}>✕</button>

            {/* Header */}
            {(() => {
              const isHistory = selectedCheckout._isHistory
              const sName = selectedCheckout.student_name ?? selectedCheckout.cm_students?.name ?? '—'
              const eName = selectedCheckout.equipment_name ?? selectedCheckout.cm_equipment?.name ?? '—'
              const eCat  = selectedCheckout.equipment_category ?? selectedCheckout.cm_equipment?.category ?? ''
              const hasIssue = CONDITION_IN_ISSUE.has(selectedCheckout.condition_in)
              return (
                <>
                  <div className={styles.overduePanelHeader}>
                    <div className={styles.overduePanelIdentity}>
                      <Avatar
                        name={sName}
                        photoUrl={selectedCheckout.student_photo_url}
                        photoAvailable={selectedCheckout.student_photo_available}
                        size="lg"
                      />
                      <div>
                        <p className={styles.overduePanelLabel}>
                          {isHistory ? 'Return record' : 'Checkout detail'}
                        </p>
                        <h3 className={styles.overduePanelName}>{sName}</h3>
                        <p className={styles.overduePanelSub}>{eName} · {eCat}</p>
                      </div>
                    </div>
                    {isHistory
                      ? hasIssue
                        ? <span className={styles.overduePanelBadge}>{CONDITION_IN_LABELS[selectedCheckout.condition_in]}</span>
                        : <span className={styles.onTimePanelBadge}>✓ Returned OK</span>
                      : (() => {
                          const due = formatDue(selectedCheckout.due_at)
                          return due.overdue
                            ? <span className={styles.overduePanelBadge}>OVERDUE · {due.label}</span>
                            : <span className={styles.onTimePanelBadge}>{due.label}</span>
                        })()
                    }
                  </div>

                  {/* Meta */}
                  <div className={styles.overdueMeta}>
                    <div className={styles.overdueMetaItem}>
                      <span className={styles.overdueMetaLabel}>Checked out</span>
                      <span>{formatDate(selectedCheckout.checked_out_at)}</span>
                    </div>
                    {isHistory ? (
                      <div className={styles.overdueMetaItem}>
                        <span className={styles.overdueMetaLabel}>Returned</span>
                        <span>{formatDate(selectedCheckout.checked_in_at)}</span>
                      </div>
                    ) : (
                      <div className={styles.overdueMetaItem}>
                        <span className={styles.overdueMetaLabel}>Due</span>
                        <span>{formatDate(selectedCheckout.due_at)}</span>
                      </div>
                    )}
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
                    {selectedCheckout.condition_out && (
                      <div className={styles.overdueMetaItem}>
                        <span className={styles.overdueMetaLabel}>Condition at checkout</span>
                        <span>{CONDITION_OUT_LABELS[selectedCheckout.condition_out] ?? selectedCheckout.condition_out}</span>
                      </div>
                    )}
                    {isHistory && selectedCheckout.condition_in && (
                      <div className={styles.overdueMetaItem}>
                        <span className={styles.overdueMetaLabel}>Condition returned</span>
                        <span className={hasIssue ? styles.issueInline : undefined}>
                          {CONDITION_IN_LABELS[selectedCheckout.condition_in] ?? selectedCheckout.condition_in}
                        </span>
                      </div>
                    )}
                    {isHistory && selectedCheckout.condition_notes && (
                      <div className={styles.overdueMetaItem}>
                        <span className={styles.overdueMetaLabel}>Return notes</span>
                        <span>{selectedCheckout.condition_notes}</span>
                      </div>
                    )}
                  </div>
                </>
              )
            })()}

            {/* Quick actions — active checkouts only */}
            {!selectedCheckout._isHistory && (
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
            )}

            {/* Note form — active checkouts only */}
            {!selectedCheckout._isHistory && showNoteForm && (
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

            {/* Note timeline — active checkouts only */}
            {!selectedCheckout._isHistory && <div className={styles.noteTimeline}>
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
            </div>}
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// ADD STUDENT MODAL
// ═══════════════════════════════════════════════════════════════════════════
function AddStudentModal({ manager, pin, onSave, onClose }) {
  const [form, setForm] = useState({
    name: '', email: '', classGroup: '', nfcUid: '', formStatus: 'no_form',
  })
  const [grantTempPass, setGrantTempPass] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Tomorrow end-of-day for preview
  const tempExpires = (() => {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(23, 59, 0, 0)
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' at 11:59 PM'
  })()

  async function handleSave() {
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true); setError('')
    const { data, error: err } = await adminCall('student.addStudent', {
      managerId: manager.id, pin,
      name:        form.name,
      email:       form.email,
      classGroup:  form.classGroup,
      nfcUid:      form.nfcUid,
      formStatus:  grantTempPass ? 'temp_pass' : form.formStatus,
      grantTempPass,
    })
    setSaving(false)
    if (err) { setError(err); return }
    onSave(data)
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.modalClose} onClick={onClose}>✕</button>
        <h2 className={styles.modalTitle}>Add student</h2>

        <div className={styles.formGrid}>
          <div className={`${styles.formField} ${styles.fullWidth}`}>
            <label className={styles.formLabel}>Name *</label>
            <input className={styles.formInput} value={form.name} autoFocus
              onChange={e => set('name', e.target.value)} placeholder="First Last" />
          </div>
          <div className={styles.formField}>
            <label className={styles.formLabel}>Class / Grade</label>
            <input className={styles.formInput} value={form.classGroup}
              onChange={e => set('classGroup', e.target.value)} placeholder="e.g. Yearbook P2" />
          </div>
          <div className={styles.formField}>
            <label className={styles.formLabel}>Email</label>
            <input className={styles.formInput} value={form.email}
              onChange={e => set('email', e.target.value)} placeholder="student@rjusd.us" />
          </div>
          <div className={`${styles.formField} ${styles.fullWidth}`}>
            <label className={styles.formLabel}>NFC UID</label>
            <input className={styles.formInput} value={form.nfcUid}
              onChange={e => set('nfcUid', e.target.value)}
              placeholder="Scan a card or enter the UID — leave blank if no card yet" />
            <span style={{ fontSize: 10, color: '#A8ABB8', marginTop: 3 }}>
              If no card yet, leave blank. Add the UID after issuing one — checkout won't work until it's assigned.
            </span>
          </div>
          <div className={styles.formField}>
            <label className={styles.formLabel}>Form status</label>
            <select className={styles.formSelect} value={form.formStatus}
              onChange={e => { set('formStatus', e.target.value); if (e.target.value === 'temp_pass') setGrantTempPass(true) }}
              disabled={grantTempPass}>
              {FORM_STATUSES.filter(f => f.value !== 'temp_pass').map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 1-day temp pass toggle */}
        <div className={styles.tempPassToggle}>
          <label className={styles.tempPassLabel}>
            <input type="checkbox" checked={grantTempPass}
              onChange={e => setGrantTempPass(e.target.checked)} />
            <span>Grant 1-day temp pass</span>
          </label>
          {grantTempPass && (
            <div className={styles.tempPassInfo}>
              ⏰ Student can check out equipment immediately. Pass expires <strong>{tempExpires}</strong>.
              Guardian form required before next checkout.
            </div>
          )}
          {!grantTempPass && (
            <span className={styles.tempPassHint}>
              Student needs to check out today but hasn't returned the form yet? Enable this.
            </span>
          )}
        </div>

        {error && <p style={{ fontSize: 12, color: '#dc2626', margin: 0 }}>{error}</p>}

        <div className={styles.modalActions}>
          <button className={styles.secondaryBtn} onClick={onClose}>Cancel</button>
          <button className={styles.primaryBtn} onClick={handleSave}
            disabled={saving || !form.name.trim()}>
            {saving ? 'Adding…' : 'Add student'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// STUDENTS TAB
// ═══════════════════════════════════════════════════════════════════════════
function StudentsTab({ manager, pin }) {
  const [students, setStudents]         = useState([])
  const [loading, setLoading]           = useState(true)
  const [search, setSearch]             = useState('')
  const [syncing, setSyncing]           = useState(false)
  const [syncingPassable, setSyncingPassable] = useState(false)
  const [syncMsg, setSyncMsg]           = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [noteText, setNoteText]         = useState('')
  const [emailText, setEmailText]       = useState('')
  const [noteSaving, setNoteSaving]     = useState(false)

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
    noForm:     students.filter(s => ['no_form', 'pending'].includes(s.equipment_form_status)).length,
    tempPass:   students.filter(s => s.equipment_form_status === 'temp_pass').length,
    restricted: students.filter(s => s.equipment_form_status === 'restricted').length,
  }), [students])

  async function handleFormStatus(studentId, formStatus) {
    await adminCall('student.setFormStatus', { managerId: manager.id, pin, studentId, formStatus })
    setStudents(prev => prev.map(s =>
      s.id === studentId ? { ...s, equipment_form_status: formStatus } : s
    ))
  }

  async function handleGrantTempPass(studentId) {
    const { ok, expiresAt, error } = await adminCall('student.grantTempPass', { managerId: manager.id, pin, studentId })
    if (error) { alert('Failed: ' + error); return }
    setStudents(prev => prev.map(s =>
      s.id === studentId
        ? { ...s, equipment_form_status: 'temp_pass', temp_access_expires_at: expiresAt }
        : s
    ))
  }

  async function handleSyncAllPhotos() {
    setSyncing(true); setSyncMsg('')
    const { ok, synced, error } = await adminCall('student.syncAllPhotos', { managerId: manager.id, pin })
    setSyncing(false)
    if (error) { setSyncMsg('Photo sync failed: ' + error); return }
    setSyncMsg(`✓ Synced ${synced} photos from PassAble`)
    load()
  }

  async function handleSyncFromPassable() {
    setSyncingPassable(true); setSyncMsg('')
    const { ok, added, updated, restricted, error } = await adminCall('student.syncFromPassAble', { managerId: manager.id, pin })
    setSyncingPassable(false)
    if (error) { setSyncMsg('Sync failed: ' + error); return }
    const parts = [`${added} added`, `${updated} updated`]
    if (restricted > 0) parts.push(`${restricted} restricted (removed from PassAble)`)
    setSyncMsg(`✓ ${parts.join(', ')}`)
    load()
  }

  function openStudentDetail(s) {
    setSelectedStudent(s)
    setNoteText(s.notes ?? '')
    setEmailText(s.email ?? '')
  }

  async function handleSaveChanges() {
    if (!selectedStudent || noteSaving) return
    setNoteSaving(true)
    const { ok, error } = await adminCall('student.update', {
      managerId: manager.id, pin,
      studentId: selectedStudent.id,
      email: emailText,
      notes: noteText,
    })
    if (error) { alert('Failed: ' + error); setNoteSaving(false); return }
    const updated = { ...selectedStudent, notes: noteText.trim() || null, email: emailText.trim() || null }
    setStudents(prev => prev.map(s => s.id === selectedStudent.id ? updated : s))
    setSelectedStudent(updated)
    setNoteSaving(false)
  }

  function handleStudentAdded(newStudent) {
    setShowAddModal(false)
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
          <div className={styles.statNum} style={{ color: '#B45309' }}>{formStats.tempPass}</div>
          <div className={styles.statLabel}>Temp pass</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statNum} style={{ color: '#dc2626' }}>{formStats.restricted}</div>
          <div className={styles.statLabel}>Restricted</div>
        </div>
      </div>

      {/* Sync banners */}
      <div className={styles.syncBanner}>
        <span>🎒 Sync all students from PassAble at the start of each year.</span>
        <button className={styles.secondaryBtn} onClick={handleSyncFromPassable} disabled={syncingPassable}>
          {syncingPassable ? 'Syncing…' : 'Sync students from PassAble'}
        </button>
      </div>
      <div className={styles.syncBanner} style={{ marginTop: 8 }}>
        <span>📸 Student photos sync from PassAble Lifetouch records.</span>
        <button className={styles.secondaryBtn} onClick={handleSyncAllPhotos} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync all photos'}
        </button>
      </div>
      {syncMsg && <p style={{ fontSize: 12, color: '#166534', margin: '8px 0 0' }}>{syncMsg}</p>}

      {/* Toolbar */}
      <div className={styles.toolbar} style={{ marginTop: 14 }}>
        <input className={styles.searchInput} placeholder="Search students…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <button className={styles.primaryBtn} onClick={() => setShowAddModal(true)}>
          + Add student
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className={styles.emptyState}><span className={styles.emptyIcon}>⏳</span><p className={styles.emptyTitle}>Loading…</p></div>
      ) : filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>🎒</span>
          <p className={styles.emptyTitle}>{search ? 'No matches' : 'No students yet'}</p>
          <p className={styles.emptyHint}>{search ? 'Try a different search.' : 'Sync from PassAble or add students manually.'}</p>
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
              {filtered.map(s => {
                const tempInfo = s.equipment_form_status === 'temp_pass'
                  ? formatTempExpiry(s.temp_access_expires_at) : null
                return (
                  <tr key={s.id} className={styles.clickableRow} onClick={() => openStudentDetail(s)}>
                    <td>
                      <div className={styles.studentCell}>
                        <Avatar name={s.name} photoUrl={s.photo_url} photoAvailable={s.photo_available} />
                        <div>
                          <strong>{s.name}</strong>
                          {s.notes && <div className={styles.studentNoteSnippet}>📌 {s.notes}</div>}
                        </div>
                      </div>
                    </td>
                    <td className={styles.tdMuted}>{s.class_group || '—'}</td>
                    <td className={styles.tdMuted}>{s.email || '—'}</td>
                    <td className={styles.tdMono}>{s.nfc_uid || <span className={styles.tdMuted}>—</span>}</td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <select className={styles.inlineSelect}
                          value={s.equipment_form_status ?? 'no_form'}
                          onChange={e => handleFormStatus(s.id, e.target.value)}>
                          {FORM_STATUSES.map(f => (
                            <option key={f.value} value={f.value}>{f.label}</option>
                          ))}
                        </select>
                        {tempInfo && (
                          <span className={tempInfo.overdue ? styles.tempExpiredTag : styles.tempActiveTag}>
                            ⏰ {tempInfo.label}
                          </span>
                        )}
                        {['no_form', 'pending'].includes(s.equipment_form_status) && (
                          <button className={styles.grantPassBtn}
                            onClick={() => handleGrantTempPass(s.id)}>
                            Grant 1-day pass
                          </button>
                        )}
                      </div>
                    </td>
                    <td>
                      {s.photo_available
                        ? <span style={{ fontSize: 11, color: '#166534' }}>✓ Synced</span>
                        : <span style={{ fontSize: 11, color: '#A8ABB8' }}>—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAddModal && (
        <AddStudentModal
          manager={manager} pin={pin}
          onSave={handleStudentAdded}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* Student detail panel */}
      {selectedStudent && (
        <div className={styles.detailOverlay} onClick={() => setSelectedStudent(null)}>
          <div className={styles.detailPanel} onClick={e => e.stopPropagation()}>
            <div className={styles.detailHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar name={selectedStudent.name} photoUrl={selectedStudent.photo_url} photoAvailable={selectedStudent.photo_available} size="lg" />
                <div>
                  <div className={styles.detailName}>{selectedStudent.name}</div>
                  <div className={styles.detailMeta}>
                    {selectedStudent.class_group || '—'}
                    {selectedStudent.email ? ` · ${selectedStudent.email}` : ''}
                  </div>
                </div>
              </div>
              <button className={styles.detailClose} onClick={() => setSelectedStudent(null)}>✕</button>
            </div>
            <div className={styles.detailBody}>
              <div className={styles.infoGrid}>
                <div>
                  <span className={styles.infoLabel}>NFC UID</span>
                  <span className={styles.tdMono}>{selectedStudent.nfc_uid || '—'}</span>
                </div>
                <div>
                  <span className={styles.infoLabel}>Equipment form</span>
                  <select className={styles.inlineSelect}
                    value={selectedStudent.equipment_form_status ?? 'no_form'}
                    onChange={e => {
                      handleFormStatus(selectedStudent.id, e.target.value)
                      setSelectedStudent(prev => ({ ...prev, equipment_form_status: e.target.value }))
                    }}>
                    {FORM_STATUSES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>
                <div>
                  <span className={styles.infoLabel}>Last synced</span>
                  <span>{selectedStudent.last_synced_at ? formatDate(selectedStudent.last_synced_at) : '—'}</span>
                </div>
                <div>
                  <span className={styles.infoLabel}>Photo</span>
                  <span>{selectedStudent.photo_available ? '✓ Synced' : '—'}</span>
                </div>
                <div className={styles.fullSpan}>
                  <span className={styles.infoLabel}>Email</span>
                  <input
                    type="email"
                    className={styles.inlineEditInput}
                    value={emailText}
                    onChange={e => setEmailText(e.target.value)}
                    placeholder="student@rjusd.org"
                  />
                </div>
              </div>

              <div style={{ marginTop: 20 }}>
                <div className={styles.resolveSectionTitle}>Manager Note</div>
                <textarea
                  className={styles.noteTextarea}
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  placeholder="Add a note about this student…"
                  rows={3}
                />
                <div className={styles.resolveRow} style={{ marginTop: 10 }}>
                  <button className={styles.primaryBtn} onClick={handleSaveChanges} disabled={noteSaving}>
                    {noteSaving ? 'Saving…' : 'Save changes'}
                  </button>
                  {(noteText.trim() !== (selectedStudent.notes ?? '') ||
                    emailText.trim() !== (selectedStudent.email ?? '')) && (
                    <span style={{ fontSize: 11, color: '#A8ABB8' }}>Unsaved changes</span>
                  )}
                </div>
              </div>
            </div>
          </div>
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
// REPORTS TAB
// ═══════════════════════════════════════════════════════════════════════════

// ── CSV helper ────────────────────────────────────────────────────────────
function downloadCSV(filename, rows) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const escape = v => {
    if (v == null) return ''
    const s = String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ── Print helper — opens a new window with formatted HTML ─────────────────
function openPrintWindow(title, bodyHtml) {
  const w = window.open('', '_blank', 'width=900,height=700')
  w.document.write(`<!DOCTYPE html><html><head>
<title>${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 11px; color: #111; padding: 24px; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .subtitle { color: #666; font-size: 11px; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th { background: #f3f4f6; text-align: left; padding: 6px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #555; border-bottom: 2px solid #d1d5db; }
  td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .badge { display: inline-block; padding: 2px 7px; border-radius: 999px; font-size: 10px; font-weight: 600; }
  .badge-red { background: #fee2e2; color: #991b1b; }
  .badge-yellow { background: #fef3c7; color: #92400e; }
  .badge-green { background: #d1fae5; color: #065f46; }
  .badge-gray { background: #f3f4f6; color: #374151; }
  .section-title { font-size: 13px; font-weight: 700; margin: 18px 0 6px; color: #1f2937; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  .overdue { background: #fff7ed; }
  @media print {
    body { padding: 0; }
    button { display: none !important; }
  }
</style>
</head><body>
${bodyHtml}
<div style="margin-top:20px">
  <button onclick="window.print()" style="padding:8px 18px;background:#7C5CFF;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer;">🖨 Print</button>
</div>
</body></html>`)
  w.document.close()
}

function ReportsTab({ manager, pin }) {
  const [reportData, setReportData]   = useState(null)
  const [loading, setLoading]         = useState(false)
  const [activeReport, setActiveReport] = useState(null)
  const [dateFrom, setDateFrom]       = useState('')
  const [dateTo, setDateTo]           = useState('')

  const fmtDT = d => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
  const fmtD  = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
  const now   = () => new Date().toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

  // ── Load checkout history ─────────────────────────────────────────────────
  async function loadCheckoutReport() {
    setLoading(true); setActiveReport('checkout')
    const { data } = await adminCall('checkout.listHistory', { limit: 500 })
    setReportData(data ?? [])
    setLoading(false)
  }

  // ── Load equipment list ────────────────────────────────────────────────────
  async function loadEquipmentReport() {
    setLoading(true); setActiveReport('equipment')
    const { data: eq }  = await adminCall('equipment.list')
    const { data: co }  = await supabase
      .from('cm_checkouts')
      .select('equipment_id, due_at, cm_students!student_id(name)')
      .is('checked_in_at', null)
    // Attach current checkout info to each item
    const outMap = new Map((co ?? []).map(c => [c.equipment_id, c]))
    const enriched = (eq ?? []).map(e => ({ ...e, _checkout: outMap.get(e.id) ?? null }))
    setReportData(enriched)
    setLoading(false)
    return enriched
  }

  // ── Load overdue ──────────────────────────────────────────────────────────
  async function loadOverdueReport() {
    setLoading(true); setActiveReport('overdue')
    const now = new Date().toISOString()
    const { data } = await supabase
      .from('cm_checkouts')
      .select(`
        id, checked_out_at, due_at, reason, teacher_name, approved_by,
        cm_students!student_id(id, name, email, class_group),
        cm_equipment!equipment_id(name, category),
        cm_managers!manager_id(name)
      `)
      .is('checked_in_at', null)
      .lt('due_at', now)
      .order('due_at', { ascending: true })
    const rows = data ?? []
    setReportData(rows)
    setLoading(false)
    return rows
  }

  // ── Print: Checkout report ─────────────────────────────────────────────────
  function printCheckoutReport() {
    if (!reportData) return
    let filtered = reportData
    if (dateFrom) filtered = filtered.filter(r => new Date(r.checked_out_at) >= new Date(dateFrom))
    if (dateTo)   filtered = filtered.filter(r => new Date(r.checked_out_at) <= new Date(dateTo + 'T23:59:59'))

    const rows = filtered.map(r => `<tr>
      <td>${r.cm_students?.name ?? '—'}</td>
      <td>${r.cm_equipment?.name ?? '—'}<br/><span style="color:#888;font-size:10px">${r.cm_equipment?.category ?? ''}</span></td>
      <td>${fmtDT(r.checked_out_at)}</td>
      <td>${fmtDT(r.checked_in_at)}</td>
      <td>${fmtD(r.due_at)}</td>
      <td>${r.reason ?? '—'}</td>
      <td>${r.cm_managers?.name ?? '—'}</td>
      ${r.condition_in && r.condition_in !== 'returned_ok'
        ? `<td><span class="badge badge-red">${CONDITION_IN_LABELS[r.condition_in] ?? r.condition_in}</span></td>`
        : `<td><span style="color:#888">—</span></td>`}
    </tr>`).join('')

    openPrintWindow('CheckMate — Checkout History', `
      <h1>Checkout History Report</h1>
      <div class="subtitle">RHS Media Department · Generated ${now()} · ${filtered.length} records</div>
      <table>
        <thead><tr><th>Student</th><th>Equipment</th><th>Checked Out</th><th>Returned</th><th>Due</th><th>Reason</th><th>Manager</th><th>Return Condition</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`)
  }

  // ── CSV: Checkout report ───────────────────────────────────────────────────
  function exportCheckoutCSV() {
    if (!reportData) return
    let filtered = reportData
    if (dateFrom) filtered = filtered.filter(r => new Date(r.checked_out_at) >= new Date(dateFrom))
    if (dateTo)   filtered = filtered.filter(r => new Date(r.checked_out_at) <= new Date(dateTo + 'T23:59:59'))

    downloadCSV(`checkmate-checkouts-${new Date().toISOString().slice(0,10)}.csv`, filtered.map(r => ({
      Student:          r.cm_students?.name ?? '',
      Class:            r.cm_students?.class_group ?? '',
      Equipment:        r.cm_equipment?.name ?? '',
      Category:         r.cm_equipment?.category ?? '',
      'Checked Out':    r.checked_out_at ? new Date(r.checked_out_at).toLocaleString() : '',
      'Returned':       r.checked_in_at  ? new Date(r.checked_in_at).toLocaleString()  : '',
      'Due':            r.due_at         ? new Date(r.due_at).toLocaleDateString()      : '',
      Reason:           r.reason ?? '',
      Teacher:          r.teacher_name ?? '',
      'Approved By':    r.approved_by ?? '',
      Manager:          r.cm_managers?.name ?? '',
      'Condition Out':  CONDITION_OUT_LABELS[r.condition_out] ?? r.condition_out ?? '',
      'Condition In':   CONDITION_IN_LABELS[r.condition_in]   ?? r.condition_in  ?? '',
      'Condition Notes': r.condition_notes ?? '',
    })))
  }

  // ── Print: Equipment status ────────────────────────────────────────────────
  function printEquipmentReport(passedData) {
    const items = passedData ?? reportData
    if (!items) return
    const categories = [...new Set(items.map(e => e.category))].sort()
    const sections = categories.map(cat => {
      const catItems = items.filter(e => e.category === cat)
      const rows = catItems.map(e => {
        const co = e._checkout
        const isOut = e.status === 'Checked Out'
        const hasIssue = ['Damaged','Needs Inspection','Maintenance'].includes(e.status)
        const badge = isOut
          ? `<span class="badge badge-yellow">Out</span>`
          : hasIssue
            ? `<span class="badge badge-red">${e.status}</span>`
            : `<span class="badge badge-green">Available</span>`
        return `<tr${hasIssue ? ' class="overdue"' : ''}>
          <td><strong>${e.name}</strong>${e.serial_number ? `<br/><span style="color:#888;font-size:10px">S/N: ${e.serial_number}</span>` : ''}</td>
          <td>${badge}</td>
          <td>${isOut && co ? co.cm_students?.name ?? '—' : '—'}</td>
          <td>${isOut && co ? fmtD(co.due_at) : '—'}</td>
          <td>${e.condition_notes ?? '—'}</td>
          <td style="color:#888;font-size:10px">${e.nfc_uid ?? '—'}</td>
        </tr>`
      }).join('')
      return `<div class="section-title">${cat} (${catItems.length})</div>
        <table>
          <thead><tr><th>Name / Serial</th><th>Status</th><th>Checked Out To</th><th>Due</th><th>Condition Notes</th><th>NFC UID</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
    }).join('')

    openPrintWindow('CheckMate — Equipment Status', `
      <h1>Equipment Status Report</h1>
      <div class="subtitle">RHS Media Department · Generated ${now()} · ${items.length} items</div>
      ${sections}`)
  }

  // ── Print: Overdue report ──────────────────────────────────────────────────
  function printOverdueReport(passedData) {
    const overdueItems = passedData ?? reportData
    if (!overdueItems) return
    const rows = overdueItems.map(r => {
      const daysOverdue = Math.floor((Date.now() - new Date(r.due_at)) / 86400000)
      return `<tr class="overdue">
        <td><strong>${r.cm_students?.name ?? '—'}</strong><br/>
          <span style="color:#888;font-size:10px">${r.cm_students?.class_group ?? ''}</span></td>
        <td>${r.cm_equipment?.name ?? '—'}<br/>
          <span style="color:#888;font-size:10px">${r.cm_equipment?.category ?? ''}</span></td>
        <td>${fmtD(r.due_at)}</td>
        <td><span class="badge badge-red">${daysOverdue}d overdue</span></td>
        <td>${r.reason ?? '—'}</td>
        <td>${r.teacher_name ?? '—'}</td>
        <td>${r.approved_by ?? '—'}</td>
      </tr>`
    }).join('')

    openPrintWindow('CheckMate — Overdue Report', `
      <h1>Overdue Checkouts Report</h1>
      <div class="subtitle">RHS Media Department · Generated ${now()} · ${overdueItems.length} overdue item${overdueItems.length !== 1 ? 's' : ''}</div>
      <table>
        <thead><tr><th>Student</th><th>Equipment</th><th>Was Due</th><th>Days Overdue</th><th>Reason</th><th>Teacher</th><th>Approved By</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`)
  }

  return (
    <div className={styles.content}>
      <div className={styles.reportsGrid}>

        {/* ── Checkout History ──────────────────────────────────────── */}
        <div className={styles.reportCard}>
          <div className={styles.reportCardHeader}>
            <div className={styles.reportCardIcon}>📋</div>
            <div>
              <div className={styles.reportCardTitle}>Checkout History</div>
              <div className={styles.reportCardDesc}>All returned checkouts with condition records</div>
            </div>
          </div>
          <div className={styles.reportFilters}>
            <label className={styles.reportFilterLabel}>From</label>
            <input type="date" className={styles.reportDateInput} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            <label className={styles.reportFilterLabel}>To</label>
            <input type="date" className={styles.reportDateInput} value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          <div className={styles.reportCardActions}>
            <button className={styles.primaryBtn}
              onClick={async () => { if (activeReport !== 'checkout' || !reportData) await loadCheckoutReport(); else printCheckoutReport() }}
              disabled={loading && activeReport === 'checkout'}>
              {loading && activeReport === 'checkout' ? 'Loading…' : activeReport === 'checkout' && reportData ? '🖨 Print report' : 'Load report'}
            </button>
            {activeReport === 'checkout' && reportData && (
              <button className={styles.secondaryBtn} onClick={exportCheckoutCSV}>⬇ Export CSV</button>
            )}
            {activeReport === 'checkout' && reportData && (
              <span className={styles.reportCount}>{reportData.length} records loaded</span>
            )}
          </div>
        </div>

        {/* ── Equipment Status ──────────────────────────────────────── */}
        <div className={styles.reportCard}>
          <div className={styles.reportCardHeader}>
            <div className={styles.reportCardIcon}>📷</div>
            <div>
              <div className={styles.reportCardTitle}>Equipment Status Sheet</div>
              <div className={styles.reportCardDesc}>All equipment grouped by category with current status</div>
            </div>
          </div>
          <div className={styles.reportCardActions} style={{ marginTop: 32 }}>
            <button className={styles.primaryBtn}
              onClick={async () => { const d = await loadEquipmentReport(); printEquipmentReport(d) }}
              disabled={loading && activeReport === 'equipment'}>
              {loading && activeReport === 'equipment' ? 'Loading…' : '🖨 Print report'}
            </button>
          </div>
        </div>

        {/* ── Overdue Report ────────────────────────────────────────── */}
        <div className={styles.reportCard}>
          <div className={styles.reportCardHeader}>
            <div className={styles.reportCardIcon}>⚠</div>
            <div>
              <div className={styles.reportCardTitle}>Overdue Report</div>
              <div className={styles.reportCardDesc}>All past-due checkouts with student and teacher info</div>
            </div>
          </div>
          <div className={styles.reportCardActions} style={{ marginTop: 32 }}>
            <button className={styles.primaryBtn}
              onClick={async () => { const d = await loadOverdueReport(); printOverdueReport(d) }}
              disabled={loading && activeReport === 'overdue'}>
              {loading && activeReport === 'overdue' ? 'Loading…' : '🖨 Print report'}
            </button>
          </div>
        </div>

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
              <button
                className={`${styles.tab} ${tab === 'reports' ? styles.tabActive : ''}`}
                onClick={() => setTab('reports')}>
                🖨 Reports
              </button>
            </div>

            {tab === 'equipment' && <EquipmentTab manager={manager} pin={pin} />}
            {tab === 'checkouts' && <CheckoutsTab manager={manager} pin={pin} />}
            {tab === 'students'  && <StudentsTab  manager={manager} pin={pin} />}
            {tab === 'managers'  && <ManagersTab />}
            {tab === 'reports'   && <ReportsTab manager={manager} pin={pin} />}
          </div>
        </>
      )}
    </div>
  )
}
