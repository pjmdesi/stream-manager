import React, { useState, useEffect, useMemo } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Slider } from '../ui/Slider'
import type { ConversionPreset, CustomPresetForm } from '../../types'
import { v4 as uuidv4 } from 'uuid'
import { buildFfmpegArgs, resolveQuality, PROBE_ENCODERS, pickBestEncoder, computeQualityStops, snapQualityToStop } from './presetArgs'

interface Props {
  isOpen: boolean
  onClose: () => void
  /** Called with the saved preset when the user clicks Save. The caller is
   *  responsible for the actual storage IPC + refreshing its list. */
  onSave: (preset: ConversionPreset) => void
  /** Pass to open the modal in edit mode. Form fields prefill from the
   *  preset's customForm; if the preset doesn't have one (e.g. raw or
   *  imported), only the Advanced view is available. */
  editing?: ConversionPreset | null
}

const DEFAULT_FORM: CustomPresetForm = {
  container: 'mp4',
  video: { codec: 'h265', encoder: 'cpu', quality: 75 },
  audio: { codec: 'aac', bitrate: 128, channels: 'original' },
}

const ENCODER_LABELS: Record<string, string> = {
  cpu:   'CPU (software)',
  nvenc: 'NVIDIA (NVENC)',
  qsv:   'Intel (QSV)',
  amf:   'AMD (AMF)',
}

const CODEC_LABELS: Record<string, string> = {
  h264: 'H.264 (most compatible)',
  h265: 'H.265 / HEVC (better compression)',
  av1:  'AV1 (best compression, slower)',
  copy: 'Match original (copy)',
}

const AUDIO_CODEC_LABELS: Record<string, string> = {
  aac:  'AAC',
  mp3:  'MP3',
  opus: 'Opus',
  copy: 'Match original (copy)',
  none: 'None (no audio)',
}

const CONTAINER_LABELS: Record<string, string> = {
  mp4:  'MP4 (most compatible)',
  mkv:  'MKV (recommended for archive)',
  mov:  'MOV',
  webm: 'WebM',
}

const BITRATE_OPTIONS = [96, 128, 192, 256, 320]

export function PresetEditorModal({ isOpen, onClose, onSave, editing }: Props) {
  // ── Form state ──────────────────────────────────────────────────────────
  const initialForm: CustomPresetForm = editing?.customForm ?? DEFAULT_FORM
  const [name, setName] = useState(editing?.name ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [form, setForm] = useState<CustomPresetForm>(initialForm)

  // Advanced mode: when enabled, the user is editing the raw ffmpeg args
  // directly. The form fields are disabled and the saved preset has no
  // customForm (so re-opening it shows Advanced too).
  const [advancedMode, setAdvancedMode] = useState(
    !!editing && !editing.customForm  // open Advanced for raw / HandBrake imports
  )
  const [advancedExpanded, setAdvancedExpanded] = useState(advancedMode)
  const [rawArgs, setRawArgs] = useState(editing?.ffmpegArgs ?? '')

  // ── Encoder availability ────────────────────────────────────────────────
  // Hardware-probed (not just "compiled into the binary") — main process
  // invokes each GPU encoder against a synthetic frame and reports which
  // ones actually work. Result is cached in main for the session, AND
  // pre-warmed at app startup, so by the time the user opens the modal
  // it's almost always instant. We still wait for the result before
  // rendering the encoder dropdown so the UI doesn't flash CPU→NVIDIA on
  // a cold cache. CPU is always assumed available.
  const [availableEncoders, setAvailableEncoders] = useState<Set<string>>(
    new Set(['h264_cpu', 'h265_cpu', 'av1_cpu'])
  )
  const [encodersReady, setEncodersReady] = useState(false)
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setEncodersReady(false)
    window.api.detectAvailableEncoders().then(names => {
      if (cancelled) return
      const next = new Set(['h264_cpu', 'h265_cpu', 'av1_cpu'])
      // Convert the encoder ffmpeg-name list back into our codec_encoder keys.
      for (const probe of PROBE_ENCODERS) {
        if (names.includes(probe.name)) next.add(`${probe.codec}_${probe.encoder}`)
      }
      setAvailableEncoders(next)
      setEncodersReady(true)
    }).catch(() => { setEncodersReady(true) })
    return () => { cancelled = true }
  }, [isOpen])

  // Track whether the currently-selected encoder is the auto-pick (true) or
  // a user override (false). Drives the "Auto-picked best available" hint
  // text below the dropdown so the user knows what just happened. Starts
  // true for new presets, false for edits (we respect the saved choice).
  const [encoderAutoPicked, setEncoderAutoPicked] = useState(!editing)

  // Auto-pick the best available encoder when the codec changes (or when
  // availability finishes loading on first open). NVENC > QSV > AMF > CPU.
  // Skipped when editing an existing preset — respect the saved choice.
  useEffect(() => {
    if (form.video.codec === 'copy') return
    if (editing) return
    const best = pickBestEncoder(form.video.codec as any, availableEncoders)
    if (best !== form.video.encoder) {
      setForm(f => ({ ...f, video: { ...f.video, encoder: best } }))
    }
    setEncoderAutoPicked(true)
    // Intentionally omitting form.video.encoder so manually changing the
    // encoder doesn't immediately bounce back. The auto-pick re-fires on
    // the next codec change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.video.codec, availableEncoders, editing])

  // Even when editing or after a manual user pick, make sure the chosen
  // encoder is actually in the available set. If not (e.g. user opened a
  // preset authored on a different machine), fall back to CPU.
  useEffect(() => {
    if (form.video.codec === 'copy') return
    const key = `${form.video.codec}_${form.video.encoder}`
    if (!availableEncoders.has(key)) {
      setForm(f => ({ ...f, video: { ...f.video, encoder: 'cpu' } }))
    }
  }, [form.video.codec, form.video.encoder, availableEncoders])

  // Quality slider stops — only the positions where the encoder's output
  // actually changes (CRF or preset). Snapping to these makes every nudge
  // produce a visible difference instead of dead zones.
  const qualityStops = useMemo(() => {
    if (form.video.codec === 'copy') return [0, 100]
    return computeQualityStops(form.video.codec as any, form.video.encoder)
  }, [form.video.codec, form.video.encoder])

  // After encoder/codec changes, the current quality might land between stops.
  // Re-snap so the displayed % matches a real stop.
  useEffect(() => {
    if (form.video.codec === 'copy') return
    const snapped = snapQualityToStop(qualityStops, form.video.quality)
    if (snapped !== form.video.quality) {
      setForm(f => ({ ...f, video: { ...f.video, quality: snapped } }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qualityStops])

  // ── Live preview of compiled ffmpeg args ────────────────────────────────
  const compiled = useMemo(() => {
    if (advancedMode) return { args: rawArgs, outputExtension: form.container }
    return buildFfmpegArgs(form)
  }, [form, rawArgs, advancedMode])

  const resolvedQuality = useMemo(() => {
    if (advancedMode || form.video.codec === 'copy') return null
    return resolveQuality(form.video.codec as any, form.video.encoder, form.video.quality)
  }, [form, advancedMode])

  // Sync rawArgs <- compiled args whenever the form changes AND we're not in
  // advanced mode (so toggling Advanced reveals the current form's output).
  useEffect(() => {
    if (advancedMode) return
    if (compiled) setRawArgs(compiled.args)
  }, [compiled, advancedMode])

  // ── Save ────────────────────────────────────────────────────────────────
  const canSave = name.trim().length > 0 && (compiled?.args ?? '').trim().length > 0

  const handleSave = () => {
    if (!canSave || !compiled) return
    const preset: ConversionPreset = {
      id: editing?.id ?? `custom-${uuidv4()}`,
      name: name.trim(),
      description: description.trim() || undefined,
      ffmpegArgs: compiled.args,
      outputExtension: compiled.outputExtension,
      isBuiltin: false,
      source: 'custom',
      customForm: advancedMode ? undefined : form,
    }
    onSave(preset)
  }

  // ── Helpers for available-encoder dropdowns ─────────────────────────────
  const encodersForCodec = (codec: 'h264' | 'h265' | 'av1'): Array<'cpu' | 'nvenc' | 'qsv' | 'amf'> => {
    return (['cpu', 'nvenc', 'qsv', 'amf'] as const).filter(e => availableEncoders.has(`${codec}_${e}`))
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editing ? 'Edit custom preset' : 'New custom preset'}
      width="2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={!canSave}>
            Save preset
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 max-h-[70vh] overflow-y-auto pr-2">
        {/* ── General ───────────────────────────────────────────────── */}
        <Section title="General">
          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. YouTube 1080p"
              className="w-full bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            />
          </Field>
          <Field label="Description" optional>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What is this preset for?"
              className="w-full bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            />
          </Field>
          <Field label="Output container">
            <SelectMenu
              value={form.container}
              onChange={v => setForm(f => ({ ...f, container: v as any }))}
              disabled={advancedMode}
              options={(['mp4', 'mkv', 'mov', 'webm'] as const).map(c => ({ value: c, label: CONTAINER_LABELS[c] }))}
            />
          </Field>
        </Section>

        {/* ── Video ─────────────────────────────────────────────────── */}
        <Section title="Video">
          <Field label="Codec">
            <SelectMenu
              value={form.video.codec}
              onChange={v => setForm(f => ({ ...f, video: { ...f.video, codec: v as any } }))}
              disabled={advancedMode}
              options={(['h264', 'h265', 'av1', 'copy'] as const).map(c => ({ value: c, label: CODEC_LABELS[c] }))}
            />
          </Field>

          {form.video.codec !== 'copy' && (
            <>
              <Field label="Encoder">
                <div className="flex flex-col gap-1">
                  {encodersReady ? (
                    <SelectMenu
                      value={form.video.encoder}
                      onChange={v => {
                        setEncoderAutoPicked(false)
                        setForm(f => ({ ...f, video: { ...f.video, encoder: v as any } }))
                      }}
                      disabled={advancedMode}
                      options={encodersForCodec(form.video.codec).map(e => ({ value: e, label: ENCODER_LABELS[e] }))}
                    />
                  ) : (
                    <div className="w-full bg-navy-900/50 border border-white/10 text-gray-500 text-sm rounded-lg px-3 py-2 italic">
                      Detecting available encoders…
                    </div>
                  )}
                  {encodersReady && encoderAutoPicked && encodersForCodec(form.video.codec).length > 1 && (
                    <p className="text-[11px] text-gray-500 italic">
                      Auto-picked the best available encoder for {CODEC_LABELS[form.video.codec].split(' ')[0]} on this machine.
                    </p>
                  )}
                </div>
              </Field>

              <Field label="Quality">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-gray-500 w-12 shrink-0">Lower</span>
                    <Slider
                      value={form.video.quality}
                      min={0}
                      max={100}
                      step={1}
                      onChange={v => {
                        const snapped = snapQualityToStop(qualityStops, v)
                        setForm(f => ({ ...f, video: { ...f.video, quality: snapped } }))
                      }}
                      className="flex-1"
                    />
                    <span className="text-[10px] text-gray-500 w-12 shrink-0 text-right">Higher</span>
                    <span className="text-xs text-gray-300 tabular-nums w-10 text-right">{form.video.quality}%</span>
                  </div>
                  {resolvedQuality && !advancedMode && (
                    <p className="text-[11px] text-gray-500">
                      <span className="text-gray-400">{resolvedQuality.speedLabel}</span>
                      <span className="text-gray-600"> · </span>
                      CRF {resolvedQuality.qualityValue}, preset <span className="font-mono">{resolvedQuality.presetValue}</span>
                      <span className="text-gray-600"> · </span>
                      slower presets compress better at the same quality
                    </p>
                  )}
                </div>
              </Field>
            </>
          )}
        </Section>

        {/* ── Audio ─────────────────────────────────────────────────── */}
        <Section title="Audio">
          <Field label="Codec">
            <SelectMenu
              value={form.audio.codec}
              onChange={v => setForm(f => ({ ...f, audio: { ...f.audio, codec: v as any } }))}
              disabled={advancedMode}
              options={(['aac', 'mp3', 'opus', 'copy', 'none'] as const).map(c => ({ value: c, label: AUDIO_CODEC_LABELS[c] }))}
            />
          </Field>

          {(form.audio.codec === 'aac' || form.audio.codec === 'mp3' || form.audio.codec === 'opus') && (
            <>
              <Field label="Bitrate">
                <SelectMenu
                  value={String(form.audio.bitrate)}
                  onChange={v => setForm(f => ({ ...f, audio: { ...f.audio, bitrate: parseInt(v, 10) } }))}
                  disabled={advancedMode}
                  options={BITRATE_OPTIONS.map(b => ({ value: String(b), label: `${b} kbps` }))}
                />
              </Field>
              <Field label="Channels">
                <SelectMenu
                  value={form.audio.channels}
                  onChange={v => setForm(f => ({ ...f, audio: { ...f.audio, channels: v as any } }))}
                  disabled={advancedMode}
                  options={[
                    { value: 'original', label: 'Original (keep input layout)' },
                    { value: 'stereo',   label: 'Stereo' },
                    { value: 'mono',     label: 'Mono' },
                  ]}
                />
              </Field>
            </>
          )}

          {form.audio.codec !== 'none' && (
            <label className={`flex items-start gap-2 text-xs cursor-pointer ${advancedMode ? 'opacity-50 cursor-not-allowed' : ''}`}>
              <input
                type="checkbox"
                checked={!!form.audio.keepAllTracks}
                disabled={advancedMode}
                onChange={e => setForm(f => ({ ...f, audio: { ...f.audio, keepAllTracks: e.target.checked } }))}
                className="accent-purple-500 mt-0.5"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-gray-300">Keep all audio tracks</span>
                <span className="text-[11px] text-gray-500 leading-relaxed">
                  Preserve every audio track in the input (game / mic / music etc.) instead of just the first.
                  Useful for OBS multi-track recordings.
                </span>
              </span>
            </label>
          )}
        </Section>

        {/* ── Advanced (raw args) ───────────────────────────────────── */}
        <div className="flex flex-col gap-2 pt-2 border-t border-white/5">
          <button
            type="button"
            onClick={() => setAdvancedExpanded(e => !e)}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors self-start"
          >
            {advancedExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Advanced (raw ffmpeg args)
          </button>
          {advancedExpanded && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-gray-500 italic">
                {advancedMode
                  ? 'Editing the raw args. The form fields above are disabled.'
                  : 'Auto-generated from the form above. Toggle "Edit raw" to override and disable the form.'}
              </p>
              <textarea
                value={rawArgs}
                readOnly={!advancedMode}
                onChange={e => setRawArgs(e.target.value)}
                rows={3}
                className={`w-full font-mono text-xs rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 focus:ring-purple-500/50 ${
                  advancedMode
                    ? 'bg-navy-900 border-white/10 text-gray-200'
                    : 'bg-navy-900/50 border-white/5 text-gray-400 cursor-default'
                }`}
              />
              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={advancedMode}
                  onChange={e => setAdvancedMode(e.target.checked)}
                  className="accent-purple-500"
                />
                Edit raw args (disables form)
              </label>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ── Internal layout helpers ────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{title}</h3>
      <div className="flex flex-col gap-3">
        {children}
      </div>
    </section>
  )
}

function Field({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-400">
        {label}
        {optional && <span className="text-gray-600"> · optional</span>}
      </label>
      {children}
    </div>
  )
}

function SelectMenu({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="w-full appearance-none bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
    </div>
  )
}
