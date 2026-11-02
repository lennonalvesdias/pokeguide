import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // GitHub Pages serve em /pokeguide/; localmente e em outros hosts, na raiz.
  base: process.env.BASE_PATH ?? '/',
  // Regras e roteiro vão no bundle principal; o mundo de Kanto (navegação) é um pedaço à parte, carregado
  // sob demanda. Os dois entram no pré-cache: funciona offline (ver docs/adr/ADR-distribuicao-de-dados.md).
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
        // Todo .js (inclusive o pedaço do mundo) fica em cache para funcionar offline.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Imagens dos Pokémon: baixadas do PokeAPI/sprites na primeira vez e guardadas para uso offline.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/raw\.githubusercontent\.com\/PokeAPI\/sprites\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'sprites',
              expiration: { maxEntries: 450, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
