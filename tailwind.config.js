/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      screens: {
        wide: '1200px',
      },
      colors: {
        // Slate-flavored neutral grays for backgrounds. Class names kept (navy-*)
        // so JSX doesn't need to change site-wide.
        navy: {
          900: '#0a0f1a',
          800: '#131825',
          700: '#1c2333',
          600: '#283447',
          500: '#34425a',
        },
        // Slate-hue accent with +5pp HSL saturation over Tailwind's slate scale.
        // Class names kept (purple-*) — colors are slate-with-extra-blue.
        purple: {
          950: '#1b273c',
          900: '#30415a',
          800: '#44566f',
          700: '#5f7491',
          600: '#8fa2bc', // primary button bg
          500: '#c9d5e3', // hover (lighter)
          400: '#e0e7f0', // accent text
          300: '#f1f5fa', // lightest
          200: '#f7f9fc', // near-white with cool tint — for active/highlighted text
          100: '#fbfcfe',
          50:  '#ffffff',
        },
        // Twitch brand purple — kept literal so Twitch-related UI doesn't pick up the
        // theme's slate accent and lose its brand cue.
        twitch: {
          500: '#9146ff',
          400: '#a970ff',
          300: '#bf94ff',
        },
        surface: {
          100: '#2a3447',
          200: '#243043',
          300: '#1c2538',
          400: '#161e2c',
        }
      },
      fontFamily: {
        sans: ['Recursive', 'system-ui', 'sans-serif'],
        mono: ['Recursive', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    }
  },
  plugins: []
}
