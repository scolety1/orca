// M6: serves tsf/ui's built SPA (tsf/ui/dist) for the production/plugin
// launch path, where there is no Vite dev server to fall back to (unlike
// tsf/ui's own `npm run dev`, which mounts createRequestHandler as Vite
// middleware and lets Vite itself serve everything non-/api). Kept as its
// own module so it's testable against a plain temp-directory fixture,
// never a real build.
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, sep } from 'node:path'

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

/**
 * Returns a (req, res) => boolean handler: true if it served the request,
 * false if the caller should fall through to its own 404. A request whose
 * last path segment has a file extension is treated as a real asset request
 * (404s honestly if missing); anything else falls back to index.html, since
 * tsf/ui is a client-side-routed (react-router-dom) SPA.
 */
export function createStaticUiHandler(distDir) {
  const indexPath = join(distDir, 'index.html')
  return function serveStaticUi(req, res) {
    if (!existsSync(indexPath)) {
      return false
    }
    const url = new URL(req.url, 'http://localhost')
    let requestedPath
    try {
      requestedPath = decodeURIComponent(url.pathname)
    } catch {
      return false
    }
    const candidate = join(distDir, requestedPath)
    // Reject any resolved path escaping distDir (path traversal via ../).
    // Load-bearing on POSIX (join collapses distDir/../x to the real parent
    // dir there); on Windows, path.join's own drive-relative-path handling
    // for a leading-slash segment already tends to defeat this specific
    // payload shape, but the guard is the actual, platform-independent
    // security boundary and must not be removed on that basis.
    if (candidate !== distDir && !candidate.startsWith(distDir + sep)) {
      return false
    }
    const looksLikeAsset = extname(requestedPath) !== ''
    let filePath = candidate
    if (looksLikeAsset) {
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        return false
      }
    } else {
      filePath = indexPath
    }
    const contentType = MIME_TYPES[extname(filePath)] ?? 'application/octet-stream'
    res.writeHead(200, { 'content-type': contentType })
    createReadStream(filePath).pipe(res)
    return true
  }
}
