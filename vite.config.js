import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        teamoftraders: resolve(__dirname, 'teamoftraders/index.html'),
      },
    },
  },
})
