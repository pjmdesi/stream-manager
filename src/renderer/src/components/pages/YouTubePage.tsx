import React, { useState, useEffect, useCallback } from 'react'
import { Youtube, Twitch, Plus, Trash2, ChevronDown, ChevronUp, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { useStore } from '../../hooks/useStore'
import type { YTTitleTemplate, YTDescriptionTemplate, YTTagTemplate } from '../../types'
import { v4 as uuid } from 'uuid'

// ─── Generic template list ────────────────────────────────────────────────────

function TemplateList<T extends { id: string; name: string }>({
  items, subtitle, onEdit, onDelete, onNew, newLabel,
}: {
  items: T[]
  subtitle: (t: T) => React.ReactNode
  onEdit: (t: T) => void
  onDelete: (id: string) => void
  onNew: () => void
  newLabel: string
}) {
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 && <p className="text-xs text-gray-600 italic">No templates yet.</p>}
      {items.map(t => (
        <div key={t.id} className="flex items-start justify-between gap-3 px-4 py-3 rounded-lg bg-white/[0.03] border border-white/5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-200">{t.name}</p>
            <div className="mt-0.5">{subtitle(t)}</div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" onClick={() => onEdit(t)}>Edit</Button>
            <button onClick={() => onDelete(t.id)} className="p-1.5 rounded text-gray-700 hover:text-red-400 transition-colors">
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      ))}
      <div>
        <Button variant="secondary" size="sm" icon={<Plus size={13} />} onClick={onNew}>{newLabel}</Button>
      </div>
    </div>
  )
}

// ─── Template modals ──────────────────────────────────────────────────────────

function TitleTemplateModal({ initial, onSave, onClose }: { initial?: YTTitleTemplate; onSave: (t: YTTitleTemplate) => void; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [template, setTemplate] = useState(initial?.template ?? '')
  const [error, setError] = useState('')
  const handleSave = () => {
    if (!name.trim()) { setError('Name is required.'); return }
    if (!template.trim()) { setError('Template is required.'); return }
    onSave({ id: initial?.id ?? uuid(), name: name.trim(), template: template.trim() })
    onClose()
  }
  return (
    <Modal isOpen onClose={onClose} title={initial ? 'Edit Title Template' : 'New Title Template'} width="md"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={handleSave}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-300">Template name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Gaming — Standard"
            className="w-full bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-300">Title template</label>
          <p className="text-xs text-gray-600">
            Merge fields: <span className="font-mono text-purple-400">{'{game}'}</span>, <span className="font-mono text-purple-400">{'{episode}'}</span>, <span className="font-mono text-purple-400">{'{title}'}</span>
          </p>
          <input value={template} onChange={e => setTemplate(e.target.value)} placeholder="{game} — Part {episode} | {title}"
            className="w-full bg-navy-900 border border-white/10 text-gray-200 text-sm font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50" />
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </Modal>
  )
}

function DescriptionTemplateModal({ initial, onSave, onClose }: { initial?: YTDescriptionTemplate; onSave: (t: YTDescriptionTemplate) => void; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [error, setError] = useState('')
  const handleSave = () => {
    if (!name.trim()) { setError('Name is required.'); return }
    onSave({ id: initial?.id ?? uuid(), name: name.trim(), description })
    onClose()
  }
  return (
    <Modal isOpen onClose={onClose} title={initial ? 'Edit Description Template' : 'New Description Template'} width="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={handleSave}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-300">Template name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Standard stream description"
            className="w-full bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-300">Description</label>
          <p className="text-xs text-gray-600">Static text — edit per-stream before publishing.</p>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={8} placeholder="Stream description…"
            className="w-full bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 resize-none" />
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </Modal>
  )
}

function TagTemplateModal({ initial, onSave, onClose }: { initial?: YTTagTemplate; onSave: (t: YTTagTemplate) => void; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [tagsText, setTagsText] = useState(initial?.tags.join(', ') ?? '')
  const [error, setError] = useState('')
  const tagCount = tagsText.split(',').map(t => t.trim()).filter(Boolean).length
  const handleSave = () => {
    if (!name.trim()) { setError('Name is required.'); return }
    onSave({ id: initial?.id ?? uuid(), name: name.trim(), tags: tagsText.split(',').map(t => t.trim()).filter(Boolean) })
    onClose()
  }
  return (
    <Modal isOpen onClose={onClose} title={initial ? 'Edit Tag Template' : 'New Tag Template'} width="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={handleSave}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-300">Template name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Elden Ring tags"
            className="w-full bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-300">Tags</label>
          <p className="text-xs text-gray-600">Comma-separated.</p>
          <textarea value={tagsText} onChange={e => setTagsText(e.target.value)} rows={6} placeholder="gaming, lets play, elden ring, …"
            className="w-full bg-navy-900 border border-white/10 text-gray-200 text-sm font-mono rounded-lg px-3 py-2 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 resize-none" />
          <p className="text-xs text-gray-600 text-right">{tagCount} tags</p>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </Modal>
  )
}

// ─── Shared section accordion ─────────────────────────────────────────────────

type Section = 'yt-credentials' | 'yt-titles' | 'yt-descriptions' | 'yt-tags' | 'twitch-credentials' | null

function SectionHeader({ id, label, expanded, onToggle, icon }: {
  id: Section; label: string; expanded: boolean; onToggle: () => void; icon?: React.ReactNode
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-5 py-3.5 text-sm font-medium text-gray-200 hover:bg-white/[0.03] transition-colors"
    >
      <span className="flex items-center gap-2">{icon}{label}</span>
      {expanded ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
    </button>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function YouTubePage() {
  const { config, updateConfig } = useStore()

  // ── YouTube credentials ───────────────────────────────────────────────────
  const [ytClientId, setYtClientId] = useState('')
  const [ytClientSecret, setYtClientSecret] = useState('')
  const [ytCredsSaved, setYtCredsSaved] = useState(false)
  const [ytConnected, setYtConnected] = useState(false)
  const [ytConnecting, setYtConnecting] = useState(false)
  const [ytError, setYtError] = useState<string | null>(null)

  // ── Twitch credentials ────────────────────────────────────────────────────
  const [twClientId, setTwClientId] = useState('')
  const [twClientSecret, setTwClientSecret] = useState('')
  const [twCredsSaved, setTwCredsSaved] = useState(false)
  const [twConnected, setTwConnected] = useState(false)
  const [twConnecting, setTwConnecting] = useState(false)
  const [twError, setTwError] = useState<string | null>(null)

  // ── Templates ─────────────────────────────────────────────────────────────
  const [titleTemplates, setTitleTemplates] = useState<YTTitleTemplate[]>([])
  const [descTemplates, setDescTemplates] = useState<YTDescriptionTemplate[]>([])
  const [tagTemplates, setTagTemplates] = useState<YTTagTemplate[]>([])

  const [expandedSection, setExpandedSection] = useState<Section>('yt-credentials')
  type EditingState =
    | { type: 'title'; item?: YTTitleTemplate }
    | { type: 'description'; item?: YTDescriptionTemplate }
    | { type: 'tag'; item?: YTTagTemplate }
    | null
  const [editing, setEditing] = useState<EditingState>(null)

  useEffect(() => {
    setYtClientId(config.youtubeClientId ?? '')
    setYtClientSecret(config.youtubeClientSecret ?? '')
    setTwClientId(config.twitchClientId ?? '')
    setTwClientSecret(config.twitchClientSecret ?? '')
  }, [config.youtubeClientId, config.youtubeClientSecret, config.twitchClientId, config.twitchClientSecret])

  useEffect(() => {
    window.api.youtubeGetStatus().then((s: { connected: boolean }) => {
      setYtConnected(s.connected)
      if (s.connected) setExpandedSection('yt-titles')
    }).catch(() => {})
    window.api.twitchGetStatus().then((s: { connected: boolean }) => {
      setTwConnected(s.connected)
    }).catch(() => {})
    Promise.all([
      window.api.getYTTitleTemplates(),
      window.api.getYTDescriptionTemplates(),
      window.api.getYTTagTemplates(),
    ]).then(([t, d, g]) => { setTitleTemplates(t); setDescTemplates(d); setTagTemplates(g) }).catch(() => {})
  }, [])

  const toggle = (id: Section) => setExpandedSection(prev => prev === id ? null : id)

  // ── YouTube actions ───────────────────────────────────────────────────────
  const saveYtCredentials = async () => {
    await updateConfig({ youtubeClientId: ytClientId.trim(), youtubeClientSecret: ytClientSecret.trim() })
    setYtCredsSaved(true); setTimeout(() => setYtCredsSaved(false), 2000)
  }
  const connectYt = async () => {
    setYtConnecting(true); setYtError(null)
    try { await window.api.youtubeConnect(); setYtConnected(true); setExpandedSection('yt-titles') }
    catch (e: any) { setYtError(e.message) }
    finally { setYtConnecting(false) }
  }
  const disconnectYt = async () => { await window.api.youtubeDisconnect(); setYtConnected(false) }

  // ── Twitch actions ────────────────────────────────────────────────────────
  const saveTwCredentials = async () => {
    await updateConfig({ twitchClientId: twClientId.trim(), twitchClientSecret: twClientSecret.trim() })
    setTwCredsSaved(true); setTimeout(() => setTwCredsSaved(false), 2000)
  }
  const connectTw = async () => {
    setTwConnecting(true); setTwError(null)
    try { await window.api.twitchConnect(); setTwConnected(true) }
    catch (e: any) { setTwError(e.message) }
    finally { setTwConnecting(false) }
  }
  const disconnectTw = async () => { await window.api.twitchDisconnect(); setTwConnected(false) }

  // ── Template helpers ──────────────────────────────────────────────────────
  const saveTitles = useCallback(async (v: YTTitleTemplate[]) => { setTitleTemplates(v); await window.api.setYTTitleTemplates(v) }, [])
  const saveDescs = useCallback(async (v: YTDescriptionTemplate[]) => { setDescTemplates(v); await window.api.setYTDescriptionTemplates(v) }, [])
  const saveTags = useCallback(async (v: YTTagTemplate[]) => { setTagTemplates(v); await window.api.setYTTagTemplates(v) }, [])
  const upsert = <T extends { id: string }>(list: T[], item: T, save: (v: T[]) => void) => {
    const idx = list.findIndex(x => x.id === item.id)
    const next = [...list]; if (idx >= 0) next[idx] = item; else next.push(item)
    save(next)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 shrink-0">
        <div>
          <h1 className="text-lg font-semibold">Integrations</h1>
          <p className="text-xs text-gray-500 mt-0.5">Connect and manage your streaming platform accounts.</p>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <span className={`flex items-center gap-1.5 text-xs ${ytConnected ? 'text-green-400' : 'text-gray-600'}`}>
            <Youtube size={13} />
            {ytConnected ? 'Connected' : 'Not connected'}
          </span>
          <span className={`flex items-center gap-1.5 text-xs ${twConnected ? 'text-purple-400' : 'text-gray-600'}`}>
            <Twitch size={13} />
            {twConnected ? 'Connected' : 'Not connected'}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-hidden pr-2">
      <div className="h-full overflow-y-auto">
      <div className="flex flex-col divide-y divide-white/5">

        {/* ── YouTube ─────────────────────────────────────────────────────── */}
        <div className="px-6 pt-4 pb-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
            <Youtube size={12} className="text-red-400" />
            YouTube
          </div>
        </div>

        {/* YT Credentials */}
        <div>
          <SectionHeader id="yt-credentials" label="Google API Credentials" expanded={expandedSection === 'yt-credentials'} onToggle={() => toggle('yt-credentials')} />
          {expandedSection === 'yt-credentials' && (
            <div className="px-6 pb-5 flex flex-col gap-4">
              <p className="text-xs text-gray-500 leading-relaxed">
                Enter your OAuth 2.0 Client ID and Secret from Google Cloud Console. Stored locally only.
              </p>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-400">Client ID</label>
                  <input value={ytClientId} onChange={e => setYtClientId(e.target.value)} placeholder="…apps.googleusercontent.com"
                    className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-400">Client Secret</label>
                  <input type="password" value={ytClientSecret} onChange={e => setYtClientSecret(e.target.value)} placeholder="GOCSPX-…"
                    className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="secondary" size="sm" onClick={saveYtCredentials}
                  icon={ytCredsSaved ? <CheckCircle2 size={13} className="text-green-400" /> : undefined}>
                  {ytCredsSaved ? 'Saved!' : 'Save credentials'}
                </Button>
                {!ytConnected
                  ? <Button variant="primary" size="sm" onClick={connectYt} disabled={!ytClientId || !ytClientSecret || ytConnecting}
                      icon={ytConnecting ? <Loader2 size={13} className="animate-spin" /> : <Youtube size={13} />}>
                      {ytConnecting ? 'Connecting…' : 'Connect to YouTube'}
                    </Button>
                  : <Button variant="ghost" size="sm" onClick={disconnectYt}>Disconnect</Button>
                }
              </div>
              {ytConnecting && (
                <p className="text-xs text-yellow-400/80 flex items-center gap-1.5">
                  <AlertCircle size={12} />
                  A Google sign-in page has opened in your browser — complete the sign-in there to continue.
                </p>
              )}
              {ytError && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertCircle size={12} />{ytError}</p>}
            </div>
          )}
        </div>

        {/* YT Title Templates */}
        <div>
          <SectionHeader id="yt-titles" label={`Title Templates (${titleTemplates.length})`} expanded={expandedSection === 'yt-titles'} onToggle={() => toggle('yt-titles')} />
          {expandedSection === 'yt-titles' && (
            <div className="px-6 pb-5">
              <p className="text-xs text-gray-500 mb-3 leading-relaxed">
                Use <span className="font-mono text-purple-400">{'{game}'}</span>, <span className="font-mono text-purple-400">{'{episode}'}</span>, <span className="font-mono text-purple-400">{'{title}'}</span> as merge fields.
                Title templates are shared between YouTube and Twitch.
              </p>
              <TemplateList items={titleTemplates}
                subtitle={t => <p className="text-xs text-gray-500 font-mono truncate">{t.template}</p>}
                onEdit={t => setEditing({ type: 'title', item: t })}
                onDelete={id => saveTitles(titleTemplates.filter(t => t.id !== id))}
                onNew={() => setEditing({ type: 'title' })}
                newLabel="New title template" />
            </div>
          )}
        </div>

        {/* YT Description Templates */}
        <div>
          <SectionHeader id="yt-descriptions" label={`Description Templates (${descTemplates.length})`} expanded={expandedSection === 'yt-descriptions'} onToggle={() => toggle('yt-descriptions')} />
          {expandedSection === 'yt-descriptions' && (
            <div className="px-6 pb-5">
              <p className="text-xs text-gray-500 mb-3">Static text that gets pre-filled and can be edited before publishing.</p>
              <TemplateList items={descTemplates}
                subtitle={t => <p className="text-xs text-gray-500 line-clamp-2 whitespace-pre-wrap">{t.description || <em className="text-gray-700">No description</em>}</p>}
                onEdit={t => setEditing({ type: 'description', item: t })}
                onDelete={id => saveDescs(descTemplates.filter(t => t.id !== id))}
                onNew={() => setEditing({ type: 'description' })}
                newLabel="New description template" />
            </div>
          )}
        </div>

        {/* YT Tag Templates */}
        <div>
          <SectionHeader id="yt-tags" label={`Tag Templates (${tagTemplates.length})`} expanded={expandedSection === 'yt-tags'} onToggle={() => toggle('yt-tags')} />
          {expandedSection === 'yt-tags' && (
            <div className="px-6 pb-5">
              <p className="text-xs text-gray-500 mb-3">Curated tag lists you can mix and match per stream.</p>
              <TemplateList items={tagTemplates}
                subtitle={t => <p className="text-xs text-gray-500">{t.tags.length} tags — <span className="text-gray-600 font-mono">{t.tags.slice(0, 5).join(', ')}{t.tags.length > 5 ? '…' : ''}</span></p>}
                onEdit={t => setEditing({ type: 'tag', item: t })}
                onDelete={id => saveTags(tagTemplates.filter(t => t.id !== id))}
                onNew={() => setEditing({ type: 'tag' })}
                newLabel="New tag template" />
            </div>
          )}
        </div>

        {/* ── Twitch ───────────────────────────────────────────────────────── */}
        <div className="px-6 pt-4 pb-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
            <Twitch size={12} className="text-purple-400" />
            Twitch
          </div>
        </div>

        {/* Twitch Credentials */}
        <div>
          <SectionHeader id="twitch-credentials" label="Twitch API Credentials" expanded={expandedSection === 'twitch-credentials'} onToggle={() => toggle('twitch-credentials')} />
          {expandedSection === 'twitch-credentials' && (
            <div className="px-6 pb-5 flex flex-col gap-4">
              <p className="text-xs text-gray-500 leading-relaxed">
                Create an application at{' '}
                <a href="#" onClick={e => { e.preventDefault(); window.api.openUrl('https://dev.twitch.tv/console') }}
                  className="font-mono text-purple-400 hover:text-purple-300 underline cursor-pointer">
                  dev.twitch.tv/console
                </a>
                {' '}using <strong className="text-gray-300">Confidential</strong> as the Client Type,
                and add the following as a redirect URL:{' '}
                <span className="font-mono text-gray-400 select-all">http://localhost:42814/oauth2callback</span>
                {' '}Stored locally only.
              </p>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-400">Client ID</label>
                  <input value={twClientId} onChange={e => setTwClientId(e.target.value)} placeholder="Twitch Client ID"
                    className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-400">Client Secret</label>
                  <input type="password" value={twClientSecret} onChange={e => setTwClientSecret(e.target.value)} placeholder="Twitch Client Secret"
                    className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="secondary" size="sm" onClick={saveTwCredentials}
                  icon={twCredsSaved ? <CheckCircle2 size={13} className="text-green-400" /> : undefined}>
                  {twCredsSaved ? 'Saved!' : 'Save credentials'}
                </Button>
                {!twConnected
                  ? <Button variant="primary" size="sm" onClick={connectTw} disabled={!twClientId || !twClientSecret || twConnecting}
                      icon={twConnecting ? <Loader2 size={13} className="animate-spin" /> : <Twitch size={13} />}
                      className="bg-purple-600 hover:bg-purple-500">
                      {twConnecting ? 'Connecting…' : 'Connect to Twitch'}
                    </Button>
                  : <Button variant="ghost" size="sm" onClick={disconnectTw}>Disconnect</Button>
                }
              </div>
              {twConnecting && (
                <p className="text-xs text-yellow-400/80 flex items-center gap-1.5">
                  <AlertCircle size={12} />
                  A Twitch sign-in page has opened in your browser — complete the sign-in there to continue.
                </p>
              )}
              {twError && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertCircle size={12} />{twError}</p>}
            </div>
          )}
        </div>

      </div>
      </div>
      </div>

      {/* Modals */}
      {editing?.type === 'title' && (
        <TitleTemplateModal initial={editing.item} onSave={t => upsert(titleTemplates, t, saveTitles)} onClose={() => setEditing(null)} />
      )}
      {editing?.type === 'description' && (
        <DescriptionTemplateModal initial={editing.item} onSave={t => upsert(descTemplates, t, saveDescs)} onClose={() => setEditing(null)} />
      )}
      {editing?.type === 'tag' && (
        <TagTemplateModal initial={editing.item} onSave={t => upsert(tagTemplates, t, saveTags)} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}
