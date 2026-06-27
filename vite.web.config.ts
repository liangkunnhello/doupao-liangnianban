import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import pkg from './package.json'

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __DEV_PROXY_CONFIG__: 'null',
  },
  server: { host: '127.0.0.1' },
})
