import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
// https://tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react()],

  // Vite options tailored for Tauri development
  clearScreen: false,

  server: {
    // Tauri expects a fixed port; fail if not available
    port: 5173,
    strictPort: true,
    watch: {
      // Don't watch src-tauri — it's rebuilt by Tauri, not Vite
      ignored: ['**/src-tauri/**'],
    },
  },

  // Expose VITE_ and TAURI_ENV_ env vars to the frontend
  envPrefix: ['VITE_', 'TAURI_ENV_*'],

  build: {
    // Tauri v2 supports Chromium 105+, so ES2022 is safe
    target: ['es2022', 'chrome105', 'safari13'],
    // Don't minify for debug builds (tauri dev)
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    // Always produce source maps
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
})
