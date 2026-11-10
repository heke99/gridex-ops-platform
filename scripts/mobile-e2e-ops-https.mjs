// Loopback HTTPS bridge for the isolated mobile integration job.
import { createServer } from 'node:https'
import { request } from 'node:http'
import { readFileSync } from 'node:fs'

const [keyPath, certPath] = process.argv.slice(2)
createServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (incoming, outgoing) => {
  if (!incoming.url?.startsWith('/api/v1/')) {
    outgoing.writeHead(404).end()
    return
  }
  const headers = { ...incoming.headers, host: '127.0.0.1:3101' }
  const upstream = request({
    hostname: '127.0.0.1',
    port: 3101,
    method: incoming.method,
    path: incoming.url,
    headers,
    timeout: 30000,
  }, (response) => {
    outgoing.writeHead(response.statusCode ?? 502, response.headers)
    response.pipe(outgoing)
  })
  upstream.on('timeout', () => upstream.destroy())
  upstream.on('error', () => {
    if (!outgoing.headersSent) outgoing.writeHead(502)
    outgoing.end()
  })
  outgoing.on('close', () => upstream.destroy())
  incoming.pipe(upstream)
}).listen(3443, '127.0.0.1')
