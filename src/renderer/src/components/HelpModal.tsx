import React, { useState } from 'react'
import { Radio, Film, Zap, Combine, Image as ImageIcon, Rocket, Plug, Shuffle, Scissors, Archive, Tag, Hash, MessageSquare, PencilLine, FolderOpen, CalendarClock, Keyboard, PanelRight, Layers, AlertTriangle, Upload, TrendingUpDown, LayoutGrid, Type, Braces, Star, Link2, SquareDashedText, Bot, Palette } from 'lucide-react'
import { Youtube, Twitch } from './ui/BrandIcons'
import { Modal } from './ui/Modal'
import { MERGE_FIELD_CHIP_CLASS, MERGE_FIELD_CHIP_CLASS_INAPPLICABLE } from './ui/TemplateBodyEditor'
import { useStore } from '../hooks/useStore'

function ElementSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-gray-200">
        <span className="text-accent-300 shrink-0">{icon}</span>
        <h4 className="text-sm font-semibold">{title}</h4>
      </div>
      <div className="text-[13px] text-gray-400 leading-relaxed pl-6 [&_p]:m-0 flex flex-col gap-2">
        {children}
      </div>
    </div>
  )
}

/** A merge-field key rendered as the editors' chip — the app dropped the
 *  `{braces}` convention from its UI, so the docs show the chip too. */
function MF({ k, inapplicable }: { k: string; inapplicable?: boolean }) {
  return <span className={`${inapplicable ? MERGE_FIELD_CHIP_CLASS_INAPPLICABLE : MERGE_FIELD_CHIP_CLASS} align-middle mx-px`}>{k}</span>
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
  | 'thumbnails' | 'launcher' | 'integrations' | 'rules' | 'relay'

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
        <p>Stream items are listed as rows, newest first. Teal rows are upcoming streams; blue is today's. Click a row to open the details sidebar; that's where all editing happens.</p>

        <ElementSection icon={<ImageIcon size={14} />} title="Thumbnail">
          <p>The stream's picked image (or the best image found in its folder). Change it from the <strong className="text-gray-300">Files</strong> section in the details sidebar; click an image there to view them all full screen.</p>
        </ElementSection>

        <ElementSection icon={<Film size={14} />} title="Video Counter">
          <p>How many videos the stream has: full recordings and clips/shorts, counted separately. Hover for a per-file breakdown.</p>
        </ElementSection>

        <ElementSection icon={<Archive size={14} />} title="Status Badges">
          <ul className="list-none pl-0 flex flex-col gap-1">
            <li className="flex items-baseline gap-2"><Archive size={11} className="shrink-0 text-green-400 translate-y-0.5" /><span><strong className="text-gray-300">Archived</strong>: the recordings have been compressed by the archive process.</span></li>
            <li className="flex items-baseline gap-2"><Radio size={11} className="shrink-0 text-teal-400 translate-y-0.5" /><span><strong className="text-gray-300">Upcoming</strong>: scheduled but not aired yet.</span></li>
            <li className="flex items-baseline gap-2"><Youtube size={11} className="shrink-0 text-red-400 translate-y-0.5" /><span><strong className="text-gray-300">YouTube</strong>: linked to a YouTube livestream or video; a second icon shows its privacy.</span></li>
          </ul>
        </ElementSection>

        <ElementSection icon={<Tag size={14} />} title="Type Tags">
          <p>Categorize streams however you like. Create and customize tags (colors, textures) via <strong className="text-gray-300">Manage Tags</strong> in the page header.</p>
        </ElementSection>

        <ElementSection icon={<Hash size={14} />} title="Topics / Games">
          <p>What the stream covered. Best kept matching Twitch's categories (SM suggests exact matches). The primary tag fills the <MF k="topic" /> merge field and the Twitch category.</p>
        </ElementSection>

        <ElementSection icon={<MessageSquare size={14} />} title="Notes">
          <p>Free-form notes, at the bottom of the details sidebar.</p>
        </ElementSection>

        <ElementSection icon={<Zap size={14} />} title="Action Buttons">
          <p>Hovering a row shows quick actions on its right: <strong className="text-gray-300">Send to Player</strong>, <strong className="text-gray-300">Send to Converter</strong>, and <strong className="text-gray-300">Create / Edit thumbnail</strong>.</p>
        </ElementSection>

        <ElementSection icon={<LayoutGrid size={14} />} title="Files">
          <p>The <strong className="text-gray-300">Files</strong> section near the top of the details sidebar lays out media files in the stream's folder: recordings, clips, and images. Use the <em>Video</em> and <em>Images</em> toggles above the grid to show or hide each type.</p>
          <p>Hover a card for its actions: send a video to the <strong className="text-gray-300">Player</strong> or <strong className="text-gray-300">Converter</strong>, set an image as the stream's <strong className="text-gray-300">thumbnail</strong>, <strong className="text-gray-300">edit</strong> SM-made thumbnails, <strong className="text-gray-300">offload / pin</strong> the file (cloud sync), or <strong className="text-gray-300">delete</strong> it. Cards are tagged by role (Clip, Short, Archived, current thumbnail) and show cloud status.</p>
          <p>The section's header has the same file actions for the whole stream at once (<strong className="text-gray-300">Offload</strong>, <strong className="text-gray-300">Pin local</strong>, <strong className="text-gray-300">Open folder</strong>), plus a <strong className="text-gray-300">Select</strong> mode for bulk actions on specific files.</p>
          <p>No SM-made thumbnail yet? A <strong className="text-gray-300">Create thumbnail</strong> tile in the grid opens the thumbnail editor.</p>
        </ElementSection>

        <ElementSection icon={<PanelRight size={14} />} title="Details Sidebar">
          <p>Every field edits inline and autosaves as you go. This is where you prepare and publish a stream's YouTube &amp; Twitch metadata. A few fields feed the title and description templates as <strong className="text-gray-300">merge fields</strong>:</p>
          <ul className="list-none pl-0 flex flex-col gap-1">
            <li className="flex items-baseline gap-2"><Hash size={11} className="shrink-0 text-accent-300 translate-y-0.5" /><span><strong className="text-gray-300">Topics / Games</strong>: the selected tag is the <em>primary</em> one. It sets the <MF k="topic" /> merge field (use <MF k="topics" /> for all of them) and is the Twitch category by default.</span></li>
            <li className="flex items-baseline gap-2"><PencilLine size={11} className="shrink-0 text-accent-300 translate-y-0.5" /><span><strong className="text-gray-300">Tagline</strong>: a short catchy phrase that sets the <MF k="tagline" /> merge field. Press <Kbd>Ctrl</Kbd>+<Kbd>Space</Kbd> in the field for an AI suggestion using the stream's details, previous taglines in the series, and your preferences prompt configurable on the integrations page.</span></li>
            <li className="flex items-baseline gap-2"><Layers size={11} className="shrink-0 text-accent-300 translate-y-0.5" /><span><strong className="text-gray-300">Series / Season / Episode</strong>: for a stream series, these set the <MF k="season" />, <MF k="episode" />, and <MF k="total_episodes" /> merge fields. Turn off <em>Series</em> for one-off streams or to otherwise opt-out of the series system.</span></li>
          </ul>
          <p>Fields that feed a merge field wear the chip right in their label (an arrow pointing at the chip); the chip lights up when the bound title template actually uses it.</p>
          <p>The header's <strong className="text-gray-300">New episode</strong> button creates the next episode of the series (<Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>N</Kbd>). The footer holds <strong className="text-gray-300">Archive</strong> (compresses the recordings with your default archive preset; can't be undone) and <strong className="text-gray-300">Delete</strong>.</p>
        </ElementSection>

        <ElementSection icon={<Type size={14} />} title="Title fields & merge fields">
          <p>The YouTube Title and the Twitch Title (when you enable <em>Custom title</em>) are mini template editors. Type plain text, or insert a <strong className="text-gray-300">merge-field chip</strong> from the <em>Insert</em> row beneath the field. Chips like <MF k="topic" /> or <MF k="episode" /> are substituted live from the fields above.</p>
          <ul className="list-none pl-0 flex flex-col gap-1.5">
            <li className="flex items-baseline gap-2"><Braces size={11} className="shrink-0 text-accent-300 translate-y-0.5" /><span><strong className="text-gray-300">Preview</strong>: when a title contains merge fields, a preview line shows the final rendered title (exactly what publishes).</span></li>
            <li className="flex items-baseline gap-2"><Hash size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span><strong className="text-gray-300">Character counter</strong>: counts the rendered title against the platform limit (100 for YouTube, 140 for Twitch) and turns red when you go over.</span></li>
            <li className="flex items-baseline gap-2"><Braces size={11} className="shrink-0 text-red-400 translate-y-0.5" /><span>A merge field that doesn't apply, like <MF k="episode" inapplicable /> on a standalone stream, shows as a red chip. Turn on <em>Series</em> to use it.</span></li>
          </ul>
        </ElementSection>

        <ElementSection icon={<SquareDashedText size={14} />} title="Templates">
          <p>Save reusable Titles, Descriptions, and Tag lists from the <strong className="text-gray-300">Templates</strong> button in the Streams page header. Title &amp; Description templates use the same merge-field chips; tag templates are reusable tag lists.</p>
          <ul className="list-none pl-0 flex flex-col gap-1.5">
            <li>Assign a Titles template from the dropdown above the title field. It fills the field with the template's body and stays <strong className="text-gray-300">bound</strong> (the tab lights up); hand-editing the field detaches it. The same Titles templates work for both YouTube and Twitch.</li>
            <li className="flex items-baseline gap-2"><Star size={11} className="shrink-0 text-amber-400 translate-y-0.5" /><span><strong className="text-gray-300">Default tag templates</strong>: star a tag template to auto-fill it onto every new stream (set separately for YouTube and Twitch).</span></li>
            <li className="flex items-baseline gap-2"><Link2 size={11} className="shrink-0 text-blue-400 translate-y-0.5" /><span><strong className="text-gray-300">Linked tags</strong>: in Manage Tags, link a Topic/Game to a tag template so its tags auto-fill whenever you add that topic or game tag to the stream item. Only the primary tag (either the first or manually selected topic/game tag) will be used to fill the tags fields with its linked list if it has one. The Templates dialog can also bulk-bind existing streams whose tags already match a template.</span></li>
          </ul>
        </ElementSection>

        <ElementSection icon={<Youtube size={14} />} title="Publishing to YouTube & Twitch">
          <p>Link a stream to a YouTube broadcast or video from the sidebar footer, then edit its title, description, tags, category, privacy, and scheduled time locally and <strong className="text-gray-300">Push to YouTube</strong> when ready. <strong className="text-gray-300">Pull from YouTube</strong> copies YouTube's current values back onto the stream.</p>
          <p>A colored dot next to a field means it differs from YouTube, and which way it's out of sync:</p>
          <ul className="list-none pl-0 flex flex-col gap-1">
            <li className="flex items-baseline gap-2"><span className="shrink-0 w-2 h-2 rounded-full bg-blue-400" /><span><strong className="text-gray-300">Blue</strong>: you changed it locally; push to update YouTube.</span></li>
            <li className="flex items-baseline gap-2"><span className="shrink-0 w-2 h-2 rounded-full bg-orange-400" /><span><strong className="text-gray-300">Orange</strong>: YouTube has a newer value; pull to update the stream (or push to overwrite YouTube with yours).</span></li>
            <li className="flex items-baseline gap-2"><span className="shrink-0 w-2 h-2 rounded-full bg-gradient-to-br from-blue-400 to-orange-400" /><span><strong className="text-gray-300">Two-tone</strong>: a conflict: both sides changed since the last sync. Pulling overwrites your local edits; pushing overwrites YouTube's.</span></li>
            <li className="flex items-baseline gap-2"><span className="shrink-0 w-2 h-2 rounded-full bg-gray-400" /><span><strong className="text-gray-300">Gray</strong>: the field differs from YouTube but the direction is unknown, because the stream hasn't been synced since per-field tracking was added. Push or pull once to start tracking direction.</span></li>
          </ul>
          <p className="flex items-baseline gap-2"><Twitch size={11} className="shrink-0 text-gray-400 translate-y-0.5" /><span>Twitch pushes the title, category, and tags to your channel. By default the title mirrors the YouTube title and the category comes from your topic tags (a dropdown picks which when there are several); each field shows exactly what will be pushed. Toggle <em>Custom title</em> or <em>Custom category</em> to override: the custom field starts pre-filled with the inherited value so you can edit from there.</span></p>
          <p>Twitch fields don't show the per-field dots. Twitch holds one channel state at a time, so the <strong className="text-gray-300">Push to Twitch</strong> button simply lights up when your channel doesn't match this stream and disables once they're in sync.</p>
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

        <ElementSection icon={<Keyboard size={14} />} title="Global (any page)">
          <ShortcutGroup title="Navigation" rows={[
            { keys: ['Ctrl', '1…7'], label: 'Jump to a page in nav order (Streams · Player · Thumbnails · Converter · Combine · Launcher · Auto-Rules)' },
            { keys: ['Ctrl', 'PageUp / PageDown'], label: 'Cycle to the previous / next page' },
            { keys: ['Ctrl', ','], label: 'Open Settings' },
            { keys: ['?'], label: 'Open this Help' },
          ]} />
          <ShortcutGroup title="View" rows={[
            { keys: ['Ctrl', '+ / -'], label: 'Zoom the app UI in / out' },
            { keys: ['Ctrl', '0'], label: 'Reset the app UI zoom' },
          ]} />
          <ShortcutGroup title="Actions" rows={[
            { keys: ['Ctrl', 'L'], label: 'Launch the pinned launch group (the Launcher nav item’s button)' },
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
            { keys: ['J'], label: 'Playback speed down one step' },
            { keys: ['K'], label: 'Reset playback speed to 1×' },
            { keys: ['L'], label: 'Playback speed up one step' },
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
            <li><strong className="text-gray-300">Selected Stream</strong>: the stream item the loaded video belongs to, with its thumbnail, date, and title.</li>
            <li><strong className="text-gray-300">Session Videos</strong>: displays every video in the same stream folder. Clip drafts and exports nest under their parent recording.</li>
            <li className="flex items-baseline gap-2"><AlertTriangle size={11} className="shrink-0 text-amber-400 translate-y-0.5" /><span><strong className="text-gray-300">Warning:</strong> making changes outside the app such as renaming or moving files will break clip file connections to their source clip in the app.</span></li>
          </ul>
        </ElementSection>

        <ElementSection icon={<Film size={14} />} title="Timeline">
          <p>A thumbnail filmstrip stacked above one or more audio waveforms.</p>
          <p><strong className="text-gray-300">Scroll/zoom bar</strong>: sits beneath the timeline and represents the full duration. The colored thumb shows your current zoom region; its rounded boundary caps mark the in/out edges of what's visible above. Drag a cap to resize, drag the thumb body to pan, or drag the thin playhead needle directly to scrub.</p>
          <p><strong className="text-gray-300">Zoom controls</strong>: use the toolbar above the timeline, <Kbd>Numpad +</Kbd>/<Kbd>Numpad -</Kbd>, or the mouse wheel.</p>
        </ElementSection>

        <ElementSection icon={<Layers size={14} />} title="Multi-track audio">
          <p>When a source has multiple audio tracks (e.g. game + microphone + Discord), an <em>Enable Multi-track Audio</em> button appears below the waveform. Click it to split the waveform track in the timeline into  per-track rows.</p>
          <p>Track 0 is the source's built-in audio and is always available immediately. Other tracks decode on demand: click <em>Add track to playback</em> on a row to extract the audio to a temporary file (stored in the app's cache) and start hearing it during playback.</p>
          <p>Exporting a clip preserves every audio track in the output by default. The export dialog has checkboxes to pick which tracks to include in the mix, and each track's volume setting applies to that mix.</p>
        </ElementSection>

        <ElementSection icon={<Scissors size={14} />} title="Clip mode">
          <p>Toggle clip mode with <Kbd>C</Kbd> or the <em>Start Clipping</em> sidebar button. A toolbar appears above the timeline with controls for segments, bleeps, and cropping.</p>
          <ul className="list-none pl-0 flex flex-col gap-1.5">
            <li><strong className="text-gray-300">Segments</strong>: press <Kbd>A</Kbd> or click the <em>Add Segment</em> button to add a clip segment centered on the playhead. Drag the in/out handles to refine; click a handle for a precise timecode input. Multiple segments are concatenated into one export. <Kbd>S</Kbd> splits the segment under the playhead.</li>
            <li>When segments are bumped against each other, a button to merge them into a single segment will appear over the touching edges.</li>
            <li className="border border-navy-500 px-2 py-1 bg-navy-600 rounded leading-4 text-gray-200"><small>Tip: If you want a segment to <i>start</i> at the playhead, place a segment normally, then leave the playhead where it is and split the segment. Then delete the left-hand segment.</small></li>
            <li><strong className="text-gray-300">Bleeps</strong>: add a bleep with <Kbd>B</Kbd>. Drag horizontally to move it, drag its edges to resize, and drag the volume marker up/down to set its loudness. The volume setting is shared across every bleep in the session.</li>
            <li><strong className="text-gray-300">Crop</strong>: pick an aspect ratio (16:9, 1:1, 9:16) and the player overlays a draggable crop rectangle. Drag inside to pan, drag the corners to resize. Each clip region can have its own crop position.</li>
            <li><strong className="text-gray-300">Drafts</strong>: clipping work autosaves per source video. Multiple drafts can be added to the same source video file. Clip drafts can be renamed in the Session Videos panel.</li>
            <li><strong className="text-gray-300">Export</strong>: <Kbd>Ctrl</Kbd>+<Kbd>E</Kbd> opens the export dialog. Clips are re-encoded with whatever encoding preset you pick, defaulting to the default encoder preset in the app settings. "Copy only" encoders are not available for clip exporting due to the complexity of the available features.</li>

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
            <li><strong className="text-gray-300">YouTube Ready (H.264)</strong>: re-encodes at 8 Mbps H.264 with AAC audio. The general-purpose choice for files you plan to upload to YouTube. Preserves all audio tracks.</li>
            <li><strong className="text-gray-300">Compress VOD (H.265)</strong>: re-encodes at 4 Mbps H.265 with AAC audio. Roughly half the file size of the YouTube preset at comparable quality. Good for everyday storage when you don't need to upload. Preserves all audio tracks.</li>
            <li><strong className="text-gray-300">Fast Web Preview</strong>: low-bitrate quick encode. Useful when you just need a watchable preview to share over the web. Preserves all audio tracks.</li>
            <li><strong className="text-gray-300">Archive (SVT-AV1)</strong>: long-term storage with the strongest size-to-quality ratio. Keeps all audio tracks and subtitles. Automatically swaps to a hardware AV1 encoder (NVENC / QSV / AMF) if your GPU supports it.</li>
            <li><strong className="text-gray-300">Archive (H.265)</strong>: long-term storage at a slightly larger size than AV1, but with much wider playback compatibility. Pick this instead of AV1 when you need files that play back smoothly on older hardware, phones, TVs, or other devices that may not support AV1 decoding yet. Keeps all audio tracks and subtitles. GPU-accelerated automatically when available.</li>
            <li><strong className="text-gray-300">Lossless Copy (Remux to MP4)</strong>: wraps the existing video and audio into an MP4 container without re-encoding. This is the same operation as OBS's built-in <em>Remux Recordings</em> utility. Fast and lossless; useful for fixing container compatibility without waiting for a full encode.</li>
            <li><strong className="text-gray-300">Extract Audio</strong>: pulls one audio track out as a stereo MP3. When a file has several tracks, a per-file dropdown in the queue lets you pick which one. Other tracks are dropped (MP3 supports only a single track); use a video preset if you need to keep them all.</li>
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

        <ElementSection icon={<Layers size={14} />} title="In the navigation">
          <p>While at least one job is queued, running, paused, or errored, the Converter's nav item shows the live status underneath it: combined progress, a status label, job count, and an ETA when one is available. Cloud-placeholder files that need to download before encoding can start are surfaced separately. It slides away when the last job finishes.</p>
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
        <p>Stitch multi-part recordings into a single file, for when OBS splits a long stream across several files. The parts are copied as-is (no re-encoding), so combining is fast and loses no quality. Start from the Combine page, or select the parts in a stream's Files section and use its <strong className="text-gray-300">Combine</strong> action.</p>

        <ElementSection icon={<Layers size={14} />} title="Jobs">
          <p>Dropping files starts a job; add more files to it or drop elsewhere to start another. Reorder the parts before combining. Several jobs can be set up, but only one combines at a time; the others wait their turn. Offloaded sources download from the cloud automatically before the run starts.</p>
        </ElementSection>

        <ElementSection icon={<AlertTriangle size={14} />} title="Compatibility">
          <p>Because the streams are copied as-is, the parts must match. Properties that differ within a job turn red and block combining (codec, resolution, audio layout); convert the odd file first, then combine. A frame-rate difference shows amber but is allowed; the output just has a variable frame rate.</p>
        </ElementSection>

        <ElementSection icon={<FolderOpen size={14} />} title="Output & sources">
          <p>Each job shows its output file and where it lands. Source files are kept unless you check <strong className="text-gray-300">Delete source files after combining</strong>.</p>
        </ElementSection>
      </>
    ),
  },
  {
    id: 'thumbnails',
    label: 'Thumbnails',
    icon: <ImageIcon size={16} />,
    body: (
      <>
        <p>Design 1280×720 thumbnails for your streams from images, text, and shapes. Open the editor from a stream (<Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>T</Kbd>, the row action, or the Files section) or start on the Thumbnails page itself.</p>

        <ElementSection icon={<ImageIcon size={14} />} title="Sessions & saving">
          <p>A stream session autosaves as you edit; the saved PNG lands in the stream's folder and shows up in the Files section and the stream row. Use <strong className="text-gray-300">Close session</strong> when you're done. Template sessions are the opposite: nothing is saved until you click <strong className="text-gray-300">Update template</strong>, so experiments can be abandoned safely.</p>
        </ElementSection>

        <ElementSection icon={<Layers size={14} />} title="Layers & properties">
          <p>Add image, text, and shape layers; reorder them in the <strong className="text-gray-300">Layers</strong> panel. Select a layer to edit it in the <strong className="text-gray-300">Properties</strong> panel: position and size, colors (solid or gradient), stroke, shadow, filters, and fonts for text.</p>
        </ElementSection>

        <ElementSection icon={<Type size={14} />} title="Merge fields in text">
          <p>Text layers can contain merge-field chips like <MF k="episode" /> or <MF k="topic" />, filled in from the stream's details. When those values change (a new episode, an edited topic), the thumbnail re-renders automatically. If a re-render can't load one of its images, the thumbnail shows a warning badge; open and save it in the editor to fix it.</p>
        </ElementSection>

        <ElementSection icon={<SquareDashedText size={14} />} title="Templates">
          <p>Templates are reusable designs. Pick one when creating a stream and the editor auto-loads it as the starting point. Build and edit templates from the Thumbnails page; <strong className="text-gray-300">Update template</strong> saves your changes back to the template itself.</p>
        </ElementSection>

        <ElementSection icon={<LayoutGrid size={14} />} title="Variants">
          <p>A stream can have several thumbnail designs. Switch between them (or add and delete them) with the variant control in the editor header, and pick which one is the stream's thumbnail in the Files section.</p>
        </ElementSection>

        <ElementSection icon={<Palette size={14} />} title="Assets & palette">
          <p>The <strong className="text-gray-300">Assets</strong> panel lists images you can drop onto the canvas; the button in its header picks which folders it pulls from. The <strong className="text-gray-300">Palette</strong> panel keeps your recently used colors and a saved swatch list (the pencil edits it); swatches can hold gradients too. <strong className="text-gray-300">Frame grabs</strong> from the player page appear in the <strong className="text-gray-300">Assets</strong> panel automatically.</p>
        </ElementSection>
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
        <p>Pin a group (the star icon next to it on the Launcher page) and its launch button lives right on the Launcher item in the navigation, wearing the group's own icon. The button doubles as feedback: a spinner while launching, a check on success, and a warning when something fails (hover it for details). <Kbd>Ctrl</Kbd>+<Kbd>L</Kbd> launches the pinned group from anywhere.</p>
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
          <p>The relay routes your streaming app (OBS, Xsplit, etc.) to YouTube through a small local RTMP server that Stream Manager runs in the background. Its job is to <strong className="text-gray-300">automatically connect your stream to the right scheduled broadcast and take it live</strong>: so you don't have to touch YouTube Studio when you start streaming.</p>
          <p><strong className="text-gray-300">Setup</strong> (requires YouTube connected):</p>
          <ul className="list-none pl-0 flex flex-col gap-1">
            <li className="flex items-baseline gap-2"><span className="shrink-0 text-gray-500">1.</span><span>Toggle <strong className="text-gray-300">Enabled</strong>. Stream Manager auto-fills your channel's persistent stream key from YouTube.</span></li>
            <li className="flex items-baseline gap-2"><span className="shrink-0 text-gray-500">2.</span><span>In your streaming app's stream settings, set a <em>Custom</em> server to the <strong className="text-gray-300">Server URL</strong> and <strong className="text-gray-300">Stream Key</strong> shown in the card (click either to copy). These point at Stream Manager, not YouTube directly.</span></li>
            <li className="flex items-baseline gap-2"><span className="shrink-0 text-gray-500">3.</span><span>Leave the relay enabled; it starts with the app and listens for your streaming software to connect.</span></li>
          </ul>
          <p><strong className="text-gray-300">Active-broadcast workflow.</strong> Stream Manager binds your stream to one upcoming YouTube broadcast. By default it auto-picks the broadcast scheduled for <em>today</em> nearest to the current time (a late start still binds the right one, and a broadcast around midnight counts for either day); it never auto-picks a broadcast on a future day. You can override this from the <strong className="text-gray-300">Stream Relay widget</strong> in the navigation sidebar (pick a specific broadcast on any day, or switch back to auto). When you go live in your streaming app, the relay binds that broadcast, waits for YouTube to start receiving the feed, and transitions it to live. You'll see the stage progress in the widget.</p>
          <p>When you stop streaming, the broadcast is finalized after a short grace period, so a brief disconnect/reconnect won't end it. If you start streaming without a broadcast picked, bytes still reach YouTube and it creates a broadcast on its own; Stream Manager just won't be managing the details for that stream.</p>
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
        <p>Sessions that run past midnight are handled automatically: a recording started in the small hours (before 6&nbsp;AM) whose date has no stream item of its own is routed into the previous day's stream, the session it actually belongs to.</p>
        <p>Rules can also queue up conversions automatically (e.g. archive every new recording with an AV1 preset).</p>
        <p>Once you have rules, the Auto-Rules item in the navigation carries a <em>Start / Stop</em> control for the file-watcher, and shows a "Running" line with the number of enabled rules while it's on.</p>
      </>
    ),
  },
  {
    id: 'relay',
    label: 'Stream Relay',
    icon: <TrendingUpDown size={16} />,
    body: (
      <>
        <p>The Stream Relay widget sits at the bottom of the navigation sidebar. It's visible only when the relay is enabled in Integrations → Stream Relay (see that section for setup and how it works).</p>
        <p>It shows the relay's current status (<em>Idle</em>, <em>Listening</em>, <em>Starting</em>, <em>Streaming</em>, <em>Error</em>), the active YouTube broadcast, and, once you go live, running kbps + duration stats.</p>
        <p>Click the title row to jump to the Integrations page where the relay's setup and stream key live. Click the active-broadcast row to pick a different broadcast or use auto-pick mode.</p>
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
                    ? 'bg-accent-700/30 text-accent-200 border border-accent-700/40'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-white/5 border border-transparent'
                }`}
              >
                <span className={isActive ? 'text-accent-300' : 'text-gray-400'}>{i.icon}</span>
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
            <span className="text-accent-300">{item.icon}</span>
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
