/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  define: {
    // Stempel builda — widoczny w apce, żeby od razu wiedzieć, którą wersję serwuje
    // przeglądarka (rozstrzyga problemy z cache PWA).
    __BUILD__: JSON.stringify(new Date().toISOString().slice(5, 16).replace("T", " ")),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Test Wiedzy Ekonomicznej FUE',
        short_name: 'FUE Quiz',
        description: 'Ogólnopolski quiz wiedzy ekonomicznej – Forum Uczelni Ekonomicznych',
        theme_color: '#6B21E8',
        background_color: '#070215',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Natychmiastowa aktualizacja: nowy SW przejmuje kontrolę i odświeża stare
        // cache od razu, bez konieczności zamykania wszystkich kart. Krytyczne, by
        // poprawki docierały do użytkowników bez ręcznego czyszczenia cache.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          }
        ]
      }
    })
  ],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.js"],
    // Exclude git worktrees (created by tooling under .claude) so tests don't run twice.
    // e2e/ uses Playwright's own runner (npm run e2e) — exclude from vitest.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**", "**/e2e/**"],
  },
})
