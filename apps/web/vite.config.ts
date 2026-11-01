import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // GitHub Pages serve em /pokeguide/; localmente e em outros hosts, na raiz.
  base: process.env.BASE_PATH ?? '/',
  // O dataset (~600 KB) vai inteiro no bundle de propósito, para funcionar offline.
  build: { chunkSizeWarningLimit: 1000 },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'PokéGuide',
        short_name: 'PokéGuide',
        description: 'Copiloto de Pokémon FireRed',
        lang: 'pt-BR',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f1115',
        theme_color: '#0f1115',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // O dataset inteiro vai no bundle: tudo precisa estar em cache para funcionar offline.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
});
