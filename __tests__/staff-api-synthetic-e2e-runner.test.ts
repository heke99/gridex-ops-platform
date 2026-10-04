import { createRequire } from 'node:module'
import { createPublicKey, verify } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const runner = require('../scripts/staff-api-synthetic-e2e.cjs')
afterEach(() => vi.restoreAllMocks())

describe('synthetic staff API runner', () => {
  it('creates signed ephemeral assertions and secret-free SQL with private file modes', () => {
    const state = runner.createState()
    const one = runner.assertion(state)
    const two = runner.assertion(state)
    const [header, payload, signature] = one.split('.')
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
    expect(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), createPublicKey({ key: state.publicJwk, format: 'jwk' }), Buffer.from(signature, 'base64url'))).toBe(true)
    expect(claims.sub).toBe(state.users.admin)
    expect(claims.exp - claims.iat).toBe(300)
    expect(claims.jti).not.toBe(JSON.parse(Buffer.from(two.split('.')[1], 'base64url').toString()).jti)
    const directory = mkdtempSync(join(tmpdir(), 'gridex-staff-e2e-'))
    try {
      runner.writeArtifacts(state, directory)
      expect(statSync(directory).mode & 0o777).toBe(0o700)
      expect(statSync(join(directory, 'state.private.json')).mode & 0o777).toBe(0o600)
      for (const file of ['fixture.sql', 'audit.sql', 'cleanup.sql']) {
        const sql = readFileSync(join(directory, file), 'utf8')
        expect(sql.includes(state.privateKey)).toBe(false)
        for (const key of Object.values(state.keys) as Array<{ token: string }>) expect(sql.includes(key.token)).toBe(false)
      }
      const cleanup = readFileSync(join(directory, 'cleanup.sql'), 'utf8')
      expect(cleanup).toContain("RAISE EXCEPTION 'Cleanup marker mismatch; no changes applied'")
      expect(cleanup).not.toMatch(/DELETE\s+FROM/i)
      expect(cleanup).toContain(state.keys.full.id)
      expect(cleanup).toContain(state.provider)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('exercises HTTP schemas, negative boundaries, fresh assertions, idempotency and binary integrity without logging credentials', async () => {
    const state = runner.createState()
    const output: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { output.push(String(chunk)); return true })
    let disabled = false
    let contactVersion = '2026-10-04T10:00:00.000Z'
    const replayJtis = new Set<string>()
    const caseRef = `support_case_${'a'.repeat(32)}`
    const attachmentRef = `support_attachment_${'a'.repeat(24)}`
    let file: Buffer | null = null
    const callPaths: string[] = []
    const json = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'synthetic-request', 'X-Gridex-Contract-Version': 'test' } })
    const error = (status: number, code: string) => new Response(JSON.stringify({ error: { code } }), { status, headers: { 'Content-Type': 'application/json' } })
    const fetch = async (url: URL, options: { method: string; headers: Record<string, string>; body?: string | Buffer }) => {
      callPaths.push(url.pathname)
      const headers = options.headers
      if (headers.Authorization === `Bearer ${state.keys.wildcard.token}`) return error(403, 'api_scope_missing')
      if (headers.Authorization === `Bearer ${state.keys.read.token}` && options.method !== 'GET') return error(403, 'api_scope_missing')
      const token = headers['x-gridex-staff-assertion']
      if (!token) return error(401, 'staff_assertion_missing')
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
      if (claims.iss !== state.issuer) return error(401, 'staff_assertion_issuer_mismatch')
      if (claims.aud !== state.audience) return error(401, 'staff_assertion_audience_mismatch')
      if (replayJtis.has(claims.jti)) return error(401, 'staff_assertion_replayed')
      replayJtis.add(claims.jti)
      if (claims.sub === state.users.foreign || (claims.sub === state.users.target && disabled)) return error(403, 'staff_membership_inactive')
      if (claims.sub === state.users.low) return error(403, 'staff_permission_denied')
      const body = typeof options.body === 'string' ? JSON.parse(options.body) : null
      const route = url.pathname
      if (route.startsWith(`/api/v1/staff/customers/${state.customerRefB}`) || body?.customer_reference === state.customerRefB) return error(404, 'customer_not_found')
      if (route.includes('/users')) {
        if (claims.sub === state.users.governance) {
          if (body?.role_key === 'company_admin') return error(403, 'staff_role_ceiling_exceeded')
          if (route.includes(state.users.governance) && route.endsWith('/disable')) return error(409, 'staff_self_disable_forbidden')
          if (route.includes(state.users.admin)) return error(409, 'staff_last_admin_required')
        }
        if (route.endsWith(`${state.users.target}/disable`)) disabled = true
        if (route.endsWith(`${state.users.target}/enable`)) disabled = false
        return json({}, options.method === 'POST' && route.endsWith('/users') ? 201 : 200)
      }
      if (route === '/api/v1/staff/customers') return json({ customers: [{ customer_reference: state.customerRefA }] })
      if (route.endsWith(`/customers/${state.customerRefA}`)) return json({ customer: { updated_at: contactVersion, personal_number_masked: '19121212-****' } })
      if (route.endsWith('/contact')) {
        if (headers['Idempotency-Key'] === `${state.runId}:contact`) { contactVersion = '2026-10-04T10:00:01.000Z'; return json({ customer_updated_at: contactVersion }) }
        return error(409, 'version_conflict')
      }
      if (route.endsWith('/identity-change')) return json({ status: 'applied' }, 201)
      if (route === '/api/v1/staff/cases' && options.method === 'POST') {
        if (claims.sub === state.users.target) return error(409, 'idempotency_conflict')
        return json({ case_reference: caseRef }, 201)
      }
      if (route.endsWith('/assignee') && body?.assignee_user_id === state.users.foreign) return error(422, 'staff_assignee_invalid')
      if (route.endsWith('/attachments') && options.method === 'POST') { file = options.body as Buffer; return json({ attachment_reference: attachmentRef }, 201) }
      if (route.endsWith('/file')) return new Response(file ? Uint8Array.from(file) : null, { status: 200, headers: { 'Content-Type': 'application/pdf' } })
      return json({}, options.method === 'POST' ? 201 : 200)
    }
    const report = await runner.runHttp(state, 'https://synthetic.example.invalid', fetch)
    expect(report.failed).toBe(0)
    expect(report.passed).toBeGreaterThan(40)
    expect(callPaths).toContain(`/api/v1/staff/cases/${caseRef}/attachments/${attachmentRef}/file`)
    expect(callPaths).toContain(`/api/v1/staff/cases/${caseRef}/events`)
    expect(callPaths.filter(path => path === '/api/v1/staff/users').length).toBe(2) // list + rejected invitation, no email intent
    const evidence = JSON.stringify(report) + output.join('')
    expect(evidence.includes(state.privateKey)).toBe(false)
    for (const key of Object.values(state.keys) as Array<{ token: string }>) expect(evidence.includes(key.token)).toBe(false)
    expect(evidence).not.toContain('eyJhbGci')
  })
})
