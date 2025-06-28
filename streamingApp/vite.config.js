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
      'a22d-2409-40c2-101f-17a-19cb-4780-df38-22e4.ngrok-free.app'
    ],
    historyApiFallback: true
  }
});
