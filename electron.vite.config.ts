import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // electron-devtools-installer is a dev-only dynamic import (gated by
        // is.dev). Externalize so it's never bundled; it's a devDependency so
        // electron-builder also excludes it from packaged builds.
        external: ['electron-store', 'chokidar', 'fluent-ffmpeg', 'ffmpeg-static', 'ffprobe-static', 'glob', 'micromatch', 'uuid', 'electron-devtools-installer']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          popup: resolve('src/preload/popup.ts'),
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    css: {
      postcss: './postcss.config.js'
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          popup: resolve('src/renderer/popup.html'),
        }
      }
    }
  }
})
