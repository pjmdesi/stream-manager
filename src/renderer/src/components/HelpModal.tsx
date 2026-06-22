import React, { useState } from 'react'
import { Radio, Film, Zap, Combine, Image as ImageIcon, Rocket, Plug, Shuffle, Scissors, Archive, Tag, Hash, MessageSquare, PencilLine, FolderOpen, CalendarClock, Trash2, Keyboard, PanelRight, Layers, Play, AlertTriangle, Upload, Cloud, TrendingUpDown, LayoutGrid, Type, Braces, Star, Link2, CopyPlus, CloudDownload, SquareDashedText, Bot, Bookmark, Maximize2 } from 'lucide-react'
import { Youtube, Twitch } from './ui/BrandIcons'
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
            {i > 0 && <span className="text-gray-400">+</span>}
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
      <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{title}</div>
      <div className="flex flex-col gap-1">
        {rows.map((r, i) => <ShortcutRow key={i} keys={r.keys} label={r.label} />)}
      </div>
    </div>
  )
}

type HelpKey =
  | 'streams' | 'shortcuts' | 'player' | 'converter' | 'combine'
  | 'thumbnails' | 'launcher' | 'integrations' | 'rules' | 'widgets'

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
        <p>The Streams page shows a list of stream items stacked as rows sorted by date (descending) by default. Upcoming streams are steams scheduled for a future date and are colored teal. Streams happening on the current day are colored blue. Each stream item row is made up of the following elements:</p>

        <ElementSection icon={<ImageIcon size={14} />} title="Thumbnail">
          <p>Stream Manager picks the best image to represent a stream item (typically the first available that matches certain criteria). To choose a different one, open the details sidebar and use the <strong className="text-gray-300">Media files</strong> section — set any image as the thumbnail there, or click it to browse every image full screen.</p>
        </ElementSection>

        <ElementSection icon={<Film size={14} />} title="Video Counter">
          <p>Shows how many videos belong to the stream item, split into two counts by category based on length and file size:</p>
          <ul className="list-none pl-0 flex flex-col gap-1">
            <li className="flex items-baseline gap-2"><Film size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">vid</strong> — full recordings (the original stream, full gameplay video, or other long-form videos).</span></li>
            <li className="flex items-baseline gap-2"><Scissors size={11} className="shrink-0 text-blue-400 translate-y-0.5" /><span><strong className="text-gray-300">clip</strong> — short edited segments derived from the full video, plus any related shorter videos.</span></li>
            <li className="flex items-baseline gap-2"><Scissors size={11} className="shrink-0 text-blue-400 translate-y-0.5" /><span><strong className="text-gray-300">short</strong> — vertical-aspect edited clips intended for social platforms like YouTube Shorts or reels (counted with clips).</span></li>
          </ul>
          <p>Hover over the counter column for a tooltip that shows a per-file breakdown.</p>
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
          <p>Used to categorize the stream however you like (or not at all). Create new tags on the fly when you create or edit a stream item, or via the <strong className="text-gray-300">Manage Tags</strong> button in the Streams page header. Tags can be customized with different colors and textures to.</p>
        </ElementSection>

        <ElementSection icon={<Hash size={14} />} title="Topics / Games">
          <p>Further detail about what the stream covered. Like Type Tags, you can create new ones on the fly while creating or editing a stream, or through the <strong className="text-gray-300">Manage Tags</strong> button. It's recommended that these tags match topics or games that Twitch uses as categories. When a tag is close to matching one of Twitch's categories, SM will suggest that the tag be updated to match exactly. This tag can be used in the templating system for stream Titles.</p>
        </ElementSection>

        <ElementSection icon={<MessageSquare size={14} />} title="Notes">
          <p>Free-form notes for anything the other fields don't cover. Located at thee bottom of the detail sidebar main content.</p>
        </ElementSection>

        <ElementSection icon={<Zap size={14} />} title="Action Buttons">
          <p>Click a stream item to open the details sidebar — that's where all editing happens. Some action buttons are available on the very right of a stream item row when hovering while the sidebar is closed:</p>
          <ul className="list-none pl-0 flex flex-col gap-1">
            <li className="flex items-baseline gap-2"><Film size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Send to Player</strong> — open the stream's video in the Player page for review or clipping.</span></li>
            <li className="flex items-baseline gap-2"><Zap size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Send to Converter</strong> — queue the stream's video for conversion using a chosen preset.</span></li>
            <li className="flex items-baseline gap-2"><Combine size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Combine videos</strong> — merge multi-part recordings into one file (only shown when there are 2+ videos).</span></li>
            <li className="flex items-baseline gap-2"><ImageIcon size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Create / Edit thumbnail</strong> — open the built-in thumbnail editor for this stream.</span></li>
            <li className="flex items-baseline gap-2"><CopyPlus size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Create New episode</strong> — create a duplicate of the current stream item. Useful for quickly adding new episodes of the current series.</span></li>
            <li className="flex items-baseline gap-2"><Cloud size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Offload files</strong> — "dehydrate" the stream's files (set the files inside the stream folder to be cloud-only through the Windows cloud service).</span></li>
            <li className="flex items-baseline gap-2"><CloudDownload size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Pin files local</strong> — "hydrate" the stream's files (set the files inside the stream folder to be available locally through the Windows cloud service).</span></li>
            <li className="flex items-baseline gap-2"><FolderOpen size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Open folder</strong> — reveal the stream's folder in your OS file explorer.</span></li>
            <li className="flex items-baseline gap-2"><Archive size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Archive Stream</strong> — runs the archiving process for the stream's files. This converts the stream's recording files using the default archive encoding preset (set on the settings page) and, once finished, tags the stream item as archived. This cannot be undone.</span></li>
            <li className="flex items-baseline gap-2"><Trash2 size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Delete</strong> — remove the stream item and all of its files. You'll be asked to confirm.</span></li>
          </ul>
        </ElementSection>

        <ElementSection icon={<LayoutGrid size={14} />} title="Media files">
          <p>The <strong className="text-gray-300">Media</strong> section near the top of the details sidebar lays out media files in the stream's folder: recordings, clips, and images. Use the <em>Video</em> and <em>Images</em> toggles above the grid to show or hide each type.</p>
          <p>Hover a card to reveal its actions:</p>
          <ul className="list-none pl-0 flex flex-col gap-1">
            <li className="flex items-baseline gap-2"><Play size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Send to player</strong> <em>(videos)</em> — open that specific video in the Player page.</span></li>
            <li className="flex items-baseline gap-2"><Zap size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Send to converter</strong> <em>(videos)</em> — queue that one video for conversion.</span></li>
            <li className="flex items-baseline gap-2"><Bookmark size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Set as item thumbnail</strong> <em>(images)</em> — make that image the stream's thumbnail. The current one wears a filled bookmark tag.</span></li>
            <li className="flex items-baseline gap-2"><PencilLine size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Edit</strong> <em>(thumbnails made with SM)</em> — open the image in the thumbnail editor.</span></li>
            <li className="flex items-baseline gap-2"><Maximize2 size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Open full screen</strong> <em>(images)</em> — click an image to browse all of them in the full-screen carousel.</span></li>
            <li className="flex items-baseline gap-2"><Cloud size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Offload / Pin local</strong> — toggle that single file between cloud-only and on-disk (only while cloud sync is active).</span></li>
            <li className="flex items-baseline gap-2"><Trash2 size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Delete</strong> — send the file to the recycle bin.</span></li>
          </ul>
          <p>Cards are tagged to show a file's role at a glance: a <strong className="text-gray-300">Clip</strong> / <strong className="text-gray-300">Short</strong> tray on edited videos, a bookmark tray on the chosen thumbnail image, and an <Archive size={11} className="inline align-baseline -translate-y-px text-emerald-400" /> <strong className="text-gray-300">Archived</strong> marker on compressed recordings. While cloud sync is active, a cloud icon on each card shows whether the file is on this device or offloaded (a spinner shows until that's confirmed).</p>
        </ElementSection>

        <ElementSection icon={<PanelRight size={14} />} title="Details Sidebar">
          <p>Click any stream item to open the details sidebar — every field is edited inline and autosaves as you go. This sidebar is where you prepare and publish a stream's YouTube &amp; Twitch metadata. A few fields feed the title and description templates as <strong className="text-gray-300">merge fields</strong>:</p>
          <ul className="list-none pl-0 flex flex-col gap-1">
            <li className="flex items-baseline gap-2"><Hash size={11} className="shrink-0 text-purple-300 translate-y-0.5" /><span><strong className="text-gray-300">Topics / Games</strong> — the selected tag is the <em>primary</em> one. It sets the <code>{'{game}'}</code> merge field and the Twitch category by default.</span></li>
            <li className="flex items-baseline gap-2"><PencilLine size={11} className="shrink-0 text-purple-300 translate-y-0.5" /><span><strong className="text-gray-300">Tagline</strong> — a short catchy phrase that sets the <code>{'{tagline}'}</code> merge field. Press <Kbd>Ctrl</Kbd>+<Kbd>Space</Kbd> in the field for an AI suggestion using the stream's details, previous taglines in the series, and your preferences prompt configurable on the integrations page.</span></li>
            <li className="flex items-baseline gap-2"><Layers size={11} className="shrink-0 text-purple-300 translate-y-0.5" /><span><strong className="text-gray-300">Series / Season / Episode</strong> — for a stream series, these set the <code>{'{season}'}</code>, <code>{'{episode}'}</code>, and <code>{'{total_episodes}'}</code> merge fields. Turn off <em>Series</em> for one-off streams or to otherwise opt-out of the series system.</span></li>
          </ul>
        </ElementSection>

        <ElementSection icon={<Type size={14} />} title="Title fields & merge fields">
          <p>The YouTube Title and the Twitch Title (when you uncheck <em>Same as YouTube title</em>) are mini template editors. Type plain text, or insert a <strong className="text-gray-300">merge-field chip</strong> from the <em>Insert</em> row beneath the field. Chips like <code>{'{game}'}</code> or <code>{'{episode}'}</code> are substituted live from the fields above.</p>
          <ul className="list-none pl-0 flex flex-col gap-1.5">
            <li className="flex items-baseline gap-2"><Braces size={11} className="shrink-0 text-purple-300 translate-y-0.5" /><span><strong className="text-gray-300">Preview</strong> — when a title contains merge fields, a preview line shows the final rendered title (exactly what publishes).</span></li>
            <li className="flex items-baseline gap-2"><Hash size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Character counter</strong> — counts the rendered title against the platform limit (100 for YouTube, 140 for Twitch) and turns red when you go over.</span></li>
            <li className="flex items-baseline gap-2"><Braces size={11} className="shrink-0 text-red-400 translate-y-0.5" /><span>A merge field that doesn't apply — e.g. <code>{'{episode}'}</code> on a standalone stream — shows as a red chip. Turn on <em>Series</em> to use it.</span></li>
          </ul>
        </ElementSection>

        <ElementSection icon={<SquareDashedText size={14} />} title="Templates">
          <p>Save reusable Titles, Descriptions, and Tag lists from the <strong className="text-gray-300">Templates</strong> button in the Streams page header. Title &amp; Description templates use the same merge-field chips; tag templates are reusable tag lists.</p>
          <ul className="list-none pl-0 flex flex-col gap-1.5">
            <li>Assign a Titles template from the dropdown above the title field — it fills the field with the template's body and stays <strong className="text-gray-300">bound</strong> (the tab lights up). Hand-editing the field detaches it. The same Titles templates work with both YouTube and Twitch Title fields.</li>
            <li className="flex items-baseline gap-2"><Star size={11} className="shrink-0 text-amber-400 translate-y-0.5" /><span><strong className="text-gray-300">Default tag templates</strong> — star a tag template to auto-fill it onto every new stream (set separately for YouTube and Twitch).</span></li>
            <li className="flex items-baseline gap-2"><Link2 size={11} className="shrink-0 text-blue-400 translate-y-0.5" /><span><strong className="text-gray-300">Linked tags</strong> — in Manage Tags, link a Topic/Game to a tag template so its tags auto-fill whenever you add that topic or game tag to the stream item. Only the primary tag (either the first or manually selected topic/game tag) will be used to fill the tags fields with its linked list if it has one. The Templates dialog can also bulk-bind existing streams whose tags already match a template.</span></li>
          </ul>
        </ElementSection>

        <ElementSection icon={<Youtube size={14} />} title="Publishing to YouTube & Twitch">
          <p>Link a stream to a YouTube broadcast or video from the sidebar footer, then edit its title, description, tags, category, privacy, and scheduled time locally and <strong className="text-gray-300">Push to YouTube</strong> when ready. <strong className="text-gray-300">Pull from YouTube</strong> copies YouTube's current values back onto the stream.</p>
          <p>A colored dot next to a field means it differs from YouTube, and which way it's out of sync:</p>
          <ul className="list-none pl-0 flex flex-col gap-1">
            <li className="flex items-baseline gap-2"><span className="shrink-0 w-2 h-2 rounded-full bg-blue-400" /><span><strong className="text-gray-300">Blue</strong> — you changed it locally; push to update YouTube.</span></li>
            <li className="flex items-baseline gap-2"><span className="shrink-0 w-2 h-2 rounded-full bg-orange-400" /><span><strong className="text-gray-300">Orange</strong> — YouTube has a newer value; pull to update the stream (or push to overwrite YouTube with yours).</span></li>
            <li className="flex items-baseline gap-2"><span className="shrink-0 w-2 h-2 rounded-full bg-gradient-to-br from-blue-400 to-orange-400" /><span><strong className="text-gray-300">Two-tone</strong> — a conflict: both sides changed since the last sync. Pulling overwrites your local edits; pushing overwrites YouTube's.</span></li>
            <li className="flex items-baseline gap-2"><span className="shrink-0 w-2 h-2 rounded-full bg-gray-400" /><span><strong className="text-gray-300">Gray</strong> — the field differs from YouTube but the direction is unknown, because the stream hasn't been synced since per-field tracking was added. Push or pull once to start tracking direction.</span></li>
          </ul>
          <p className="flex items-baseline gap-2"><Twitch size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span>Twitch pushes the title, category, and tags to your channel. <em>Same as YouTube title</em> mirrors the YouTube title; uncheck it to give Twitch its own (also template-aware) title. <em>Same as Topic / Game</em> does the same for the category.</span></p>
          <p>Twitch fields don't show the per-field dots above — Twitch is a single channel state (one title/category/tags at a time) rather than a per-stream object, so there's no per-field direction to track. Instead the <strong className="text-gray-300">Push to Twitch</strong> button simply lights up when your channel doesn't match this stream's values and disables once they're in sync.</p>
        </ElementSection>
      </>
    ),
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    icon: <Keyboard size={16} />,
    body: (
      <>
        <p>Keyboard shortcuts across Stream Manager. None of these fire while a modal dialog is open, and the text-editing ones stand down while you're typing in a field.</p>

        <ElementSection icon={<Keyboard size={14} />} title="Global — any page">
          <ShortcutGroup title="Navigation" rows={[
            { keys: ['Ctrl', '1…6'], label: 'Jump to a page (Streams · Player · Converter · Combine · Thumbnails · Launcher)' },
            { keys: ['Ctrl', 'PageUp / PageDown'], label: 'Cycle to the previous / next page' },
            { keys: ['Ctrl', ','], label: 'Open Settings' },
            { keys: ['?'], label: 'Open this Help' },
          ]} />
          <ShortcutGroup title="Actions" rows={[
            { keys: ['Ctrl', 'L'], label: "Launch the sidebar widget's default launch group" },
          ]} />
        </ElementSection>

        <ElementSection icon={<Radio size={14} />} title="Streams page">
          <ShortcutGroup title="General" rows={[
            { keys: ['Ctrl', 'N'], label: 'New stream' },
            { keys: ['/'], label: 'Focus the search box' },
            { keys: ['Esc'], label: 'Clear search → exit select mode → close the detail sidebar' },
          ]} />
          <ShortcutGroup title="Multi-select" rows={[
            { keys: ['Ctrl', 'Shift', 'A'], label: 'Toggle multi-select mode' },
            { keys: ['Ctrl', 'A'], label: 'Select all visible (press again to clear)' },
          ]} />
          <ShortcutGroup title="With the detail sidebar open" rows={[
            { keys: ['Ctrl', '↑ / ↓'], label: 'Previous / next stream item' },
            { keys: ['Ctrl', 'Shift', '↑ / ↓'], label: 'Previous / next episode in the series' },
            { keys: ['Ctrl', 'Shift', 'N'], label: 'New episode of this stream' },
            { keys: ['Ctrl', 'Shift', 'T'], label: 'Open the thumbnail editor' },
          ]} />
        </ElementSection>

        <ElementSection icon={<Film size={14} />} title="Player">
          <p className="text-[11px] text-gray-400">Active anywhere on the Player page (except while typing in a text field).</p>
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

        <ElementSection icon={<ImageIcon size={14} />} title="Thumbnail editor">
          <ShortcutGroup title="Edit" rows={[
            { keys: ['Ctrl', 'Z'], label: 'Undo' },
            { keys: ['Ctrl', 'Shift', 'Z'], label: 'Redo' },
            { keys: ['Ctrl', 'C'], label: 'Copy selected layers' },
            { keys: ['Ctrl', 'V'], label: 'Paste' },
            { keys: ['Ctrl', 'S'], label: 'Save thumbnail' },
            { keys: ['Delete'], label: 'Delete selected layers' },
          ]} />
          <ShortcutGroup title="Layout" rows={[
            { keys: ['↑ ↓ ← →'], label: 'Nudge selection 1px (Shift = 10px)' },
            { keys: ['G'], label: 'Toggle grid snap' },
            { keys: ['Ctrl', ']'], label: 'Bring layer forward (Shift = to front)' },
            { keys: ['Ctrl', '['], label: 'Send layer backward (Shift = to back)' },
          ]} />
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
        <p>Review and clip your videos. Drag-and-drop a video onto the page or press <Kbd>Ctrl</Kbd>+<Kbd>O</Kbd> to start a session; sending a stream from the Streams page opens its first full recording here.</p>

        <ElementSection icon={<PanelRight size={14} />} title="Sidebar">
          <p>The right sidebar shows info and controls for the stream and loaded video.</p>
          <ul className="list-none pl-0 flex flex-col gap-1.5">
            <li><strong className="text-gray-300">Selected Stream</strong> — the stream item the loaded video belongs to, with its thumbnail, date, and title.</li>
            <li><strong className="text-gray-300">Session Videos</strong> — displays every video in the same stream folder. Clip drafts and exports nest under their parent recording.</li>
            <li className="flex items-baseline gap-2"><AlertTriangle size={11} className="shrink-0 text-amber-400 translate-y-0.5" /><span><strong className="text-gray-300">Warning:</strong> making changes outside the app such as renaming or moving files will break clip file connections to their source clip in the app.</span></li>
          </ul>
        </ElementSection>

        <ElementSection icon={<Film size={14} />} title="Timeline">
          <p>A thumbnail filmstrip stacked above one or more audio waveforms.</p>
          <p><strong className="text-gray-300">Scroll/zoom bar</strong> — sits beneath the timeline and represents the full duration. The colored thumb shows your current zoom region; its rounded boundary caps mark the in/out edges of what's visible above. Drag a cap to resize, drag the thumb body to pan, or drag the thin playhead needle directly to scrub.</p>
          <p><strong className="text-gray-300">Zoom controls</strong> — use the toolbar above the timeline, <Kbd>Numpad +</Kbd>/<Kbd>Numpad -</Kbd>, or the mouse wheel.</p>
        </ElementSection>

        <ElementSection icon={<Layers size={14} />} title="Multi-track audio">
          <p>When a source has multiple audio tracks (e.g. game + microphone + Discord), an <em>Enable Multi-track Audio</em> button appears below the waveform. Click it to split the waveform track in the timeline into  per-track rows.</p>
          <p>Track 0 is the source's built-in audio and is always available immediately. Other tracks decode on-demand — click <em>Add track to playback</em> on a row to extract the audio to a temporary file (stored in the app's cache) and start hearing it during playback.</p>
          <p>Exporting a clip preserves every audio track in the output by default. The export dialog has checkboxes to pick which tracks to include in the mix, and each track's volume setting applies to that mix.</p>
        </ElementSection>

        <ElementSection icon={<Scissors size={14} />} title="Clip mode">
          <p>Toggle clip mode with <Kbd>C</Kbd> or the <em>Start Clipping</em> sidebar button. A toolbar appears above the timeline with controls for segments, bleeps, and cropping.</p>
          <ul className="list-none pl-0 flex flex-col gap-1.5">
            <li><strong className="text-gray-300">Segments</strong> — press <Kbd>A</Kbd> or click the <em>Add Segment</em> button to add a clip segment centered on the playhead. Drag the in/out handles to refine; click a handle for a precise timecode input. Multiple segments are concatenated into one export. <Kbd>S</Kbd> splits the segment under the playhead.</li>
            <li>When segments are bumped against each other, a button to merge them into a single segment will appear over the touching edges.</li>
            <li className="border border-navy-500 px-2 py-1 bg-navy-600 rounded leading-4 text-gray-200"><small>Tip: If you want a segment to <i>start</i> at the playhead, place a segment normally, then leave the playhead where it is and split the segment. Then delete the left-hand segment.</small></li>
            <li><strong className="text-gray-300">Bleeps</strong> — add a bleep with <Kbd>B</Kbd>. Drag horizontally to move it, drag its edges to resize, and drag the volume marker up/down to set its loudness. The volume setting is shared across every bleep in the session.</li>
            <li><strong className="text-gray-300">Crop</strong> — pick an aspect ratio (16:9, 1:1, 9:16) and the player overlays a draggable crop rectangle. Drag inside to pan, drag the corners to resize. Each clip region can have its own crop position.</li>
            <li><strong className="text-gray-300">Drafts</strong> — clipping work autosaves per source video. Multiple drafts can be added to the same source video file. Clip drafts can be renamed in the Session Videos panel.</li>
            <li><strong className="text-gray-300">Export</strong> — <Kbd>Ctrl</Kbd>+<Kbd>E</Kbd> opens the export dialog. Clips are re-encoded with whatever encoding preset you pick, defaulting to the default encoder preset in the app settings. "Copy only" encoders are not available for clip exporting due to the complexity of the available features.</li>

          </ul>
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
        <p>The Converter re-encodes one or more video files using a chosen preset. Start a conversion by sending a file from the Streams page with the <Zap size={11} className="inline align-baseline -translate-y-px" /> <em>Send to Converter</em> button, drag-and-dropping a file onto the Converter page, or browsing from the page itself.</p>

        <ElementSection icon={<Layers size={14} />} title="Built-in presets">
          <p>A handful of presets cover the most common needs out of the box:</p>
          <ul className="list-none pl-0 flex flex-col gap-1.5">
            <li><strong className="text-gray-300">YouTube Ready (H.264)</strong> — re-encodes at 8 Mbps H.264 with AAC audio. The general-purpose choice for files you plan to upload to YouTube. Preserves all audio tracks.</li>
            <li><strong className="text-gray-300">Compress VOD (H.265)</strong> — re-encodes at 4 Mbps H.265 with AAC audio. Roughly half the file size of the YouTube preset at comparable quality. Good for everyday storage when you don't need to upload. Preserves all audio tracks.</li>
            <li><strong className="text-gray-300">Fast Web Preview</strong> — low-bitrate quick encode. Useful when you just need a watchable preview to share over the web. Preserves all audio tracks.</li>
            <li><strong className="text-gray-300">Archive (SVT-AV1)</strong> — long-term storage with the strongest size-to-quality ratio. Keeps all audio tracks and subtitles. Automatically swaps to a hardware AV1 encoder (NVENC / QSV / AMF) if your GPU supports it.</li>
            <li><strong className="text-gray-300">Archive (H.265)</strong> — long-term storage at a slightly larger size than AV1, but with much wider playback compatibility. Pick this instead of AV1 when you need files that play back smoothly on older hardware, phones, TVs, or other devices that may not support AV1 decoding yet. Keeps all audio tracks and subtitles. GPU-accelerated automatically when available.</li>
            <li><strong className="text-gray-300">Lossless Copy (Remux to MP4)</strong> — wraps the existing video and audio into an MP4 container without re-encoding. This is the same operation as OBS's built-in <em>Remux Recordings</em> utility. Fast and lossless; useful for fixing container compatibility without waiting for a full encode.</li>
            <li><strong className="text-gray-300">Extract Audio (First Track)</strong> — pulls the first audio track out as a stereo MP3. Other audio tracks are dropped (MP3 supports only a single track); use a video preset if you need to keep them all.</li>
          </ul>
          <p>One archive preset can be marked as your <strong className="text-gray-300">default archive preset</strong> in Settings. The Archive action on the Streams page always uses this preset, so it's worth setting it to your preferred archival format. The app recommends AV1 when a compatible GPU is detected.</p>
        </ElementSection>

        <ElementSection icon={<PencilLine size={14} />} title="Custom presets">
          <p>Use the <em>New Custom Preset</em> button to create your own. The preset editor walks you through the common settings (codec, bitrate, audio handling, output format) without needing to write any commands. An Advanced section is also available for raw ffmpeg arguments if you need finer control.</p>
          <p>Custom presets appear alongside built-ins and can be renamed or removed at any time.</p>
        </ElementSection>

        <ElementSection icon={<Upload size={14} />} title="Importing HandBrake presets">
          <p>If you already have presets exported from HandBrake, click <em>Import HandBrake JSON</em> and select the <code>.json</code> file. The app translates the HandBrake settings into ffmpeg arguments and adds the preset to your list. Imported presets open in Advanced mode in the editor.</p>
        </ElementSection>
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
        <p>Connect your YouTube, Twitch, and Claude AI accounts here. All API keys and tokens are stored locally on your machine.</p>

        <ElementSection icon={<Youtube size={14} />} title="YouTube">
          <p>With YouTube connected, you can pull broadcast and VOD info onto a stream's metadata and push title, description, tags, category, and privacy updates back. The per-field push/pull workflow lives in the Streams details sidebar (see <em>Streams → Publishing to YouTube &amp; Twitch</em>).</p>
        </ElementSection>

        <ElementSection icon={<TrendingUpDown size={14} />} title="Stream Relay">
          <p>The relay routes your streaming app (OBS, Xsplit, etc.) to YouTube through a small local RTMP server that Stream Manager runs in the background. Its job is to <strong className="text-gray-300">automatically connect your stream to the right scheduled broadcast and take it live</strong> — so you don't have to touch YouTube Studio when you start streaming.</p>
          <p><strong className="text-gray-300">Setup</strong> (requires YouTube connected):</p>
          <ul className="list-none pl-0 flex flex-col gap-1">
            <li className="flex items-baseline gap-2"><span className="shrink-0 text-gray-500">1.</span><span>Toggle <strong className="text-gray-300">Enabled</strong>. Stream Manager auto-fills your channel's persistent stream key from YouTube.</span></li>
            <li className="flex items-baseline gap-2"><span className="shrink-0 text-gray-500">2.</span><span>In your streaming app's stream settings, set a <em>Custom</em> server to the <strong className="text-gray-300">Server URL</strong> and <strong className="text-gray-300">Stream Key</strong> shown in the card (click either to copy). These point at Stream Manager, not YouTube directly.</span></li>
            <li className="flex items-baseline gap-2"><span className="shrink-0 text-gray-500">3.</span><span>Leave the relay enabled — it starts with the app and listens for your streaming software to connect.</span></li>
          </ul>
          <p><strong className="text-gray-300">Active-broadcast workflow.</strong> Stream Manager binds your stream to one upcoming YouTube broadcast. By default it auto-picks the <em>soonest upcoming</em> one; you can override this from the <strong className="text-gray-300">Stream Relay widget</strong> in the navigation sidebar (pick a specific broadcast or switch back to auto). When go live in your streaming app, the relay binds that broadcast, waits for YouTube to start receiving the feed, and transitions it to live — you'll see the stage progress in the widget.</p>
          <p>When you stop streaming, the broadcast is finalized after a short grace period, so a brief disconnect/reconnect won't end it. If you start streaming without a broadcast picked, bytes still reach YouTube and it creates a broadcast on its own — Stream Manager just won't be managing the details for that stream.</p>
        </ElementSection>

        <ElementSection icon={<Twitch size={14} />} title="Twitch">
          <p>With Twitch connected, Stream Manager syncs a stream's title and category to your channel. It can automatically push the next scheduled broadcast's details or allow you to push them manually in the Streams details sidebar.</p>
        </ElementSection>

        <ElementSection icon={<Bot size={14} />} title="Claude AI">
          <p>When Claude is connected, it can draft titles, taglines, descriptions, and tag lists. Press <Kbd>Ctrl</Kbd>+<Kbd>Space</Kbd> in those fields for a suggestion grounded in the stream's details and your preferences prompt.</p>
        </ElementSection>
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
  {
    id: 'widgets',
    label: 'Widgets',
    icon: <LayoutGrid size={16} />,
    body: (
      <>
        <p>Widgets are the live-status panels that show up in the bottom of the left sidebar. Some only appear when they have something to show (a file conversion, active cloud syncing, a pinned launch group, etc.). Click any widget's header to navigate to the page it is related to.</p>

        <ElementSection icon={<Zap size={14} />} title="Converting">
          <p>Visible while at least one conversion job is queued, running, paused, or errored. Shows the combined progress bar, a status label, job count, and an ETA when one is available. Cloud-placeholder files that need to download before encoding can start are surfaced separately.</p>
        </ElementSection>

        <ElementSection icon={<Cloud size={14} />} title="Cloud sync">
          <p>Visible during a cloud-sync operation — either offloading local files to the cloud or downloading (hydrating) placeholders to disk.</p>
          <p>Click the widget to open the Cloud Operations dialog.</p>
        </ElementSection>

        <ElementSection icon={<Rocket size={14} />} title="Launcher">
          <p>Visible only after you've pinned one of your launch groups to the sidebar (the star icon next to a group on the Launcher page). Shows the pinned group's icon and name in the widget header.</p>
          <p>Click <em>Launch</em> to spin up every app, window, and URL in the group in one shot.</p>
        </ElementSection>

        <ElementSection icon={<TrendingUpDown size={14} />} title="Stream Relay">
          <p>Visible only when the relay is enabled in Integrations → Stream Relay. Shows the relay's current status (<em>Idle</em>, <em>Listening</em>, <em>Starting</em>, <em>Streaming</em>, <em>Error</em>), the active YouTube broadcast, and — once you go live — running kbps + duration stats.</p>
          <p>Click the title row to jump to the Integrations page where the relay's setup and stream key live. Click the active-broadcast row to pick a different broadcast or use auto-pick mode.</p>
        </ElementSection>

        <ElementSection icon={<Shuffle size={14} />} title="Auto-Rules">
          <p>Visible when you have one or more rules configured on the Auto-Rules page. The header row links to the Auto-Rules page; a <em>Start / Stop</em> button toggles the file-watcher; the bottom row shows the watcher's running state with a colored dot and the number of currently-enabled rules.</p>
        </ElementSection>
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
        <nav className="w-44 shrink-0 flex flex-col gap-0.5 border-r border-white/5 pr-2 overflow-y-auto -ms-4">
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
                <span className={isActive ? 'text-purple-300' : 'text-gray-400'}>{i.icon}</span>
                <span>{i.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Content. `text-pretty` (= text-wrap: pretty) inherits to
            every descendant block element, so all paragraphs + list
            items in every section get the orphan-avoiding wrap rule
            without scattering the class through each section body. */}
        <div className="flex-1 min-w-0 flex flex-col gap-3 text-sm text-gray-400 leading-relaxed text-pretty [&_p]:m-0 overflow-y-auto pr-2">
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
