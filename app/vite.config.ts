import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Don't add crossorigin attribute to script/link tags
    rollupOptions: {
      output: {
        // Ensure proper format
        format: 'es'
      }
    }
  }
})
