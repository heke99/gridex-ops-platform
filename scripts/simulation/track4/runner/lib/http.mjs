// Recording HTTP client: every response is summarised (status, bytes, sha256) into the active step's evidence.
import { createHash } from 'node:crypto'

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

export function createHttp({ baseUrl, onRecord }) {
  async function request(method, path, { cookie, headers = {}, json, form, label, redirect = 'manual', timeoutMs = 120_000 } = {}) {
    const url = new URL(path, baseUrl).toString()
    const init = { method, redirect, headers: { ...headers }, signal: AbortSignal.timeout(timeoutMs) }
    if (cookie) init.headers.cookie = cookie
    if (json !== undefined) {
      init.headers['content-type'] = 'application/json'
      init.body = JSON.stringify(json)
    }
    if (form) {
      init.headers.origin = new URL(baseUrl).origin
      init.body = form
    }
    const started = Date.now()
    const response = await fetch(url, init)
    const bytes = Buffer.from(await response.arrayBuffer())
    const result = {
      status: response.status,
      location: response.headers.get('location'),
      contentType: response.headers.get('content-type'),
      contentDisposition: response.headers.get('content-disposition'),
      bytes,
      sha256: sha256Hex(bytes),
      text: () => bytes.toString('utf8'),
      json: () => JSON.parse(bytes.toString('utf8')),
    }
    onRecord?.({
      label: label ?? null, method, url: url.replace(baseUrl, ''), status: result.status, location: result.location,
      contentType: result.contentType, contentDisposition: result.contentDisposition,
      bytes: bytes.length, sha256: result.sha256, ms: Date.now() - started,
    })
    return result
  }
  return {
    request,
    get: (path, options) => request('GET', path, options),
    post: (path, options) => request('POST', path, options),
  }
}
