import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Під час розробки запити /api і /media проксіюються на Django (порт 8000).
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/media': 'http://127.0.0.1:8000',
    },
  },
})
