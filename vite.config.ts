import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: '/privagrane/', 
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        confidentialite: resolve(__dirname, 'confidentialite.html'),
        mentionsLegales: resolve(__dirname, 'mentions-legales.html'),
      },
    },
  },
});