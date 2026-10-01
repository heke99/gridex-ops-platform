import { describe, expect, it } from 'vitest'
import portal from '@/docs/openapi/customer-portal-v1.json'

type Parameter = {
  $ref?: string
  name?: string
  in?: string
  required?: boolean
  schema?: { type?: string; format?: string; description?: string }
}
const spec = portal as unknown as {
  paths: Record<string, { get?: { parameters: Parameter[] }; post?: { parameters: Parameter[] } }>
  components: { parameters: Record<string, Parameter> }
}
const resolved = (parameters: Parameter[]) => parameters.map((parameter) =>
  parameter.$ref ? spec.components.parameters[parameter.$ref.split('/').at(-1)!] : parameter)

describe('legacy portal sync versus delegated customer identity headers', () => {
  // Independent runtime contract: legacy sync requires both UUID headers;
  // delegated customer headers are optional subject hints, not authority.
  it.each(['x-gridex-customer-portal-user-id', 'x-gridex-auth-user-id'])('keeps %s required and UUID-typed on legacy sync', (name) => {
    const parameters = resolved(spec.paths['/api/v1/customer-portal/sync'].post!.parameters)
    expect(parameters.find((parameter) => parameter.name === name)).toMatchObject({
      name, in: 'header', required: true, schema: { type: 'string', format: 'uuid' },
    })
    expect(parameters.find((parameter) => parameter.name === name)?.schema?.description)
      .not.toMatch(/optional/i)
  })

  it('keeps delegated subject hints optional without weakening mandatory signed legal authority', () => {
    const parameters = resolved(spec.paths['/api/v1/customer/legal-acceptances'].get!.parameters)
    for (const name of ['x-gridex-customer-portal-user-id', 'x-gridex-auth-user-id']) {
      const parameter = parameters.find((candidate) => candidate.name === name)
      expect(parameter).toMatchObject({ name, in: 'header', required: false, schema: { type: 'string' } })
      expect(parameter?.schema?.format).toBeUndefined()
    }
    expect(parameters.find((parameter) => parameter.name === 'x-gridex-customer-assertion'))
      .toMatchObject({ in: 'header', required: true })
  })
})
