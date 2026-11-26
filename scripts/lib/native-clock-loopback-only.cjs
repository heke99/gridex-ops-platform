'use strict'
// Native tests keep their admitted local Auth and API configuration in workers.
// This preload applies only the Node connection boundary, including in forks.
const { Socket } = require('node:net')
const connect = Socket.prototype.connect
const allowed = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

Socket.prototype.connect = function (...parameters) {
  const args = Array.isArray(parameters[0]) ? parameters[0] : parameters
  const first = args[0]
  if (first && typeof first === 'object' && typeof first.path === 'string' && first.port == null) {
    return Reflect.apply(connect, this, parameters)
  }
  const host = first && typeof first === 'object'
    ? first.host ?? first.hostname ?? 'localhost'
    : typeof args[1] === 'string' ? args[1] : 'localhost'
  if (!allowed.has(String(host).toLowerCase())) throw Error('native_clock_non_loopback_connection_forbidden')
  return Reflect.apply(connect, this, parameters)
}
