import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const serverUrl = process.env.VITE_SERVER_URL ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // One .env at the repo root (AGENTS.md), shared with the server and the optimize script.
  envDir: '..',
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)) },
  },
  server: {
    port: 5173,
    // Phones on the same Wi-Fi join rooms through the LAN address (the room QR code).
    host: true,
    proxy: {
      '/api': serverUrl,
      '/ws': { target: serverUrl.replace(/^http/, 'ws'), ws: true },
    },
  },
});
