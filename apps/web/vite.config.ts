import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // V dev režimu web volá API přes proxy → stejný origin, bez CORS.
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' },
  },
});
