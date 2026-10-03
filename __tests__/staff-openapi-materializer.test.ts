import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { artifacts, metadata } = require('../scripts/lib/staff-openapi-artifacts.cjs')
const { contractDefinitions } = require('../scripts/lib/staff-openapi-contract.cjs')
const roots: string[] = []
const materializer = path.join(process.cwd(), 'scripts/materialize-staff-openapi-release.cjs')

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'staff-release-test-'))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'lib/staff-api'), { recursive: true })
  fs.copyFileSync(path.join(process.cwd(), 'lib/staff-api/openApiContract.ts'), path.join(root, 'lib/staff-api/openApiContract.ts'))
  const meta = metadata(root)
  // These tiny routes exercise artifact handling, not runtime/API qualification.
  for (const operation of contractDefinitions(meta).filter((entry: { authentication: string }) => entry.authentication !== 'public')) {
    const file = path.join(root, 'app', operation.path.replace(/\{([^}]+)\}/g, '[$1]'), 'route.ts')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `export const ${operation.method} = () => null\n`)
  }
  return { root, meta }
}

function run(root: string) {
  return spawnSync(process.execPath, [materializer], { cwd: root, encoding: 'utf8' })
}

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

describe('staff artifact publication preflight', () => {
  it('withholds protocol claims in draft generation and rejects undocumented mounted methods', () => {
    const { root } = fixture()
    expect(artifacts(root).manifest.capabilities).toEqual([])
    const file = path.join(root, 'app/api/v1/staff/customers/route.ts')
    fs.appendFileSync(file, 'export const DELETE = () => null\n')
    expect(() => artifacts(root)).toThrow('Mounted staff operation lacks an explicit contract: DELETE /api/v1/staff/customers')
  })

  it('does not create current or immutable artifacts when a required method is absent', () => {
    const { root } = fixture()
    fs.rmSync(path.join(root, 'app/api/v1/staff/sessions/password/route.ts'))
    const result = run(root)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Cannot materialize staff release before implementation')
    expect(fs.existsSync(path.join(root, 'docs/openapi'))).toBe(false)
  })

  it('refuses an immutable route collision before changing current or archive bytes', () => {
    const { root, meta } = fixture()
    const route = path.join(root, 'app', meta.immutablePath, 'route.ts')
    fs.mkdirSync(path.dirname(route), { recursive: true })
    fs.writeFileSync(route, 'immutable route already owned\n')
    const current = path.join(root, 'docs/openapi/staff-support-v1.json')
    fs.mkdirSync(path.dirname(current), { recursive: true })
    fs.writeFileSync(current, 'current candidate sentinel\n')
    const result = run(root)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Refusing to mutate immutable staff route')
    expect(fs.readFileSync(current, 'utf8')).toBe('current candidate sentinel\n')
    expect(fs.existsSync(path.join(root, `docs/openapi/releases/${meta.version}/${meta.name}.json`))).toBe(false)
    expect(fs.readFileSync(route, 'utf8')).toBe('immutable route already owned\n')
  })

  it('materializes once, remains byte stable, and rejects changed source under the same version', () => {
    const { root, meta } = fixture()
    expect(run(root).status).toBe(0)
    const archive = path.join(root, `docs/openapi/releases/${meta.version}/${meta.name}.json`)
    const original = fs.readFileSync(archive, 'utf8')
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/openapi/staff-release-manifest.json'), 'utf8'))
    expect(manifest.capabilities).toEqual(meta.capabilities)
    expect(run(root).status).toBe(0)
    expect(fs.readFileSync(archive, 'utf8')).toBe(original)
    const source = path.join(root, 'lib/staff-api/openApiContract.ts')
    fs.writeFileSync(source, fs.readFileSync(source, 'utf8').replace('https://app.gridex.se', 'https://candidate.example.invalid'))
    const result = run(root)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Refusing to mutate immutable staff release')
    expect(fs.readFileSync(archive, 'utf8')).toBe(original)
  })
})
