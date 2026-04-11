import React, { useState, useEffect } from 'react'
import { Plus, Trash2, FolderOpen, CheckCircle, AlertCircle, Clock } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import type { WatchRule, WatchEvent } from '../../types'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { Input, Select } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useWatcher } from '../../context/WatcherContext'

function RuleModal({
  rule,
  onClose,
  onSave,
}: {
  rule: WatchRule | null
  onClose: () => void
  onSave: (r: WatchRule) => void
}) {
  const [watchPath, setWatchPath] = useState(rule?.watchPath || '')
  const [pattern, setPattern] = useState(rule?.pattern || '*.mkv')
  const [action, setAction] = useState<WatchRule['action']>(rule?.action || 'move')
  const [destinationMode, setDestinationMode] = useState<'static' | 'auto'>(rule?.destinationMode || 'static')
  const [destination, setDestination] = useState(rule?.destination || '')
  const [autoMatchDate, setAutoMatchDate] = useState(rule?.autoMatchDate ?? true)
  const [namePattern, setNamePattern] = useState(rule?.namePattern || '')
  const [onlyNewFiles, setOnlyNewFiles] = useState(rule?.onlyNewFiles ?? false)

  const pickDir = async (setter: (v: string) => void) => {
    const dir = await window.api.openDirectoryDialog()
    if (dir) setter(dir)
  }

  const save = () => {
    onSave({
      id: rule?.id || uuidv4(),
      enabled: rule?.enabled ?? true,
      watchPath,
      pattern,
      action,
      destinationMode: action !== 'rename' ? destinationMode : undefined,
      destination: action !== 'rename' && destinationMode === 'static' ? destination : undefined,
      autoMatchDate: action !== 'rename' && destinationMode === 'auto' ? autoMatchDate : undefined,
      namePattern: namePattern || undefined,
      onlyNewFiles: onlyNewFiles || undefined,
    })
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={rule ? 'Edit Rule' : 'New Rule'}
      width="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-300">Watch Path</label>
          <div className="flex gap-2">
            <input
              className="flex-1 bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              value={watchPath}
              onChange={e => setWatchPath(e.target.value)}
              placeholder="Folder to watch…"
            />
            <Button variant="secondary" size="sm" icon={<FolderOpen size={14} />} onClick={() => pickDir(setWatchPath)}>
              Browse
            </Button>
          </div>
        </div>

        <Input
          label="File Pattern"
          value={pattern}
          onChange={e => setPattern(e.target.value)}
          placeholder="*.mkv"
          hint="Glob pattern, e.g. *.mkv, stream_*.mp4"
        />

        <Select
          label="Action"
          value={action}
          onChange={e => setAction(e.target.value as WatchRule['action'])}
          options={[
            { value: 'move', label: 'Move' },
            { value: 'copy', label: 'Copy' },
            { value: 'rename', label: 'Rename only' },
          ]}
        />

        {action !== 'rename' && (
          <div className="flex flex-col gap-3">
            <Select
              label="Destination"
              value={destinationMode}
              onChange={e => setDestinationMode(e.target.value as 'static' | 'auto')}
              options={[
                { value: 'auto', label: 'Automatically detect location' },
                { value: 'static', label: 'Static location' },
              ]}
            />

            {destinationMode === 'static' && (
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  value={destination}
                  onChange={e => setDestination(e.target.value)}
                  placeholder="Destination folder…"
                />
                <Button variant="secondary" size="sm" icon={<FolderOpen size={14} />} onClick={() => pickDir(setDestination)}>
                  Browse
                </Button>
              </div>
            )}

            {destinationMode === 'auto' && (
              <div className="flex flex-col gap-2 pl-1">
                <Checkbox checked={autoMatchDate} onChange={setAutoMatchDate} label="Match date in filename" />
                {autoMatchDate && (
                  <p className="text-xs text-gray-500 pl-6">
                    Looks for a <span className="font-mono text-gray-400">YYYY-MM-DD</span> date in the filename and moves the file to the matching stream folder. The watcher will wait for the recording to finish writing before moving.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <Input
          label="Rename Pattern (optional)"
          value={namePattern}
          onChange={e => setNamePattern(e.target.value)}
          placeholder="{date}_{name}.{ext}"
          hint="Variables: {name} {ext} {date} {year} {month} {day} {time}"
        />

        <div className="border-t border-white/5 pt-4 flex flex-col gap-1.5">
          <Checkbox checked={onlyNewFiles} onChange={setOnlyNewFiles} label="Only apply to new files" />
          {onlyNewFiles && (
            <p className="text-xs text-gray-500 pl-6">The rule will only apply to files created when the watcher is active.</p>
          )}
        </div>
      </div>
    </Modal>
  )
}

function EventBadge({ status }: { status: WatchEvent['status'] }) {
  return (
    <div className="w-3 h-3 shrink-0 flex items-center justify-center mt-0.5">
      {status === 'applied'                      && <CheckCircle size={12} className="text-green-400" />}
      {status === 'error'                        && <AlertCircle size={12} className="text-red-400" />}
      {(status === 'matched' || status === 'waiting') && <Clock size={12} className="text-yellow-500" />}
    </div>
  )
}

export function RulesPage() {
  const { rules, running, events, saveRules, toggleRule } = useWatcher()
  const [editing, setEditing] = useState<WatchRule | null>(null)
  const [showEdit, setShowEdit] = useState(false)
  const [autoStart, setAutoStart] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    window.api.getConfig().then(c => setAutoStart(c.autoStartWatcher))
  }, [])

  const toggleAutoStart = async (value: boolean) => {
    setAutoStart(value)
    await window.api.setConfig({ autoStartWatcher: value })
  }

  const confirmDelete = (id: string) => setConfirmDeleteId(id)

  const deleteRule = async () => {
    if (!confirmDeleteId) return
    await saveRules(rules.filter(r => r.id !== confirmDeleteId))
    setConfirmDeleteId(null)
  }

  const handleSave = async (rule: WatchRule) => {
    const exists = rules.find(r => r.id === rule.id)
    const updated = exists ? rules.map(r => r.id === rule.id ? rule : r) : [...rules, rule]
    await saveRules(updated)
    setShowEdit(false)
    setEditing(null)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
        <div>
          <h1 className="text-lg font-semibold">Auto-Rules</h1>
          <p className="text-xs text-gray-500 mt-0.5">Watch folders and automatically move, copy, or rename files</p>
        </div>
        <Checkbox checked={autoStart} onChange={toggleAutoStart} label="Start watcher on launch" />
        <Button
          variant="primary"
          size="sm"
          icon={<Plus size={14} />}
          onClick={() => { setEditing(null); setShowEdit(true) }}
        >
          Add Rule
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Rules list */}
        <div className="flex-1 overflow-hidden pr-2"><div className="h-full overflow-y-auto p-4 flex flex-col gap-2">
          {rules.length === 0 && (
            <div className="text-center text-gray-600 py-16">No rules yet. Add one to start automating.</div>
          )}
          {rules.map(rule => (
            <div
              key={rule.id}
              className={`bg-navy-800 border rounded-lg p-4 flex items-start gap-3 ${rule.enabled ? 'border-white/5' : 'border-white/5 opacity-50'}`}
            >
              <Checkbox checked={rule.enabled} onChange={() => toggleRule(rule.id)} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-mono text-gray-300 truncate">{rule.watchPath}</span>
                  <span className="text-xs bg-surface-100 text-purple-300 px-2 py-0.5 rounded">{rule.pattern}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    rule.action === 'move' ? 'bg-blue-900/30 text-blue-300' :
                    rule.action === 'copy' ? 'bg-green-900/30 text-green-300' :
                    'bg-yellow-900/30 text-yellow-300'
                  }`}>{rule.action}</span>
                </div>
                {rule.destinationMode === 'auto' ? (
                  <div className="text-xs text-gray-500 mt-1">
                    → <span className="text-purple-400">auto</span>
                    {rule.autoMatchDate && <span className="text-gray-600"> · match date in filename</span>}
                  </div>
                ) : rule.destination ? (
                  <div className="text-xs text-gray-500 mt-1 truncate">→ {rule.destination}</div>
                ) : null}
                {rule.namePattern && (
                  <div className="text-xs text-gray-500 mt-0.5">rename: {rule.namePattern}</div>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <Button variant="ghost" size="sm" onClick={() => { setEditing(rule); setShowEdit(true) }}>
                  Edit
                </Button>
                <Button variant="danger" size="sm" icon={<Trash2 size={12} />} onClick={() => confirmDelete(rule.id)} />
              </div>
            </div>
          ))}
        </div></div>

        {/* Event log */}
        <div className="w-72 bg-navy-800 border-l border-white/5 flex flex-col shrink-0">
          <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Activity</h3>
            {running && (
              <span className="flex items-center gap-1 text-xs text-green-400">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Live
              </span>
            )}
          </div>
          <div className="flex-1 overflow-hidden pr-2"><div className="h-full overflow-y-auto">
            {events.length === 0 && (
              <div className="text-center text-xs text-gray-600 py-8">No events yet</div>
            )}
            {events.map((ev) => (
              <div key={ev.id} className="px-3 py-2 border-b border-white/5 flex items-start gap-2">
                <EventBadge status={ev.status} />
                <div className="min-w-0 w-full">
                  <div className="text-xs text-gray-300 truncate">{ev.filePath.split(/[\\/]/).pop()}</div>
                  <div className="text-xs text-gray-600">{ev.action} · {new Date(ev.timestamp).toLocaleTimeString()}</div>
                  {ev.progress !== undefined && ev.status !== 'applied' && ev.status !== 'error' && (
                    <div className="mt-1">
                      <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-purple-500 rounded-full transition-all duration-200"
                          style={{ width: `${ev.progress}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-gray-600 mt-0.5">{ev.progress}%</div>
                    </div>
                  )}
                  {ev.status === 'waiting' && ev.progress === undefined && (
                    <div className="text-xs text-yellow-600">
                      File busy — retrying every 30s
                      {ev.lastChecked && <span> · last checked {new Date(ev.lastChecked).toLocaleTimeString()}</span>}
                    </div>
                  )}
                  {ev.status === 'error' && ev.error && (
                    <div className="text-xs text-red-400 truncate" title={ev.error}>{ev.error}</div>
                  )}
                </div>
              </div>
            ))}
          </div></div>
        </div>
      </div>

      {showEdit && (
        <RuleModal
          rule={editing as WatchRule | null}
          onClose={() => { setShowEdit(false); setEditing(null) }}
          onSave={handleSave}
        />
      )}

      {confirmDeleteId && (
        <Modal
          isOpen
          onClose={() => setConfirmDeleteId(null)}
          title="Delete rule?"
          width="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
              <Button variant="danger" onClick={deleteRule}>Delete</Button>
            </>
          }
        >
          <p className="text-sm text-gray-400">This rule will be permanently removed. Any files already moved by this rule will not be affected.</p>
        </Modal>
      )}
    </div>
  )
}
