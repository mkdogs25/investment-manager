import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The browser never talks to a data provider directly: every request goes to
// the backend, which owns all outbound API calls and any configuration.
// GitHub Pages serves a project site from /<repo>/, so the base path is set at
// build time (VITE_BASE_PATH). It stays '/' for local development and for any
// host that serves the app from the domain root.
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
})
