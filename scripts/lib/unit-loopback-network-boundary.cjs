'use strict'
// Unit verification boundary. Every Node child inherits this preload.
// Only loopback sockets and local IPC paths are permitted; no DNS is required.
const net = require('node:net')
const originalConnect = net.Socket.prototype.connect
const loopback = host => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(host).toLowerCase())
net.Socket.prototype.connect = function (...args) {
  let first = args[0]
  if (Array.isArray(first)) first = first[0]
  if (first && typeof first === 'object' && typeof first.path === 'string' && first.port == null) {
    return Reflect.apply(originalConnect, this, args)
  }
  const host = first && typeof first === 'object'
    ? first.host ?? first.hostname ?? 'localhost'
    : typeof args[1] === 'string' ? args[1] : 'localhost'
  if (!loopback(host)) throw new Error('unit_external_network_forbidden')
  return Reflect.apply(originalConnect, this, args)
}
for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[name]
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic-unit-only-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-unit-only-service-role-key'
