// Test-only, loopback HTTPS ingress. The APK trusts this run's public certificate.
import { createServer } from 'node:https'
import { request } from 'node:http'
import { readFileSync } from 'node:fs'
const [keyPath, certPath] = process.argv.slice(2)
createServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (incoming, outgoing) => {
  const path = incoming.url ?? ''
  const port = path.startsWith('/auth/v1/') ? 54321 : path.startsWith('/api/') ? 3100 : null
  if (!port) { outgoing.writeHead(404).end(); return }
  const upstream = request({ hostname: '127.0.0.1', port, method: incoming.method, path,
    headers: { ...incoming.headers, host: `127.0.0.1:${port}` }, timeout: 30000 }, response => {
    outgoing.writeHead(response.statusCode ?? 502, response.headers)
    response.pipe(outgoing)
  })
  upstream.on('timeout', () => upstream.destroy())
  upstream.on('error', () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end() })
  outgoing.on('close', () => upstream.destroy())
  incoming.pipe(upstream)
}).listen(3444, '127.0.0.1')
