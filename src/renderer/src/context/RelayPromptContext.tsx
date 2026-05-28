import React, { createContext, useContext, useState, useCallback } from 'react'

/**
 * Cross-page state for the post-stream Twitch-update prompt.
 *
 * StreamsPage owns the stream folder data, so it's the natural detector for
 * "a SM-orchestrated stream just completed and the next upcoming folder has
 * Twitch info to push." StreamRelayWidget renders the prompt UI itself
 * (since it sits in the sidebar, attached to the relay's other lifecycle
 * surface). The two live in different subtrees of App.tsx, hence this
 * small shared context.
 *
 * When auto-update is OFF, StreamsPage sets a suggestion; the widget shows
 * a one-line callout offering to push now or flip auto-update on. When
 * auto-update is ON, StreamsPage pushes silently and never sets one.
 */
export interface PostStreamTwitchSuggestion {
  /** Stream folder path — primarily used as a React key. */
  folderPath: string
  /** Title shown to the user inside the prompt for context. */
  displayTitle: string
  /** What we'd send to Twitch — already filtered through the compat helper. */
  payload: {
    title: string
    game?: string
    tags: string[]
  }
}

interface RelayPromptContextValue {
  suggestion: PostStreamTwitchSuggestion | null
  setSuggestion: (s: PostStreamTwitchSuggestion | null) => void
}

const RelayPromptContext = createContext<RelayPromptContextValue>({
  suggestion: null,
  setSuggestion: () => {},
})

export function RelayPromptProvider({ children }: { children: React.ReactNode }) {
  const [suggestion, setSuggestionState] = useState<PostStreamTwitchSuggestion | null>(null)
  const setSuggestion = useCallback((s: PostStreamTwitchSuggestion | null) => setSuggestionState(s), [])
  return (
    <RelayPromptContext.Provider value={{ suggestion, setSuggestion }}>
      {children}
    </RelayPromptContext.Provider>
  )
}

export function useRelayPrompt() {
  return useContext(RelayPromptContext)
}
