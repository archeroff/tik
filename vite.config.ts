import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Always pick up new service-worker builds so players never run stale sync code.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Tic-Tac-Toe — Two Player',
        short_name: 'Tic-Tac-Toe',
        description:
          'Real-time two-player Tic-Tac-Toe. First player is X, second is O. Best of three sets.',
        theme_color: '#0b1220',
        background_color: '#0b1220',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        orientation: 'portrait',
        categories: ['games'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // The app itself needs a live connection (multiplayer), so any navigation that
        // cannot be served from the offline shell falls back to the offline splash page.
        navigateFallback: '/offline.html',
        navigateFallbackDenylist: [/^\/icons\//, /^\/manifest\.webmanifest$/],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
});
