import React from 'react'
import { Radio, Film, Image as ImageIcon, Shuffle } from 'lucide-react'

function FeatureCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 p-3 rounded-lg bg-navy-800/60 border border-white/5">
      <div className="flex items-center gap-1.5 text-gray-200">
        <span className="text-purple-400">{icon}</span>
        <span className="text-xs font-semibold">{title}</span>
      </div>
      <p className="text-[11px] text-gray-300 leading-relaxed">{children}</p>
    </div>
  )
}

/** Shared body content used by both the onboarding "Convert dump folder" step
 *  and the Settings page "Convert to folder-per-stream" modal. Renders only the
 *  explainer (intro + feature cards) — the surrounding modal/buttons live in
 *  each caller. */
export function DumpConvertExplainer() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-gray-400 leading-relaxed">
          Most of the app works the same either way, but a few features are cleaner with folder-per-stream. The app can convert your dump folder into that layout in one click.
        </p>
        <p className="text-xs text-gray-500 italic leading-relaxed">
          Recording files need <span className="font-mono">YYYY-MM-DD</span> in the name (OBS's default). Subfolders won't be touched.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">What changes with folder-per-stream</h3>
        <div className="grid grid-cols-2 gap-2">
          <FeatureCard icon={<Radio size={14} />} title="Streams">
            Get a real per-stream folder you can open and browse on disk.
          </FeatureCard>
          <FeatureCard icon={<Film size={14} />} title="Player & Clipping">
            Session Videos panel shows every file in the stream's folder, not just files matching the date.
          </FeatureCard>
          <FeatureCard icon={<ImageIcon size={14} />} title="Thumbnail Editor">
            Thumbnails save into the stream's own folder instead of alongside other dated files.
          </FeatureCard>
          <FeatureCard icon={<Shuffle size={14} />} title="Auto-Rules">
            New files auto-land in the matching dated folder instead of the dump root.
          </FeatureCard>
        </div>
      </div>
    </div>
  )
}
