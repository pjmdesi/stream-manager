import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Plus, Trash2, Star } from 'lucide-react'
import { v4 as uuid } from 'uuid'
import { Modal } from './Modal'
import { Button } from './Button'
import { Tooltip } from './Tooltip'
import { TagChipEditor } from './TagChipEditor'
import { TemplateBodyEditor, MergeFieldPicker } from './TemplateBodyEditor'
import { useStore } from '../../hooks/useStore'
import type { YTTitleTemplate, YTDescriptionTemplate, YTTagTemplate, TwitchTagTemplate } from '../../types'
import { ytTagCharCount, YT_TAG_CHAR_LIMIT } from '../../lib/ytTagCount'
import { toTwitchCompatibleTags, TWITCH_TAG_MAX_COUNT } from '../../lib/twitchTags'

// Merge-field key sets — same as the sidebar's title field, plus
// `season_links` (description-only, resolved async at apply time).
const TITLE_MERGE_KEYS = ['game', 'season', 'episode', 'tagline', 'title', 'total_episodes'] as const
const DESCRIPTION_MERGE_KEYS = [...TITLE_MERGE_KEYS, 'season_links'] as const

// ─── Inline edit forms ────────────────────────────────────────────────────────

function TitleForm({ initial, onSave, onCancel }: {
  initial: Partial<YTTitleTemplate>
  onSave: (t: YTTitleTemplate) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial.name ?? '')
  const [template, setTemplate] = useState(initial.template ?? '')
  const [error, setError] = useState('')
  const keySet = useMemo(() => new Set<string>(TITLE_MERGE_KEYS as readonly string[]), [])
  const insertRef = useRef<((text: string) => void) | null>(null)
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
        <TemplateBodyEditor
          value={template}
          onSave={setTemplate}
          knownKeys={keySet}
          insertRef={insertRef}
          placeholder="{game} S{season} — Part {episode} of {total_episodes} | {tagline}"
        />
        <MergeFieldPicker keys={TITLE_MERGE_KEYS} onInsert={k => insertRef.current?.(`{${k}}`)} />
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
  const keySet = useMemo(() => new Set<string>(DESCRIPTION_MERGE_KEYS as readonly string[]), [])
  const insertRef = useRef<((text: string) => void) | null>(null)
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
        <p className="text-xs text-gray-400 leading-relaxed">
          <span className="font-mono text-purple-300">{'{season_links}'}</span> resolves
          to a list of previous-episode links, applied once when the template is selected.
        </p>
        <TemplateBodyEditor
          value={description}
          onSave={setDescription}
          knownKeys={keySet}
          insertRef={insertRef}
          placeholder="Stream description…"
          multiline
          minHeight={144}
        />
        <MergeFieldPicker keys={DESCRIPTION_MERGE_KEYS} onInsert={k => insertRef.current?.(`{${k}}`)} />
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
  const [tags, setTags] = useState<string[]>(initial.tags ?? [])
  const [error, setError] = useState('')
  const charCount = ytTagCharCount(tags.join(', '))
  const overLimit = charCount > YT_TAG_CHAR_LIMIT
  const nearLimit = !overLimit && charCount >= YT_TAG_CHAR_LIMIT * 0.85
  const countColorCls = overLimit ? 'text-red-400' : nearLimit ? 'text-amber-400' : 'text-gray-400'
  const handleSave = () => {
    if (!name.trim()) { setError('Name is required.'); return }
    onSave({ id: initial.id ?? uuid(), name: name.trim(), tags })
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
        <TagChipEditor
          value={tags}
          onChange={setTags}
          sortOnBlur
          placeholder="add tag…"
          footerRight={
            <span className={`text-xs tabular-nums ${countColorCls}`}>
              {tags.length} tags · {charCount} / {YT_TAG_CHAR_LIMIT} chars
            </span>
          }
        />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={handleSave}>Save</Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

function TwitchTagForm({ initial, onSave, onCancel }: {
  initial: Partial<TwitchTagTemplate>
  onSave: (t: TwitchTagTemplate) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial.name ?? '')
  const [tags, setTags] = useState<string[]>(initial.tags ?? [])
  const [error, setError] = useState('')
  const { compat, skipped } = toTwitchCompatibleTags(tags)
  const handleSave = () => {
    if (!name.trim()) { setError('Name is required.'); return }
    // Persist only the Twitch-compatible subset — saving incompatible tags
    // would just defer the disappointment to push time.
    onSave({ id: initial.id ?? uuid(), name: name.trim(), tags: compat })
  }
  return (
    <div className="flex flex-col gap-3 px-4 py-3 bg-white/[0.04] rounded-lg border border-purple-500/20">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Template name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. EldenRing tags" autoFocus
          className="w-full bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500/50" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Tags</label>
        <p className="text-xs text-gray-400">Twitch rules: alphanumeric only (no spaces or punctuation), max {TWITCH_TAG_MAX_COUNT} tags, max 25 chars each.</p>
        <TagChipEditor
          value={tags}
          onChange={setTags}
          placeholder="add tag…"
          footerRight={
            <span className="text-xs tabular-nums text-gray-400">
              {compat.length} / {TWITCH_TAG_MAX_COUNT} valid
              {skipped.length > 0 && <span className="text-amber-400 ml-1">· {skipped.length} invalid (will be dropped)</span>}
            </span>
          }
        />
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
  items, subtitle, onSave, onDelete, newLabel, renderForm, defaultId, onSetDefault,
}: {
  items: T[]
  subtitle: (t: T) => React.ReactNode
  onSave: (t: T) => void
  onDelete: (id: string) => void
  newLabel: string
  renderForm: (initial: Partial<T>, onSave: (t: T) => void, onCancel: () => void) => React.ReactNode
  /** Optional — when supplied, renders a star toggle next to each item.
   *  Clicking sets that template as the default for newly-created
   *  streams; clicking the already-default star clears the default
   *  (toggle semantics). When omitted, no star column shows — used by
   *  the Titles + Descriptions tabs which don't support defaults yet. */
  defaultId?: string
  onSetDefault?: (id: string) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)

  const handleSave = (t: T) => {
    onSave(t)
    setEditingId(null)
  }

  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 && editingId !== '__new__' && (
        <p className="text-xs text-gray-400 italic">No templates yet.</p>
      )}
      {items.map(t => (
        editingId === t.id ? (
          <div key={t.id}>
            {renderForm(t, handleSave, () => setEditingId(null))}
          </div>
        ) : (
          <div key={t.id} className="flex items-start justify-between gap-3 px-4 py-3 rounded-lg bg-white/[0.03] border border-white/5">
            <div className="min-w-0 flex-1 flex items-start gap-2">
              {onSetDefault && (
                <Tooltip content={defaultId === t.id ? 'Default for new streams (click to clear)' : 'Set as default for new streams'} side="top">
                  <button
                    type="button"
                    onClick={() => onSetDefault(defaultId === t.id ? '' : t.id)}
                    className={`p-1 rounded transition-colors mt-0.5 ${
                      defaultId === t.id
                        ? 'text-amber-400 hover:text-amber-300'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    <Star size={13} fill={defaultId === t.id ? 'currentColor' : 'none'} />
                  </button>
                </Tooltip>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-200">{t.name}</p>
                <div className="mt-0.5">{subtitle(t)}</div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="sm" onClick={() => setEditingId(t.id)}>Edit</Button>
              <button onClick={() => onDelete(t.id)} className="p-1.5 rounded text-gray-400 hover:text-red-400 transition-colors">
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

/**
 * BulkBindRow — surfaces above the YT tag template list. Walks every
 * folder, finds streams whose tags are non-empty + unbound + exactly
 * match a single template (case-insensitive set equality, no
 * ambiguity), and offers to bind them all in one click.
 *
 * Ambiguous matches (multiple templates with identical tags) are
 * deliberately dropped — auto-binding then would be a coin flip; the
 * user can resolve those per-stream via the inline "Bind to X" link.
 */
function BulkBindRow({
  folders, tagTemplates, onApply,
}: {
  folders: NonNullable<TemplatesModalProps['folders']>
  tagTemplates: YTTagTemplate[]
  onApply: NonNullable<TemplatesModalProps['onBulkBindYtTags']>
}) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)

  // Bucket templates by their normalized tag-set key so the match
  // check is O(1) per folder rather than O(templates * folder). We
  // only keep buckets with exactly one template — multi-template
  // buckets are ambiguous and skipped.
  const candidates = useMemo(() => {
    const buckets = new Map<string, YTTagTemplate[]>()
    for (const t of tagTemplates) {
      if (t.tags.length === 0) continue
      const k = t.tags.map(x => x.toLowerCase()).sort().join('|')
      const list = buckets.get(k) ?? []
      list.push(t)
      buckets.set(k, list)
    }
    const unambiguous = new Map<string, YTTagTemplate>()
    for (const [k, list] of buckets) if (list.length === 1) unambiguous.set(k, list[0])
    const binds: Array<{ folderPath: string; templateId: string; templateName: string }> = []
    for (const f of folders) {
      const m = f.meta
      if (!m?.ytTags?.length || m.ytTagsTemplateId) continue
      const k = m.ytTags.map(x => x.toLowerCase()).sort().join('|')
      const tpl = unambiguous.get(k)
      if (tpl) binds.push({ folderPath: f.folderPath, templateId: tpl.id, templateName: tpl.name })
    }
    return binds
  }, [folders, tagTemplates])

  useEffect(() => { setArmed(false) }, [candidates.length])

  if (candidates.length === 0) return null

  const handleClick = async () => {
    if (!armed) { setArmed(true); return }
    setBusy(true)
    try { await onApply(candidates.map(({ folderPath, templateId }) => ({ folderPath, templateId }))) }
    finally { setBusy(false); setArmed(false) }
  }

  // Distinct template names in the candidate set — drives the "matched
  // N streams across M templates" subtitle. Set keeps ordering stable
  // enough for a short preview list.
  const templateNames = Array.from(new Set(candidates.map(c => c.templateName)))

  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3 rounded-lg bg-amber-500/[0.06] border border-amber-500/20">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-200">
          <span className="font-medium">{candidates.length}</span> unbound stream{candidates.length === 1 ? '' : 's'} match{candidates.length === 1 ? 'es' : ''} a template exactly.
        </p>
        <p className="mt-0.5 text-xs text-gray-400">
          Binding leaves tags as-is; future edits to {templateNames.length === 1 ? `the "${templateNames[0]}"` : 'these'} template{templateNames.length === 1 ? '' : 's'} will sync into the bound stream{candidates.length === 1 ? '' : 's'}.
          {templateNames.length > 1 && <> Matched: <span className="text-gray-300">{templateNames.slice(0, 4).join(', ')}{templateNames.length > 4 ? `, +${templateNames.length - 4} more` : ''}</span>.</>}
        </p>
      </div>
      <Button
        variant={armed ? 'primary' : 'ghost'}
        size="sm"
        onClick={handleClick}
        loading={busy}
        disabled={busy}
      >
        {armed ? `Confirm bind ${candidates.length}` : `Auto-bind ${candidates.length}`}
      </Button>
    </div>
  )
}

type Tab = 'titles' | 'descriptions' | 'tags' | 'twitch-tags'

const TABS: { id: Tab; label: string }[] = [
  { id: 'titles', label: 'Titles' },
  { id: 'descriptions', label: 'Descriptions' },
  { id: 'tags', label: 'YouTube Tags' },
  { id: 'twitch-tags', label: 'Twitch Tags' },
]

// ─── Main modal ───────────────────────────────────────────────────────────────

export interface TemplatesModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved?: () => void
  /** Folder list — used by the "auto-bind" affordance on the YT tags
   *  tab to count + bind streams whose existing tags exactly match a
   *  template. Optional so the modal still renders if the host page
   *  doesn't surface bindings. */
  folders?: Array<{ folderPath: string; relativePath?: string; meta?: { ytTags?: string[]; ytTagsTemplateId?: string } | null }>
  /** Callback for the bulk auto-bind action. Receives the resolved
   *  (folderPath → templateId) list and persists each binding. The
   *  host writes meta + refreshes its folder list. */
  onBulkBindYtTags?: (binds: Array<{ folderPath: string; templateId: string }>) => Promise<void> | void
}

export function TemplatesModal({ isOpen, onClose, onSaved, folders, onBulkBindYtTags }: TemplatesModalProps) {
  const [tab, setTab] = useState<Tab>('titles')
  const { config, updateConfig } = useStore()

  const [titleTemplates, setTitleTemplates] = useState<YTTitleTemplate[]>([])
  const [descTemplates, setDescTemplates] = useState<YTDescriptionTemplate[]>([])
  const [tagTemplates, setTagTemplates] = useState<YTTagTemplate[]>([])
  const [twitchTagTemplates, setTwitchTagTemplates] = useState<TwitchTagTemplate[]>([])

  useEffect(() => {
    if (!isOpen) return
    Promise.all([
      window.api.getYTTitleTemplates(),
      window.api.getYTDescriptionTemplates(),
      window.api.getYTTagTemplates(),
      window.api.getTwitchTagTemplates(),
    ]).then(([t, d, g, twg]) => {
      setTitleTemplates(t)
      setDescTemplates(d)
      setTagTemplates(g)
      setTwitchTagTemplates(twg)
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

  const saveTwitchTags = useCallback(async (v: TwitchTagTemplate[]) => {
    setTwitchTagTemplates(v); await window.api.setTwitchTagTemplates(v); onSaved?.()
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
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            {t.label}
            {t.id === 'titles' && titleTemplates.length > 0 && (
              <span className="ml-1.5 text-xs text-gray-400">{titleTemplates.length}</span>
            )}
            {t.id === 'descriptions' && descTemplates.length > 0 && (
              <span className="ml-1.5 text-xs text-gray-400">{descTemplates.length}</span>
            )}
            {t.id === 'tags' && tagTemplates.length > 0 && (
              <span className="ml-1.5 text-xs text-gray-400">{tagTemplates.length}</span>
            )}
            {t.id === 'twitch-tags' && twitchTagTemplates.length > 0 && (
              <span className="ml-1.5 text-xs text-gray-400">{twitchTagTemplates.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content — fixed height + internal scroll so the modal stays
          locked at the same size regardless of which tab is active or how
          many items it holds. -mx-6 px-6 lets the scrollbar live at the
          modal's outer edge instead of inset, matching the rest of the
          modal's padding. */}
      <div className="h-[540px] overflow-y-auto -mx-6 px-6">
      {tab === 'titles' && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-gray-400 leading-relaxed">
            Use <span className="font-mono text-purple-400">{'{game}'}</span>, <span className="font-mono text-purple-400">{'{season}'}</span>, <span className="font-mono text-purple-400">{'{episode}'}</span>, <span className="font-mono text-purple-400">{'{total_episodes}'}</span>, <span className="font-mono text-purple-400">{'{tagline}'}</span> as merge fields.
            Title templates are shared between YouTube and Twitch.
          </p>
          <TemplateList
            items={titleTemplates}
            subtitle={t => <p className="text-xs text-gray-400 font-mono truncate">{t.template}</p>}
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
          <p className="text-xs text-gray-400 leading-relaxed">
            Pre-filled into the description field; can be edited before publishing.
            Supports the same merge fields as titles (
            <span className="font-mono text-purple-400">{'{game}'}</span>,
            {' '}<span className="font-mono text-purple-400">{'{season}'}</span>,
            {' '}<span className="font-mono text-purple-400">{'{episode}'}</span>,
            {' '}<span className="font-mono text-purple-400">{'{total_episodes}'}</span>,
            {' '}<span className="font-mono text-purple-400">{'{tagline}'}</span>
            ), plus
            {' '}<span className="font-mono text-purple-400">{'{season_links}'}</span>
            {' '}— expands to a list of links to previous episodes in the same series+season (one per line, newest first).
          </p>
          <TemplateList
            items={descTemplates}
            subtitle={t => <p className="text-xs text-gray-400 line-clamp-2 whitespace-pre-wrap">{t.description || <em className="text-gray-400">No description</em>}</p>}
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
          <p className="text-xs text-gray-400">Curated YouTube tag lists you can mix and match per stream.</p>
          {folders && onBulkBindYtTags && (
            <BulkBindRow
              folders={folders}
              tagTemplates={tagTemplates}
              onApply={onBulkBindYtTags}
            />
          )}
          <TemplateList
            items={tagTemplates}
            subtitle={t => <p className="text-xs text-gray-400">{t.tags.length} tags — <span className="text-gray-400 font-mono">{t.tags.slice(0, 5).join(', ')}{t.tags.length > 5 ? '…' : ''}</span></p>}
            onSave={t => saveTags(upsert(tagTemplates, t))}
            onDelete={id => saveTags(tagTemplates.filter(t => t.id !== id))}
            newLabel="New tag template"
            renderForm={(initial, onSave, onCancel) => (
              <TagForm initial={initial} onSave={onSave} onCancel={onCancel} />
            )}
            defaultId={config.defaultYouTubeTagsTemplateId}
            onSetDefault={id => updateConfig({ defaultYouTubeTagsTemplateId: id })}
          />
        </div>
      )}

      {tab === 'twitch-tags' && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-gray-400">
            Twitch channel-tag lists. Twitch's rules differ from YouTube's:
            alphanumeric only (no spaces or punctuation), max {TWITCH_TAG_MAX_COUNT} tags,
            max 25 chars each. Invalid tags get dropped on save.
          </p>
          <TemplateList
            items={twitchTagTemplates}
            subtitle={t => <p className="text-xs text-gray-400">{t.tags.length} tags — <span className="text-gray-400 font-mono">{t.tags.slice(0, 5).join(', ')}{t.tags.length > 5 ? '…' : ''}</span></p>}
            onSave={t => saveTwitchTags(upsert(twitchTagTemplates, t))}
            onDelete={id => saveTwitchTags(twitchTagTemplates.filter(t => t.id !== id))}
            newLabel="New Twitch tag template"
            renderForm={(initial, onSave, onCancel) => (
              <TwitchTagForm initial={initial} onSave={onSave} onCancel={onCancel} />
            )}
            defaultId={config.defaultTwitchTagsTemplateId}
            onSetDefault={id => updateConfig({ defaultTwitchTagsTemplateId: id })}
          />
        </div>
      )}
      </div>
    </Modal>
  )
}
