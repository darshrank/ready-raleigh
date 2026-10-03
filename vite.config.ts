import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    // the room server (wrangler dev) runs on 8787; proxy WebSockets to it
    proxy: { '/room': { target: 'http://localhost:8787', ws: true } },
  },
  worker: { format: 'es' },
  test: { environment: 'node' },
})
