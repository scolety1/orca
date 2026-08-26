import { defineConfig } from 'vite'
import type { ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createRequestHandler } from '../server/http-server.mjs'

// Mounts the narrow TSF API adapter as dev-server middleware so the UI and
// its data adapter run as one process locally. Production would run
// tsf/server/http-server.mjs standalone behind the built static UI.
function tsfApiPlugin() {
  const handler = createRequestHandler()
  return {
    name: 'tsf-api-middleware',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        handler(req, res, next)
      })
    }
  }
}

// Safe Update Manager (spec Phase 1/4): stamps the built bundle with the
// real commit it was built from, so a running server can honestly answer
// "does the UI bundle I'm serving actually match my own source" instead of
// having no way to tell at all (tsf/server/runtime-identity.mjs reads this
// back). A production build only -- the dev server (tsfApiPlugin above)
// never serves a built bundle, so there is nothing to stamp there.
function buildIdentityPlugin() {
  return {
    name: 'tsf-build-identity',
    apply: 'build' as const,
    writeBundle(options: { dir?: string }) {
      let commit = null
      try {
        commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname }).toString().trim()
      } catch {
        // No git available at build time (e.g. a packaged tree with no
        // .git dir) -- write an honest null rather than a fabricated hash.
      }
      const outDir = options.dir ?? path.resolve(__dirname, 'dist')
      writeFileSync(
        path.join(outDir, 'build-identity.json'),
        JSON.stringify({ commit, builtAt: new Date().toISOString() }, null, 2)
      )
    }
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), tsfApiPlugin(), buildIdentityPlugin()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { host: '127.0.0.1', port: 4600, strictPort: true }
})
