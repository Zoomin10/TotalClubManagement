import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  preview: {
    host: true,
    port: process.env.PORT,
    allowedHosts: [
      "wwfc-consent-form-development.up.railway.app"
    ]
  }
})