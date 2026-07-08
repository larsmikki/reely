import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // injectManifest strategy: we keep our hand-written service worker
    // (src/sw.ts) and the plugin injects the exact list of built assets into
    // self.__WB_MANIFEST so the app shell precache never goes stale.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false, // registration stays manual (src/offline/register.ts)
      manifest: false, // public/manifest.json is the source of truth
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json,woff,woff2}'],
      },
    }),
  ],
  publicDir: 'public',
  server: {
    port: 3030,
    proxy: {
      '/api': 'http://localhost:3031',
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
