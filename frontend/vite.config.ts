import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dotenv from 'dotenv'
import path from 'node:path'

dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

const backendPort = process.env.PORT
if (!backendPort) {
  throw new Error('PORT must be set in .env for Vite API proxy configuration')
}

const backendApiTarget = `http://localhost:${backendPort}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: backendApiTarget,
        changeOrigin: true,
      },
    },
  },
})
