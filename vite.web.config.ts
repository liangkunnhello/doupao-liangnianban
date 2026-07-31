import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import pkg from './package.json'

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __DEV_PROXY_CONFIG__: 'null',
  },
  server: { host: '127.0.0.1' },
})
