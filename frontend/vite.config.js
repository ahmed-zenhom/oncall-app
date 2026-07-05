import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Forwards API calls to the backend during local dev so the frontend
      // can call relative paths like /auth/login without CORS friction.
      '/auth': 'http://localhost:4000',
      '/teams': 'http://localhost:4000',
      '/exports': 'http://localhost:4000',
      '/health': 'http://localhost:4000',
    },
  },
});
