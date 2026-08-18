import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { createRequestHandler } from '../server/http-server.mjs'

// Mounts the narrow TSF API adapter as dev-server middleware so the UI and
// its data adapter run as one process locally. Production would run
// tsf/server/http-server.mjs standalone behind the built static UI.
function tsfApiPlugin() {
  const handler = createRequestHandler()
  return {
    name: 'tsf-api-middleware',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        handler(req, res, next)
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), tsfApiPlugin()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { host: '127.0.0.1', port: 4600, strictPort: true }
})
