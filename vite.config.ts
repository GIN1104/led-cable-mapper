import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => ({
  // BASE_PATH задаётся в CI для production (/led-cable-mapper/) и test (/led-cable-mapper/test/)
  base: process.env.BASE_PATH ?? (mode === 'production' ? '/led-cable-mapper/' : '/'),
  plugins: [react(), tailwindcss()],
}))
