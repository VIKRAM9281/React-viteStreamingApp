import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist'
  },
  server: {
    host: true,
    allowedHosts: [
      'e063-2409-40c2-101f-17a-69fb-a944-42c-d3c3.ngrok-free.app'
    ],
    historyApiFallback: true
  }
});
