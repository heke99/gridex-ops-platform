#!/usr/bin/env node
const fs = require('node:fs')
const { metadata, sha256 } = require('./lib/staff-openapi-artifacts.cjs')
const { validateSchema } = require('./lib/openapi-schema-validator.cjs')

async function verify() {
  const meta = metadata(process.cwd())
  const local = fs.readFileSync('docs/openapi/staff-support-v1.json', 'utf8')
  const base = process.env.GRIDEX_API_BASE_URL?.replace(/\/$/, '')
  if (!base) throw new Error('GRIDEX_API_BASE_URL is required for live staff release verification; local artifacts are checked separately.')
  const allowedOrigin = new URL(base).origin
  const manifestResponse = await fetch(`${base}${meta.manifestPath}`, { redirect: 'error', signal: AbortSignal.timeout(20000) })
  if (!manifestResponse.ok || !manifestResponse.headers.get('content-type')?.includes('application/json')) throw new Error('Staff release manifest is unavailable or not JSON')
  const manifest = await manifestResponse.json()
  const spec = JSON.parse(local)
  const errors = validateSchema(spec, manifest, spec.components.schemas.StaffReleaseManifest, 'live staff manifest')
  if (errors.length) throw new Error(errors.join('\n'))
  if (manifestResponse.headers.get('x-gridex-contract-version') !== meta.version) throw new Error('Staff manifest response version mismatch')
  if (manifest.specification.sha256 !== sha256(local)) throw new Error('Live staff fingerprint is not the locally approved document')
  if (!/^[a-f0-9]{40}$/.test(manifest.build_commit)) throw new Error('Staff deployment has no verifiable build commit')
  if (JSON.stringify([...manifest.capabilities].sort()) !== JSON.stringify([...spec['x-staff-protocol-capabilities']].sort()) || manifest.capabilities.length !== meta.capabilities.length) throw new Error('Live staff protocol capabilities are incomplete or differ from the approved document')
  for (const [key, route] of [['url', meta.currentPath], ['immutable_url', meta.immutablePath]]) {
    const published = new URL(manifest.specification[key])
    if (published.origin !== meta.origin || published.pathname !== route || published.search || published.hash) throw new Error(`Unexpected staff specification URL: ${key}`)
    // A preview may serve the same canonical URLs in its metadata; fetch its observed origin.
    const response = await fetch(`${allowedOrigin}${route}`, { redirect: 'error', signal: AbortSignal.timeout(20000) })
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error(`Staff document unavailable: ${route}`)
    const body = await response.text()
    if (body !== local || sha256(body) !== manifest.specification.sha256) throw new Error(`Live staff bytes mismatch: ${route}`)
    if (response.headers.get('x-gridex-contract-version') !== meta.version) throw new Error(`Live staff header mismatch: ${route}`)
  }
  console.log(`Live staff ${meta.version} current/immutable document bytes and manifest match the approved local release.`)
}
verify().catch(error => { console.error(error.message); process.exitCode = 1 })
