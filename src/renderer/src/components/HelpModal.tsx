import React, { useState } from 'react'
import { Radio, Film, Zap, Combine, Image as ImageIcon, Rocket, Plug, Shuffle, Scissors, Archive, Tag, Hash, MessageSquare, PencilLine, FolderOpen, CalendarClock, Trash2, Keyboard } from 'lucide-react'
import { Youtube } from './ui/BrandIcons'
import { Modal } from './ui/Modal'
import { useStore } from '../hooks/useStore'

function ElementSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-gray-200">
        <span className="text-purple-300 shrink-0">{icon}</span>
        <h4 className="text-sm font-semibold">{title}</h4>
      </div>
      <div className="text-[13px] text-gray-400 leading-relaxed pl-6 [&_p]:m-0 flex flex-col gap-2">
        {children}
      </div>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.4rem] h-[1.4rem] px-1.5 rounded border border-white/10 bg-white/5 font-mono text-[11px] text-gray-200 leading-none shrink-0">
      {children}
    </kbd>
  )
}

function ShortcutRow({ keys, label }: { keys: React.ReactNode[]; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 shrink-0">
        {keys.map((k, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="text-gray-600">+</span>}
            <Kbd>{k}</Kbd>
          </React.Fragment>
        ))}
      </div>
      <span className="text-[13px] text-gray-400">{label}</span>
    </div>
  )
}

function ShortcutGroup({ title, rows }: { title: string; rows: { keys: React.ReactNode[]; label: string }[] }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{title}</div>
      <div className="flex flex-col gap-1">
        {rows.map((r, i) => <ShortcutRow key={i} keys={r.keys} label={r.label} />)}
      </div>
    </div>
  )
}

type HelpKey =
  | 'streams' | 'player' | 'converter' | 'combine'
  | 'thumbnails' | 'launcher' | 'integrations' | 'rules'

interface HelpItem {
  id: HelpKey
  label: string
  icon: React.ReactNode
  body: React.ReactNode
}

function getItems(isDumpMode: boolean): HelpItem[] {
  return [
  {
    id: 'streams',
    label: 'Streams',
    icon: <Radio size={16} />,
    body: (
      <>
        <p>The Streams page is the home view — every stream session you've recorded shows up as a row or card. Each stream item is made up of the following elements:</p>

        <ElementSection icon={<ImageIcon size={14} />} title="Thumbnail">
          <p>Stream Manager automatically detects images related to the stream and picks the best one to represent it (typically the first available). Click the thumbnail to view all images {isDumpMode ? 'matching this date in the dump folder' : 'in the stream folder'} and select a different one. The same selection can be made while editing an item's metadata.</p>
        </ElementSection>

        <ElementSection icon={<Film size={14} />} title="Video Counter">
          <p>Shows how many videos belong to the stream item, split into two counters by category:</p>
          <ul className="list-none pl-0 flex flex-col gap-1">
            <li className="flex items-baseline gap-2"><Film size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">vid</strong> — full recordings (the original stream or full gameplay video).</span></li>
            <li className="flex items-baseline gap-2"><Scissors size={11} className="shrink-0 text-blue-400 translate-y-0.5" /><span><strong className="text-gray-300">clip</strong> — short edited segments derived from the full video, plus any related shorter videos.</span></li>
            <li className="flex items-baseline gap-2"><Scissors size={11} className="shrink-0 text-blue-400 translate-y-0.5" /><span><strong className="text-gray-300">short</strong> — vertical-aspect edited clips intended for social platforms (counted with clips).</span></li>
          </ul>
          <p>Hover the counter for a per-file breakdown.</p>
        </ElementSection>

        <ElementSection icon={<Archive size={14} />} title="Status Badges">
          <p>A row of small badges surfaces the stream's status at a glance:</p>
          <ul className="list-none pl-0 flex flex-col gap-1">
            <li className="flex items-baseline gap-2"><Archive size={11} className="shrink-0 text-green-400 translate-y-0.5" /><span><strong className="text-gray-300">Archived</strong> — the stream's videos have been compressed via the archive process.</span></li>
            <li className="flex items-baseline gap-2"><Radio size={11} className="shrink-0 text-teal-400 translate-y-0.5" /><span><strong className="text-gray-300">Upcoming</strong> — the stream is scheduled but hasn't aired yet.</span></li>
            <li className="flex items-baseline gap-2"><Youtube size={11} className="shrink-0 text-red-400 translate-y-0.5" /><span><strong className="text-gray-300">YouTube</strong> — there's a connected YouTube post (livestream VOD or regular video). A second icon next to the radio or YouTube glyph indicates the post's privacy/availability (public, unlisted, private).</span></li>
          </ul>
        </ElementSection>

        <ElementSection icon={<Tag size={14} />} title="Type Tags">
          <p>Used to categorize the stream however you like (or not at all). Create new tags inline when you create or edit a stream, or via the <strong className="text-gray-300">Manage Tags</strong> button on the Streams page. Tags can be styled with different colors and textures to distinguish them at a glance.</p>
        </ElementSection>

        <ElementSection icon={<Hash size={14} />} title="Topics / Games">
          <p>Further detail about what the stream covered. Like Type Tags, you can create new ones on the fly while creating or editing a stream, or through the <strong className="text-gray-300">Manage Tags</strong> button.</p>
        </ElementSection>

        <ElementSection icon={<MessageSquare size={14} />} title="Comments">
          <p>Free-form notes for anything the other fields don't cover. Edit a stream item with the <PencilLine size={11} className="inline align-baseline -translate-y-px" /> action button to add or update comments.</p>
        </ElementSection>

        <ElementSection icon={<Zap size={14} />} title="Action Buttons">
          <p>Hover over a stream item to reveal its actions:</p>
          <ul className="list-none pl-0 flex flex-col gap-1">
            <li className="flex items-baseline gap-2"><Film size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Send to Player</strong> — open the stream's video in the Player page for review or clipping.</span></li>
            <li className="flex items-baseline gap-2"><Zap size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Send to Converter</strong> — queue the stream's video for conversion using a chosen preset.</span></li>
            <li className="flex items-baseline gap-2"><Combine size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Combine videos</strong> — merge multi-part recordings into one file (only shown when there are 2+ videos).</span></li>
            <li className="flex items-baseline gap-2"><ImageIcon size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Create / Edit thumbnail</strong> — open the built-in thumbnail editor for this stream.</span></li>
            <li className="flex items-baseline gap-2"><PencilLine size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Edit / Add metadata</strong> — open the metadata modal to set title, episode info, comments, tags, and broadcast links.</span></li>
            <li className="flex items-baseline gap-2"><FolderOpen size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Open folder</strong> — reveal the stream's folder in your OS file explorer.</span></li>
            <li className="flex items-baseline gap-2"><CalendarClock size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Reschedule</strong> — change the date of an upcoming stream (only shown for upcoming items).</span></li>
            <li className="flex items-baseline gap-2"><Trash2 size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Delete</strong> — remove the stream item and its files. You'll be asked to confirm.</span></li>
          </ul>
        </ElementSection>
      </>
    ),
  },
  {
    id: 'player',
    label: 'Player',
    icon: <Film size={16} />,
    body: (
      <>
        <p>The Player is for reviewing and clipping. Scrub through a recording, set in/out points to mark clip regions, add bleeps over moments you want muted, and crop with a chosen aspect ratio (16:9, 1:1, 9:16).</p>
        <p>The Session Videos panel keeps related files (clip drafts, exports, alternate takes) one click away. Clip drafts autosave so you can leave and come back later.</p>

        <ElementSection icon={<Keyboard size={14} />} title="Keyboard shortcuts">
          <p className="text-[11px] text-gray-500">Active anywhere on the Player page (except while typing in a text field).</p>

          <ShortcutGroup title="Playback" rows={[
            { keys: ['Space'], label: 'Play / pause' },
            { keys: ['K'], label: 'Play / pause (alt)' },
            { keys: ['J'], label: 'Skip back 10s' },
            { keys: ['L'], label: 'Skip forward 10s' },
            { keys: ['←'], label: 'Previous frame' },
            { keys: ['→'], label: 'Next frame' },
            { keys: ['Shift', '←/→'], label: 'Skip ±1s' },
            { keys: ['Ctrl', '←/→'], label: 'Skip ±5s' },
            { keys: ['Ctrl', 'Shift', '←/→'], label: 'Skip ±10s' },
            { keys: ['Home'], label: 'Seek to start' },
            { keys: ['End'], label: 'Seek to end' },
          ]} />

          <ShortcutGroup title="Timeline & view" rows={[
            { keys: ['T'], label: 'Edit playhead timecode' },
            { keys: ['0'], label: 'Reset zoom' },
            { keys: ['Numpad +'], label: 'Zoom in (anchored on playhead)' },
            { keys: ['Numpad -'], label: 'Zoom out (anchored on playhead)' },
            { keys: ['Middle-click drag'], label: 'Pan timeline' },
            { keys: ['Double middle-click'], label: 'Reset pan' },
            { keys: ['F'], label: 'Toggle clip-region focus' },
            { keys: ['P'], label: 'Toggle pop-out video' },
            { keys: ['C'], label: 'Toggle clip mode' },
            { keys: ['Esc'], label: 'Close current session' },
          ]} />

          <ShortcutGroup title="File & capture" rows={[
            { keys: ['Ctrl', 'O'], label: 'Open video file' },
            { keys: ['Ctrl', 'Shift', 'S'], label: 'Capture screenshot' },
            { keys: ['Ctrl', 'Alt', '↑/↓'], label: 'Previous / next session item' },
          ]} />

          <ShortcutGroup title="Clip mode" rows={[
            { keys: ['A'], label: 'Add segment at playhead' },
            { keys: ['S'], label: 'Split segment at playhead' },
            { keys: ['B'], label: 'Add bleep at playhead' },
            { keys: ['['], label: 'Jump to previous in/out marker' },
            { keys: [']'], label: 'Jump to next in/out marker' },
            { keys: ['Delete'], label: 'Delete selected segment or bleep' },
            { keys: ['Ctrl', 'E'], label: 'Open Export Clip dialog' },
          ]} />
        </ElementSection>
      </>
    ),
  },
  {
    id: 'converter',
    label: 'Converter',
    icon: <Zap size={16} />,
    body: (
      <>
        <p>Convert video files using built-in or imported HandBrake/ffmpeg presets. Common presets include YouTube-ready H.264, archive AV1/H.265, and audio-only extraction.</p>
        <p>Jobs queue up sequentially. You can pause, resume, or cancel a running conversion. If you cancel, the partial output can be auto-deleted.</p>
      </>
    ),
  },
  {
    id: 'combine',
    label: 'Combine',
    icon: <Combine size={16} />,
    body: (
      <>
        <p>Stitch multi-part recordings into a single file — useful when OBS splits a long stream across multiple files, or when you want to merge separate audio tracks back into the video.</p>
        <p>Audio and video sync are preserved using the original timestamps.</p>
      </>
    ),
  },
  {
    id: 'thumbnails',
    label: 'Thumbnails',
    icon: <ImageIcon size={16} />,
    body: (
      <>
        <p>The Thumbnail Editor is a Konva-based canvas (1280×720) for designing per-stream thumbnails. Build templates from images, text, and shapes; save them so they can be reused across streams.</p>
        <p>When the editor opens for a stream, it auto-loads the template you selected at stream creation as a starting point. Save once to produce the PNG that appears in the Streams view.</p>
      </>
    ),
  },
  {
    id: 'launcher',
    label: 'Launcher',
    icon: <Rocket size={16} />,
    body: (
      <>
        <p>Save groups of apps, windows, or URLs and launch them all in one click. Useful for spinning up your full streaming setup (OBS, Discord, capture software, browser tabs) before going live.</p>
        <p>Pin a group to the sidebar widget for one-click launch.</p>
      </>
    ),
  },
  {
    id: 'integrations',
    label: 'Integrations',
    icon: <Plug size={16} />,
    body: (
      <>
        <p>Connect YouTube, Twitch, and Claude AI. With YouTube connected, you can pull broadcast and VOD info onto a stream's metadata, and push title/description/tag updates back. Twitch syncs go-live title and category.</p>
        <p>Claude (optional) helps draft titles, descriptions, and tags from the stream's metadata. All API keys are stored locally.</p>
      </>
    ),
  },
  {
    id: 'rules',
    label: 'Auto-Rules',
    icon: <Shuffle size={16} />,
    body: (
      <>
        <p>Auto-Rules watch a folder and automatically move, copy, rename, or convert new files matching a glob pattern. Common setup: watch your OBS recordings folder and route files {isDumpMode ? 'into your dump folder' : 'into the matching dated stream folder'}.</p>
        <p>Rules can also queue up conversions automatically (e.g. archive every new recording with an AV1 preset).</p>
      </>
    ),
  },
  ]
}

export function HelpModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [active, setActive] = useState<HelpKey>('streams')
  const { config } = useStore()
  const isDumpMode = config.streamMode === 'dump-folder'
  const items = getItems(isDumpMode)
  const item = items.find(i => i.id === active) ?? items[0]

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="How to use Stream Manager" width="2xl">
      <div className="flex gap-4 items-stretch h-[65vh]">
        {/* Sidebar nav */}
        <nav className="w-44 shrink-0 flex flex-col gap-0.5 border-r border-white/5 pr-2 overflow-y-auto">
          {items.map(i => {
            const isActive = i.id === active
            return (
              <button
                key={i.id}
                onClick={() => setActive(i.id)}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm transition-colors text-left ${
                  isActive
                    ? 'bg-purple-700/30 text-purple-200 border border-purple-700/40'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-white/5 border border-transparent'
                }`}
              >
                <span className={isActive ? 'text-purple-300' : 'text-gray-500'}>{i.icon}</span>
                <span>{i.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0 flex flex-col gap-3 text-sm text-gray-400 leading-relaxed [&_p]:m-0 overflow-y-auto pr-2">
          <div className="flex items-center gap-2 text-gray-200">
            <span className="text-purple-300">{item.icon}</span>
            <h3 className="text-base font-semibold">{item.label}</h3>
          </div>
          <div className="flex flex-col gap-3">
            {item.body}
          </div>
        </div>
      </div>
    </Modal>
  )
}
