import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = process.env.VITE_API_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': API,
      '/live': { target: API.replace(/^http/, 'ws'), ws: true },
      // Emulador de cargador del dashboard → gateway OCPP del backend.
      '/ocpp': { target: API.replace(/^http/, 'ws'), ws: true },
    },
  },
});
