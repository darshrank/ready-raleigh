import { defineConfig } from 'vite';

const SERVER = `http://localhost:${process.env.PORT ?? 3000}`;

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    proxy: {
      // Keep the browser's Host header so join links/QR codes point at this dev server's port.
      '/api': { target: SERVER, changeOrigin: false },
      '/qr': { target: SERVER, changeOrigin: false },
      '/packs': { target: SERVER, changeOrigin: false },
      '/socket.io': { target: SERVER, ws: true, changeOrigin: false },
    },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
});
