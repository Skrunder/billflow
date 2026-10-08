import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

export default defineConfig(({ mode }) => ({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    // Only the standalone build bundles the on-device database (sql.js + WebAssembly).
    alias:
      mode === 'standalone'
        ? []
        : [{ find: /^\.\/data\/local\/browser$/, replacement: fileURLToPath(new URL('./src/data/local/browser.stub.ts', import.meta.url)) }],
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Custom service worker (src/sw.ts) so we can handle Web Push events.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['billflow.svg', 'theme-init.js', 'icons/billflow-apple-touch.png'],
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        id: '/',
        name: "BillFlow",
        short_name: 'BillFlow',
        description: 'Track bills, recurring payments and events — self-hosted.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0f172a',
        theme_color: '#4f46e5',
        categories: ['finance', 'productivity'],
        icons: [
          { src: '/icons/billflow-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/billflow-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/billflow-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Add bill', url: '/bills/new', icons: [{ src: '/icons/billflow-192.png', sizes: '192x192' }] },
          { name: 'Calendar', url: '/calendar', icons: [{ src: '/icons/billflow-192.png', sizes: '192x192' }] },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:4000', changeOrigin: false } },
  },
  build: {
    // The standalone app (on-device database) is built separately.
    outDir: mode === 'standalone' ? 'dist-standalone' : 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          fullcalendar: [
            '@fullcalendar/core',
            '@fullcalendar/react',
            '@fullcalendar/daygrid',
            '@fullcalendar/timegrid',
            '@fullcalendar/list',
            '@fullcalendar/interaction',
            '@fullcalendar/luxon3',
          ],
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query', 'luxon'],
        },
      },
    },
  },
}));
