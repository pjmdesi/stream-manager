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
        navy: {
          900: '#0d0d1a',
          800: '#1a1a2e',
          700: '#16213e',
          600: '#1e2a4a',
          500: '#253355',
        },
        purple: {
          950: '#1e0533',
          900: '#2d0a4e',
          800: '#4a0e82',
          700: '#6b21a8',
          600: '#7c3aed',
          500: '#8b5cf6',
          400: '#a78bfa',
          300: '#c4b5fd',
        },
        surface: {
          100: '#2a2a3e',
          200: '#232338',
          300: '#1e1e32',
          400: '#1a1a2e',
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
