// Mirrors the CSS custom properties defined in src/renderer/src/assets/index.css.
// Use this where a literal color string is required (e.g. canvas/Konva fills)
// and CSS var() references aren't supported.
export const theme = {
  bg: '#0a0f1a',           // --color-bg / navy-900
  bgElevated: '#131825',   // --color-bg-elevated / navy-800
  panel: '#1c2333',        // --color-panel / navy-700
  text: '#e2e8f0',         // --color-text
  accent: '#c9d5e3',       // --color-accent / purple-500
  accentLight: '#f1f5fa',  // --color-accent-light / purple-300
} as const

// Convenience: rgba helpers from the same palette
export const rgba = {
  bg: (alpha: number) => `rgba(10, 15, 26, ${alpha})`,
  panel: (alpha: number) => `rgba(28, 35, 51, ${alpha})`,
}
