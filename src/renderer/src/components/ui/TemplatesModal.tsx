import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { v4 as uuid } from 'uuid'
import { Modal } from './Modal'
import { Button } from './Button'
import type { YTTitleTemplate, YTDescriptionTemplate, YTTagTemplate } from '../../types'

// ─── Inline edit forms ────────────────────────────────────────────────────────

function TitleForm({ initial, onSave, onCancel }: {
  initial: Partial<YTTitleTemplate>
  onSave: (t: YTTitleTemplate) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial.name ?? '')
  const [template, setTemplate] = useState(initial.template ?? '')
  const [error, setError] = useState('')
  const handleSave = () => {
    if (!name.trim()) { setError('Name is required.'); return }
    if (!template.trim()) { setError('Template is required.'); return }
    onSave({ id: initial.id ?? uuid(), name: name.trim(), template: template.trim() })
  }
  return (
    <div className="flex flex-col gap-3 px-4 py-3 bg-white/[0.04] rounded-lg border border-purple-500/20">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Template name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Gaming — Standard" autoFocus
          className="w-full bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500/50" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Title template</label>
        <p className="text-xs text-gray-600">
          Merge fields: <span className="font-mono text-purple-400">{'{game}'}</span>, <span className="font-mono text-purple-400">{'{episode}'}</span>, <span className="font-mono text-purple-400">{'{title}'}</span>
        </p>
        <input value={template} onChange={e => setTemplate(e.target.value)} placeholder="{game} — Part {episode} | {title}"
          className="w-full bg-navy-900 border border-white/10 text-gray-200 text-sm font-mono rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500/50" />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={handleSave}>Save</Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

function DescriptionForm({ initial, onSave, onCancel }: {
  initial: Partial<YTDescriptionTemplate>
  onSave: (t: YTDescriptionTemplate) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial.name ?? '')
  const [description, setDescription] = useState(initial.description ?? '')
  const [error, setError] = useState('')
  const handleSave = () => {
    if (!name.trim()) { setError('Name is required.'); return }
    onSave({ id: initial.id ?? uuid(), name: name.trim(), description })
  }
  return (
    <div className="flex flex-col gap-3 px-4 py-3 bg-white/[0.04] rounded-lg border border-purple-500/20">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Template name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Standard stream description" autoFocus
          className="w-full bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500/50" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Description</label>
        <p className="text-xs text-gray-600">Static text that gets pre-filled and can be edited before publishing.</p>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={6} placeholder="Stream description…"
          className="w-full bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-1.5 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 resize-y" />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={handleSave}>Save</Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

function TagForm({ initial, onSave, onCancel }: {
  initial: Partial<YTTagTemplate>
  onSave: (t: YTTagTemplate) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial.name ?? '')
  const [tagsText, setTagsText] = useState(initial.tags?.join(', ') ?? '')
  const [error, setError] = useState('')
  const tagCount = tagsText.split(',').map(t => t.trim()).filter(Boolean).length
  const handleSave = () => {
    if (!name.trim()) { setError('Name is required.'); return }
    onSave({ id: initial.id ?? uuid(), name: name.trim(), tags: tagsText.split(',').map(t => t.trim()).filter(Boolean) })
  }
  return (
    <div className="flex flex-col gap-3 px-4 py-3 bg-white/[0.04] rounded-lg border border-purple-500/20">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Template name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Elden Ring tags" autoFocus
          className="w-full bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500/50" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Tags</label>
        <p className="text-xs text-gray-600">Comma-separated.</p>
        <textarea value={tagsText} onChange={e => setTagsText(e.target.value)} rows={4} placeholder="gaming, lets play, elden ring, …"
          className="w-full bg-navy-900 border border-white/10 text-gray-200 text-sm font-mono rounded-lg px-3 py-1.5 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 resize-y" />
        <p className="text-xs text-gray-600 text-right">{tagCount} tags</p>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={handleSave}>Save</Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

// ─── Template list with inline editing ───────────────────────────────────────

function TemplateList<T extends { id: string; name: string }>({
  items, subtitle, onSave, onDelete, newLabel, renderForm,
}: {
  items: T[]
  subtitle: (t: T) => React.ReactNode
  onSave: (t: T) => void
  onDelete: (id: string) => void
  newLabel: string
  renderForm: (initial: Partial<T>, onSave: (t: T) => void, onCancel: () => void) => React.ReactNode
}) {
  const [editingId, setEditingId] = useState<string | null>(null)

  const handleSave = (t: T) => {
    onSave(t)
    setEditingId(null)
  }

  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 && editingId !== '__new__' && (
        <p className="text-xs text-gray-600 italic">No templates yet.</p>
      )}
      {items.map(t => (
        editingId === t.id ? (
          <div key={t.id}>
            {renderForm(t, handleSave, () => setEditingId(null))}
          </div>
        ) : (
          <div key={t.id} className="flex items-start justify-between gap-3 px-4 py-3 rounded-lg bg-white/[0.03] border border-white/5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-200">{t.name}</p>
              <div className="mt-0.5">{subtitle(t)}</div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="sm" onClick={() => setEditingId(t.id)}>Edit</Button>
              <button onClick={() => onDelete(t.id)} className="p-1.5 rounded text-gray-700 hover:text-red-400 transition-colors">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        )
      ))}
      {editingId === '__new__'
        ? renderForm({}, handleSave, () => setEditingId(null))
        : (
          <div>
            <Button variant="secondary" size="sm" icon={<Plus size={13} />} onClick={() => setEditingId('__new__')}>
              {newLabel}
            </Button>
          </div>
        )
      }
    </div>
  )
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────

type Tab = 'titles' | 'descriptions' | 'tags'

const TABS: { id: Tab; label: string }[] = [
  { id: 'titles', label: 'Titles' },
  { id: 'descriptions', label: 'Descriptions' },
  { id: 'tags', label: 'Tags' },
]

// ─── Main modal ───────────────────────────────────────────────────────────────

export interface TemplatesModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved?: () => void
}

export function TemplatesModal({ isOpen, onClose, onSaved }: TemplatesModalProps) {
  const [tab, setTab] = useState<Tab>('titles')

  const [titleTemplates, setTitleTemplates] = useState<YTTitleTemplate[]>([])
  const [descTemplates, setDescTemplates] = useState<YTDescriptionTemplate[]>([])
  const [tagTemplates, setTagTemplates] = useState<YTTagTemplate[]>([])

  useEffect(() => {
    if (!isOpen) return
    Promise.all([
      window.api.getYTTitleTemplates(),
      window.api.getYTDescriptionTemplates(),
      window.api.getYTTagTemplates(),
    ]).then(([t, d, g]) => {
      setTitleTemplates(t)
      setDescTemplates(d)
      setTagTemplates(g)
    }).catch(() => {})
  }, [isOpen])

  const upsert = <T extends { id: string }>(list: T[], item: T): T[] => {
    const idx = list.findIndex(x => x.id === item.id)
    const next = [...list]
    if (idx >= 0) next[idx] = item; else next.push(item)
    return next
  }

  const saveTitles = useCallback(async (v: YTTitleTemplate[]) => {
    setTitleTemplates(v); await window.api.setYTTitleTemplates(v); onSaved?.()
  }, [onSaved])

  const saveDescs = useCallback(async (v: YTDescriptionTemplate[]) => {
    setDescTemplates(v); await window.api.setYTDescriptionTemplates(v); onSaved?.()
  }, [onSaved])

  const saveTags = useCallback(async (v: YTTagTemplate[]) => {
    setTagTemplates(v); await window.api.setYTTagTemplates(v); onSaved?.()
  }, [onSaved])

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Templates" width="2xl">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-white/5 -mx-6 px-6 mb-5">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium rounded-t transition-colors ${
              tab === t.id
                ? 'text-white border-b-2 border-purple-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t.label}
            {t.id === 'titles' && titleTemplates.length > 0 && (
              <span className="ml-1.5 text-xs text-gray-600">{titleTemplates.length}</span>
            )}
            {t.id === 'descriptions' && descTemplates.length > 0 && (
              <span className="ml-1.5 text-xs text-gray-600">{descTemplates.length}</span>
            )}
            {t.id === 'tags' && tagTemplates.length > 0 && (
              <span className="ml-1.5 text-xs text-gray-600">{tagTemplates.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'titles' && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-gray-500 leading-relaxed">
            Use <span className="font-mono text-purple-400">{'{game}'}</span>, <span className="font-mono text-purple-400">{'{episode}'}</span>, <span className="font-mono text-purple-400">{'{title}'}</span> as merge fields.
            Title templates are shared between YouTube and Twitch.
          </p>
          <TemplateList
            items={titleTemplates}
            subtitle={t => <p className="text-xs text-gray-500 font-mono truncate">{t.template}</p>}
            onSave={t => saveTitles(upsert(titleTemplates, t))}
            onDelete={id => saveTitles(titleTemplates.filter(t => t.id !== id))}
            newLabel="New title template"
            renderForm={(initial, onSave, onCancel) => (
              <TitleForm initial={initial} onSave={onSave} onCancel={onCancel} />
            )}
          />
        </div>
      )}

      {tab === 'descriptions' && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-gray-500">Static text that gets pre-filled and can be edited before publishing.</p>
          <TemplateList
            items={descTemplates}
            subtitle={t => <p className="text-xs text-gray-500 line-clamp-2 whitespace-pre-wrap">{t.description || <em className="text-gray-700">No description</em>}</p>}
            onSave={t => saveDescs(upsert(descTemplates, t))}
            onDelete={id => saveDescs(descTemplates.filter(t => t.id !== id))}
            newLabel="New description template"
            renderForm={(initial, onSave, onCancel) => (
              <DescriptionForm initial={initial} onSave={onSave} onCancel={onCancel} />
            )}
          />
        </div>
      )}

      {tab === 'tags' && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-gray-500">Curated tag lists you can mix and match per stream.</p>
          <TemplateList
            items={tagTemplates}
            subtitle={t => <p className="text-xs text-gray-500">{t.tags.length} tags — <span className="text-gray-600 font-mono">{t.tags.slice(0, 5).join(', ')}{t.tags.length > 5 ? '…' : ''}</span></p>}
            onSave={t => saveTags(upsert(tagTemplates, t))}
            onDelete={id => saveTags(tagTemplates.filter(t => t.id !== id))}
            newLabel="New tag template"
            renderForm={(initial, onSave, onCancel) => (
              <TagForm initial={initial} onSave={onSave} onCancel={onCancel} />
            )}
          />
        </div>
      )}
    </Modal>
  )
}
