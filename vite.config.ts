import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** production → /led-cable-mapper/ · test → /led-cable-mapper/test/ · иначе / */
function baseForMode(mode: string): string {
  if (mode === 'test') return '/led-cable-mapper/test/'
  if (mode === 'production') return '/led-cable-mapper/'
  return '/'
}

export default defineConfig(({ mode }) => ({
  base: baseForMode(mode),
  plugins: [react(), tailwindcss()],
}))
