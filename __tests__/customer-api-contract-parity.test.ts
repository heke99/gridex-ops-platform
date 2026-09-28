import { describe, expect, it } from 'vitest'
import portal from '@/docs/openapi/customer-portal-v1.json'
import { parseCustomerProfileUpdateRequest } from '@/lib/customer-portal/profileUpdateContract'
import { parseTenantCustomerSyncPayload } from '@/lib/customer-portal/customerSyncContract'

type Schema = {
  [key: string]: unknown
  properties: Record<string, Schema>
  oneOf?: Array<{ $ref?: string }>
}
type Operation = {
  parameters: Array<{ name: string; required: boolean }>
  responses: Record<string, { content: Record<string, { schema: Schema }> }>
  'x-required-scopes'?: string[]
}
const schemas = portal.components.schemas as unknown as Record<string, Schema>
const paths = portal.paths as unknown as Record<string, Record<string, Operation>>

describe('customer API public contract against its runtime parsers', () => {
  it('describes the delegated assertion on customer reads and contact writes, but not tenant-machine sync', () => {
    for (const [path, method] of [
      ['/api/v1/customer/me', 'get'],
      ['/api/v1/customer/profile-update', 'post'],
    ]) {
      const operation = paths[path][method]
      expect(operation.parameters).toContainEqual(expect.objectContaining({
        name: 'x-gridex-customer-assertion', in: 'header', required: true,
      }))
      expect(operation.parameters.filter((parameter) =>
        ['x-gridex-auth-user-id', 'x-gridex-customer-portal-user-id'].includes(parameter.name),
      ).every((parameter) => parameter.required === false)).toBe(true)
    }
    const sync = paths['/api/v1/customer/sync'].post
    expect(sync['x-required-scopes']).toEqual(['customer_sync.write'])
    expect(sync.parameters.some((parameter) => parameter.name === 'x-gridex-customer-assertion')).toBe(false)
    expect(sync.parameters.filter((parameter) =>
      ['x-gridex-auth-user-id', 'x-gridex-customer-portal-user-id'].includes(parameter.name),
    ).every((parameter) => parameter.required === false)).toBe(true)
  })

  it('requires a contact revision and excludes mixed writes as the parser does', () => {
    const request = schemas.CustomerProfileUpdateRequest
    expect(request.oneOf?.map((branch) => branch.$ref)).toEqual([
      '#/components/schemas/CustomerContactChangeRequest',
      '#/components/schemas/CustomerNonContactProfileUpdateRequest',
    ])
    const contact = schemas.CustomerContactChangeRequest
    expect(contact.required).toEqual(['profile', 'expected_contact_revision'])
    expect(contact.additionalProperties).toBe(false)
    expect(contact.properties.expected_contact_revision).toMatchObject({ type: 'integer', minimum: 0 })
    expect(schemas.CustomerContactFields).toMatchObject({
      additionalProperties: false, minProperties: 1,
    })
    expect(Object.keys(schemas.CustomerContactFields.properties).sort()).toEqual(['email', 'phone'])
    expect(Object.keys(schemas.CustomerNonContactFields.properties)).not.toContain('email')
    expect(Object.keys(schemas.CustomerNonContactFields.properties)).not.toContain('phone')
    expect(schemas.CustomerNonContactFields.properties.first_name.maxLength).toBe(120)
    expect(schemas.CustomerFacilityUpdate.properties.facility_reference.maxLength).toBe(120)
    expect(schemas.CustomerFacilityUpdate.properties.address.properties.postal_code.maxLength).toBe(20)
    expect(schemas.CustomerNonContactProfileUpdateRequest.properties.expected_contact_revision).toBeUndefined()

    expect(parseCustomerProfileUpdateRequest({ profile: { phone: '+46123456789' }, expected_contact_revision: 2 }))
      .toMatchObject({ expected_contact_revision: 2 })
    expect(() => parseCustomerProfileUpdateRequest({ profile: { phone: '+46123456789' } })).toThrow()
    expect(() => parseCustomerProfileUpdateRequest({
      profile: { phone: '+46123456789', first_name: 'Synthetic' }, expected_contact_revision: 2,
    })).toThrow()
  })

  it('rejects a profile and facility write that cannot commit atomically together', () => {
    expect(() => parseCustomerProfileUpdateRequest({
      profile: { first_name: 'Synthetic' },
      facility_data: { facility_reference: 'synthetic-site', address: { city: 'Stockholm' } },
    })).toThrow()
  })

  it('describes the contact revision returned by a committed contact command', () => {
    expect(schemas.CustomerProfileUpdateData.properties.contact_revision)
      .toMatchObject({ type: 'integer', minimum: 0 })
    expect(paths['/api/v1/customer/profile-update'].post.responses['409']).toBeDefined()
    expect(paths['/api/v1/customer/profile-update'].post.responses['403']).toBeDefined()
  })

  it('gives GET /me an explicit public profile DTO with the revision used by writes', () => {
    const response = paths['/api/v1/customer/me'].get.responses['200'].content['application/json'].schema
    expect(response.properties.data.$ref).toBe('#/components/schemas/CustomerMeData')
    const data = schemas.CustomerMeData
    expect(data.additionalProperties).toBe(false)
    expect(data.required).toContain('contact_revision')
    expect(data.properties.contact_revision).toMatchObject({ type: ['integer', 'null'], minimum: 0 })
    expect(data.properties.customer_id).toBeUndefined()
    expect(data.properties.portal_identity.$ref).toBe('#/components/schemas/CustomerPortalIdentity')
  })

  it('excludes the machine sync phone writer that the parser now rejects', () => {
    expect(schemas.CustomerSyncRequest.properties.profile.properties.phone).toBeUndefined()
    expect(() => parseTenantCustomerSyncPayload({ customer_number: 'synthetic-1', profile: { phone: '+46123456789' } }))
      .toThrow()
  })
})
