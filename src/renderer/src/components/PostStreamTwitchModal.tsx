import React, { useState } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import { Twitch as LucideTwitch } from './ui/BrandIcons'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { TruncatedText } from './ui/TruncatedText'
import { useRelayPrompt } from '../context/RelayPromptContext'
import { useStore } from '../hooks/useStore'

/**
 * Post-stream Twitch push modal.
 *
 * Surfaces over the whole app whenever StreamsPage's relay-lifecycle
 * listener sets a suggestion (which it only does when the
 * `autoUpdateTwitchAfterStream` config is `'ask'`). Replaces the earlier
 * sidebar callout in StreamRelayWidget — full-screen presence makes it
 * impossible to miss after the stream ends.
 *
 * Four exits:
 *   - Update — push once, leave config alone, dismiss.
 *   - Always — set config to 'always', push, dismiss; future streams push
 *     silently with no prompt.
 *   - Never  — set config to 'never', do NOT push, dismiss; future streams
 *     do nothing.
 *   - Cancel — dismiss only. The next post-stream lifecycle event will
 *     surface a fresh prompt.
 */
export function PostStreamTwitchModal() {
  const { suggestion, setSuggestion } = useRelayPrompt()
  const { updateConfig } = useStore()
  const [pushing, setPushing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isOpen = !!suggestion
  // Reset the transient flags whenever the modal closes so a stale error or
  // pending spinner doesn't carry over to the next stream's prompt.
  React.useEffect(() => {
    if (!isOpen) { setPushing(false); setError(null) }
  }, [isOpen])

  if (!suggestion) return null

  const close = () => setSuggestion(null)

  const doPush = async () => {
    setPushing(true)
    setError(null)
    try {
      const { title, game, tags } = suggestion.payload
      const result = await window.api.twitchUpdateChannel(title, game, tags)
      // Title/tags landed, but the category search found no match — Twitch
      // kept the old category. Keep the modal open so the user actually sees
      // it, instead of a silent "success" that leaves the wrong live category.
      if (game && result?.categoryApplied === false) {
        setError(`Updated title/tags, but no Twitch category matches "${game}" — the category was left unchanged.`)
        return false
      }
      return true
    } catch (e: any) {
      setError(e?.message ?? String(e))
      return false
    } finally {
      setPushing(false)
    }
  }

  const handleUpdate = async () => {
    if (await doPush()) close()
  }
  const handleAlways = async () => {
    await updateConfig({ autoUpdateTwitchAfterStream: 'always' })
    if (await doPush()) close()
  }
  const handleNever = async () => {
    await updateConfig({ autoUpdateTwitchAfterStream: 'never' })
    close()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Push next stream to Twitch?"
      width="md"
      autoFocus="none"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={handleNever} disabled={pushing}>
              Never
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={close} disabled={pushing}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={handleAlways} disabled={pushing}>
              {pushing && <Loader2 size={12} className="animate-spin mr-1.5" />}
              Always
            </Button>
            <Button variant="primary" onClick={handleUpdate} disabled={pushing}>
              {pushing && <Loader2 size={12} className="animate-spin mr-1.5" />}
              Update
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-gray-300">
        <p>
          Your previous stream just ended. Push the next-upcoming stream item's
          title, game, and tags to your Twitch channel?
        </p>

        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-twitch-400/10 border border-twitch-400/30">
          <LucideTwitch size={14} className="text-twitch-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-twitch-300/80">Next stream</div>
            <TruncatedText text={suggestion.displayTitle} className="text-sm text-gray-100 truncate" />
            {suggestion.payload.game && (
              <div className="text-xs text-gray-400 truncate">{suggestion.payload.game}</div>
            )}
            {suggestion.payload.tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {suggestion.payload.tags.map(t => (
                  <span key={t} className="px-1.5 py-0.5 rounded bg-twitch-400/15 text-[10px] text-twitch-200">{t}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        <ul className="text-xs text-gray-400 leading-relaxed list-disc pl-5 flex flex-col gap-1">
          <li><strong className="text-gray-300">Update</strong> — push this one time.</li>
          <li><strong className="text-gray-300">Always</strong> — push now and silently push after every future stream.</li>
          <li><strong className="text-gray-300">Never</strong> — don't push, and don't ask again.</li>
          <li><strong className="text-gray-300">Cancel</strong> — dismiss for now; the prompt will reappear after the next stream.</li>
        </ul>

        <p className="text-xs text-gray-500">
          You can change this anytime in Settings → Integrations → Twitch.
        </p>

        {error && (
          <div className="flex items-start gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
            <AlertCircle size={12} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Modal>
  )
}
