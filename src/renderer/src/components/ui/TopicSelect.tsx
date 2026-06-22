/**
 * Compact dropdown for picking one topic/game tag from a stream's list.
 *
 * Used by the Twitch-category picker in the stream detail sidebar and
 * intended for reuse in the future stream-dashboard popout, where the
 * streamer switches the live Twitch category without touching the
 * title's `{topic}` (which stays pinned to the primary topic).
 */

interface TopicSelectProps {
  topics: string[]
  /** Currently selected topic (should be one of `topics`). */
  value: string
  onChange: (topic: string) => void
  className?: string
  'aria-label'?: string
}

export function TopicSelect({ topics, value, onChange, className = '', ...rest }: TopicSelectProps) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`bg-navy-900 border border-white/10 text-gray-200 text-[11px] rounded px-2 py-1 max-w-[180px] truncate focus:outline-none focus:ring-1 focus:ring-purple-500/50 focus:border-purple-500/50 transition-colors ${className}`}
      {...rest}
    >
      {topics.map(t => (
        <option key={t} value={t} className="bg-navy-900">{t}</option>
      ))}
    </select>
  )
}
