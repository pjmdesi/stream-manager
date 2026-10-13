import React, { useState, useEffect } from 'react'
import { Plus, Trash2, Star, Archive, ThumbsUp, Upload, RefreshCw } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Tooltip } from '../ui/Tooltip'
import { useStore } from '../../hooks/useStore'
import type { ConversionPreset } from '../../types'
import { PresetEditorForm } from './PresetEditorForm'

interface Props {
  isOpen: boolean
  onClose: () => void
  builtinPresets: ConversionPreset[]
  importedPresets: ConversionPreset[]
  /** System-recommended preset (best AV1/H.265 archive encoder for this
   *  machine) — read-only badge, not user-settable. */
  recommendedId: string | null
  /** Persist a created/edited custom preset + refresh the caller's list. */
  onSavePreset: (preset: ConversionPreset) => void | Promise<void>
  onDeletePreset: (id: string) => void
  onImport: () => void
  importing: boolean
  importError: string
}

/**
 * PresetsModal — conversion-preset management, replacing the old left sidebar.
 * Mirrors the Templates modal: a scrollable list with inline create/edit
 * forms. Three per-preset markers:
 *   - ★ default (amber)   → defaultConversionPresetId (preset new files get)
 *   - Archive (accent)    → archivePresetId (used by the streams archive flow)
 *   - ThumbsUp (emerald)  → system recommendation (read-only)
 */
export function PresetsModal({
  isOpen, onClose, builtinPresets, importedPresets, recommendedId,
  onSavePreset, onDeletePreset, onImport, importing, importError,
}: Props) {
  const { config, updateConfig } = useStore()
  const defaultId = config.defaultConversionPresetId ?? ''
  const archiveId = config.archivePresetId ?? ''

  // null = nothing open; '__new__' = the create form; otherwise the id of the
  // custom preset being edited.
  const [editingId, setEditingId] = useState<string | null>(null)

  // What each preset's video encoder resolves to on this machine, so the
  // list says what will run (the hardware swap used to be invisible, and
  // in 2.7.0 it ran the archive presets at the wrong quality).
  const [runsAs, setRunsAs] = useState<Record<string, { encoder: string | null; hardware: boolean }>>({})
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    const all = [...builtinPresets, ...importedPresets].filter(p => /-c:v\s+(?!copy)/.test(p.ffmpegArgs))
    Promise.all(all.map(p => window.api.describeEncoder(p.ffmpegArgs).then(r => [p.id, r] as const).catch(() => null)))
      .then(entries => {
        if (cancelled) return
        const next: Record<string, { encoder: string | null; hardware: boolean }> = {}
        for (const e of entries) if (e) next[e[0]] = { encoder: e[1].encoder, hardware: e[1].hardware }
        setRunsAs(next)
      })
    return () => { cancelled = true }
  }, [isOpen, builtinPresets, importedPresets])

  const encoderLabel = (encoder: string): string => {
    const family = /av1/.test(encoder) ? 'AV1' : /hevc|265/.test(encoder) ? 'H.265' : /h264|264/.test(encoder) ? 'H.264' : encoder
    if (encoder.endsWith('_nvenc')) return `NVIDIA NVENC ${family} (hardware)`
    if (encoder.endsWith('_amf')) return `AMD AMF ${family} (hardware)`
    if (encoder.endsWith('_qsv')) return `Intel Quick Sync ${family} (hardware)`
    if (encoder === 'libsvtav1') return 'SVT-AV1 on the CPU'
    if (encoder === 'libaom-av1') return 'libaom AV1 on the CPU'
    if (encoder === 'libx265') return 'x265 on the CPU'
    if (encoder === 'libx264') return 'x264 on the CPU'
    return encoder
  }

  const handleSave = async (preset: ConversionPreset) => {
    await onSavePreset(preset)
    setEditingId(null)
  }

  const renderRow = (p: ConversionPreset, editable: boolean) => {
    if (editingId === p.id) {
      return (
        <div key={p.id}>
          <PresetEditorForm editing={p} onSave={handleSave} onCancel={() => setEditingId(null)} />
        </div>
      )
    }
    const isDefault = defaultId === p.id
    const isArchive = archiveId === p.id
    const isRecommended = recommendedId === p.id
    return (
      <div key={p.id} className="flex items-start justify-between gap-3 px-4 py-3 rounded-lg bg-white/[0.03] border border-white/5">
        <div className="min-w-0 flex-1 flex items-start gap-2">
          <div className="flex items-center gap-0.5 mt-0.5 shrink-0">
            <Tooltip content={isDefault ? 'Default for new conversions (click to clear)' : 'Set as default for new conversions'} side="top">
              <button
                type="button"
                onClick={() => updateConfig({ defaultConversionPresetId: isDefault ? '' : p.id })}
                className={`p-1 rounded transition-colors ${isDefault ? 'text-amber-400 hover:text-amber-300' : 'text-gray-500 hover:text-gray-300'}`}
              >
                <Star size={13} fill={isDefault ? 'currentColor' : 'none'} />
              </button>
            </Tooltip>
            <Tooltip content={isArchive ? 'Default for archiving streams (click to clear)' : 'Set as default for archiving streams'} side="top">
              <button
                type="button"
                onClick={() => updateConfig({ archivePresetId: isArchive ? '' : p.id })}
                className={`p-1 rounded transition-colors ${isArchive ? 'text-accent-400 hover:text-accent-300' : 'text-gray-500 hover:text-gray-300'}`}
              >
                <Archive size={13} />
              </button>
            </Tooltip>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium text-gray-200 truncate">{p.name}</p>
              {isRecommended && (
                <Tooltip content="Recommended for your system" side="top">
                  <span><ThumbsUp size={11} className="text-emerald-400 shrink-0" /></span>
                </Tooltip>
              )}
            </div>
            {p.description && <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{p.description}</p>}
            {runsAs[p.id]?.encoder && (
              <p className="text-xs text-gray-400 mt-0.5">
                Runs on this PC as <span className="text-gray-300">{encoderLabel(runsAs[p.id].encoder!)}</span>
              </p>
            )}
          </div>
        </div>
        {editable && (
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" onClick={() => setEditingId(p.id)}>Edit</Button>
            <button onClick={() => onDeletePreset(p.id)} className="p-1.5 rounded text-gray-400 hover:text-red-400 transition-colors">
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Conversion Presets" width="2xl">
      <div className="h-[580px] overflow-y-auto -mx-6 px-6 flex flex-col gap-5">
        <p className="text-xs text-gray-400 leading-relaxed">
          Mark a preset as the <Star size={11} className="inline -mt-0.5 text-amber-400" fill="currentColor" /> default for new
          conversions, or the <Archive size={11} className="inline -mt-0.5 text-accent-400" /> default for archiving streams.
          The <ThumbsUp size={11} className="inline -mt-0.5 text-emerald-400" /> badge marks the encoder we recommend for this machine.
        </p>

        {/* Built-in presets */}
        <section className="flex flex-col gap-2">
          <h3 className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold px-1">Built-in</h3>
          {builtinPresets.map(p => renderRow(p, false))}
        </section>

        {/* Custom / imported presets */}
        <section className="flex flex-col gap-2">
          <h3 className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold px-1">Custom &amp; imported</h3>
          {importedPresets.length === 0 && editingId !== '__new__' && (
            <p className="text-xs text-gray-400 italic px-1">No custom presets yet.</p>
          )}
          {importedPresets.map(p => renderRow(p, true))}

          {editingId === '__new__' ? (
            <PresetEditorForm onSave={handleSave} onCancel={() => setEditingId(null)} />
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="secondary" size="sm" icon={<Plus size={13} />} onClick={() => setEditingId('__new__')}>
                New custom preset
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={importing ? <RefreshCw size={13} className="animate-spin" /> : <Upload size={13} />}
                onClick={onImport}
                disabled={importing}
              >
                Import HandBrake JSON
              </Button>
            </div>
          )}
          {importError && <p className="text-xs text-red-400 px-1">{importError}</p>}
        </section>
      </div>
    </Modal>
  )
}
