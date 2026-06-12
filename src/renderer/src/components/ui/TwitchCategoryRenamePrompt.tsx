import React from 'react'
import { ArrowRight } from 'lucide-react'
import { Modal } from './Modal'
import { Button } from './Button'

interface TwitchCategoryRenamePromptProps {
  isOpen: boolean
  /** What the user had locally — the game name we sent to Twitch. */
  sent: string
  /** What Twitch resolved the fuzzy match to — the canonical category. */
  canonical: string
  onConfirm: () => void
  onKeep: () => void
  onDontAskAgain: () => void
}

// Canonical topic/game-tag chip styling — purposely *not* sourced from
// `tagColors` / `tagTextures` because those maps only configure the
// user-editable "stream type" tags. Topic/game tags are fixed-style
// chips (the small purple pill used in the streams table + sidebar),
// and the visual must match exactly so the comparison reads as
// "this tag → that name" rather than as some new chip variant.
const TOPIC_CHIP =
  'inline-block text-[10px] leading-tight px-1.5 py-0.5 rounded-full bg-purple-900/20 text-purple-300 border border-purple-300/30'

export const TwitchCategoryRenamePrompt: React.FC<TwitchCategoryRenamePromptProps> = ({
  isOpen,
  sent,
  canonical,
  onConfirm,
  onKeep,
  onDontAskAgain,
}) => (
  <Modal
    isOpen={isOpen}
    onClose={onKeep}
    title="Update Topic/Game tag?"
    width="lg"
    autoFocus="none"
    footer={
      <div className="flex items-center justify-between w-full gap-2">
        <Button variant="ghost" size="sm" onClick={onDontAskAgain}>
          Don't ask again
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onKeep}>
            Keep my name
          </Button>
          <Button variant="primary" size="sm" onClick={onConfirm}>
            Rename to match
          </Button>
        </div>
      </div>
    }
  >
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-300 text-pretty">
        Twitch resolved your game name through its category search and stored a
        different canonical name on the channel. Do you want to rename your
        local tag everywhere it's used to match?
      </p>
      <div className="flex items-center justify-center gap-3 py-2">
        <span className={TOPIC_CHIP}>{sent}</span>
        <ArrowRight size={14} className="text-gray-400 shrink-0" />
        <span className={TOPIC_CHIP}>{canonical}</span>
      </div>
    </div>
  </Modal>
)
