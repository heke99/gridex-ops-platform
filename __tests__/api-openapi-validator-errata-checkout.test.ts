import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

type Schema = { required: string[]; additionalProperties: boolean; properties: Record<string, unknown> }
type OpenApi = {
  info: { version: string }
  components: { schemas: { CustomerApplicationRequest: Schema; WebsiteQuoteSettlement: unknown } }
}
type Patch = { op: string; path: string; value: unknown }[]
type Manifest = {
  status: string
  patches: {
    kind: string
    immutable_source_sha256: string
    patch_sha256: string
    derived_canonical_json_sha256: string
  }[]
}

const revision = '2026-08-22.1'
const surface = 'website-integration-v1'
const correction = 'checkout-settlement'
const archive = (version: string) => `docs/openapi/releases/${version}/${surface}.json`
const errataDirectory = 'docs/api-validator-errata'
const patchPath = `${errataDirectory}/${revision}-${surface}-${correction}.rfc6902.json`
const checkoutPointer = '/components/schemas/CustomerApplicationRequest'
const settlementPointer = `${checkoutPointer}/properties/settlement`
const archiveChecksum = '9dc264fe5adadc2304ab5ffaef188a66fe230990a6f58676fa6759a934fce8c2'

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function hash(bytes: Buffer | string) {
  return createHash('sha256').update(bytes).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = value as Record<string, unknown>
    const fields = Object.keys(entries).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(entries[key])}`)
    return `{${fields.join(',')}}`
  }
  return JSON.stringify(value)
}

describe('Website 2026-08-22.1 checkout validator erratum', () => {
  it('lists a checksum-bound request validator correction alongside the original response entries', () => {
    const manifest = readJson<Manifest>(`${errataDirectory}/manifest.json`)
    const entry = manifest.patches.find(({ kind }) => kind === correction)
    expect(entry).toMatchObject({
      revision,
      surface,
      immutable_source_path: archive(revision),
      immutable_source_sha256: archiveChecksum,
      patch_path: patchPath,
      patch_sha256: hash(readFileSync(patchPath)),
      patch_operations: 4,
      target_pointer: settlementPointer,
      does_not_change_runtime_request_requirements: true,
    })
    expect(manifest.status).toBe('CHECKSUM_BOUND_VALIDATOR_ERRATA')
    expect(hash(readFileSync(archive(revision)))).toBe(archiveChecksum)
  })

  it('adds only the missing property to a separate derivative and matches the successor checkout schema', () => {
    const original = readJson<OpenApi>(archive(revision))
    const successor = readJson<OpenApi>(archive('2026-08-22.2'))
    const checkout = original.components.schemas.CustomerApplicationRequest
    const successorCheckout = successor.components.schemas.CustomerApplicationRequest

    expect(original.info.version).toBe(revision)
    expect(checkout.required).toContain('settlement')
    expect(checkout.additionalProperties).toBe(false)
    expect(checkout.properties).not.toHaveProperty('settlement')
    expect(original.components.schemas.WebsiteQuoteSettlement).toEqual(successor.components.schemas.WebsiteQuoteSettlement)

    const patch = readJson<Patch>(patchPath)
    expect(patch).toEqual([
      { op: 'test', path: '/info/version', value: original.info.version },
      { op: 'test', path: `${checkoutPointer}/required`, value: checkout.required },
      { op: 'test', path: `${checkoutPointer}/additionalProperties`, value: checkout.additionalProperties },
      { op: 'add', path: settlementPointer, value: { $ref: '#/components/schemas/WebsiteQuoteSettlement' } },
    ])

    const derivative = structuredClone(original)
    derivative.components.schemas.CustomerApplicationRequest.properties.settlement = patch[3].value
    expect(derivative.components.schemas.CustomerApplicationRequest).toEqual(successorCheckout)
    const manifest = readJson<Manifest>(`${errataDirectory}/manifest.json`)
    const entry = manifest.patches.find(({ kind }) => kind === correction)
    expect(entry?.derived_canonical_json_sha256).toBe(hash(`${canonicalJson(derivative)}\n`))
  })
})
