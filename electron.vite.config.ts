import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

const alias = {
  '@': resolve(__dirname, 'src/renderer/src'),
  '@shared': resolve(__dirname, 'src/shared'),
  '@main': resolve(__dirname, 'src/main'),
  '@renderer': resolve(__dirname, 'src/renderer/src'),
}

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  preload: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  renderer: {
    root: 'src/renderer',
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
    resolve: { alias },
    plugins: [react(), tailwindcss()],
  },
})
