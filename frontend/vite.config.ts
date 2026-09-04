import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The browser never talks to a data provider directly: every request goes to
// the backend, which owns all outbound API calls and any configuration.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
