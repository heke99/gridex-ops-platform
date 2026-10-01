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

  it('separates revision-bound commands and preserves parsing only for authorized completed legacy replay', () => {
    const request = schemas.CustomerProfileUpdateRequest
    expect(request.oneOf?.map((branch) => branch.$ref)).toEqual([
      '#/components/schemas/CustomerContactChangeRequest',
      '#/components/schemas/CustomerBillingChangeRequest',
      '#/components/schemas/CustomerPreferencesChangeRequest',
      '#/components/schemas/CustomerFacilityChangeRequest',
    ])
    const contact = schemas.CustomerContactChangeRequest
    expect(contact.required).toEqual(['profile'])
    expect(contact.additionalProperties).toBe(false)
    expect(contact.properties.expected_contact_revision).toMatchObject({ type: 'integer', minimum: 0,
      description: expect.stringContaining('Required on fresh commands') })
    expect(schemas.CustomerContactFields).toMatchObject({
      additionalProperties: false, minProperties: 1,
    })
    expect(Object.keys(schemas.CustomerContactFields.properties).sort()).toEqual(['email', 'phone'])
    expect(schemas.CustomerPreferencesChangeRequest.properties.profile.$ref).toBe('#/components/schemas/CustomerPreferencesFields')
    expect(Object.keys(schemas.CustomerPreferencesFields.properties).sort()).toEqual(['language_code', 'timezone'])
    expect(Object.keys(schemas.CustomerBillingChangeRequest.properties.profile.properties)).toEqual(['invoice_email'])
    expect(schemas.CustomerBillingChangeRequest.properties.expected_billing_revision).toMatchObject({ type: 'integer', minimum: 0,
      description: expect.stringContaining('Required on fresh commands') })
    expect(schemas.CustomerFacilityUpdate.properties.facility_reference.maxLength).toBe(120)
    expect(schemas.CustomerFacilityUpdate.properties.address.properties.postal_code.maxLength).toBe(20)
    for (const kind of ['CustomerPreferencesChangeRequest', 'CustomerBillingChangeRequest', 'CustomerFacilityChangeRequest']) {
      expect(schemas[kind].properties.expected_contact_revision).toBeUndefined()
      expect(schemas[kind].additionalProperties).toBe(false)
    }

    expect(parseCustomerProfileUpdateRequest({ profile: { phone: '+46123456789' }, expected_contact_revision: 2 }))
      .toMatchObject({ expected_contact_revision: 2 })
    // The database command rejects fresh revision-less writes; retaining this
    // parse shape lets its current-authority gate resolve historical completions.
    expect(parseCustomerProfileUpdateRequest({ profile: { phone: '+46123456789' } }))
      .toEqual({ profile: { phone: '+46123456789' } })
    expect(parseCustomerProfileUpdateRequest({ profile: { invoice_email: 'invoice@example.invalid' }, expected_billing_revision: 3 }))
      .toMatchObject({ expected_billing_revision: 3 })
    expect(parseCustomerProfileUpdateRequest({ profile: { language_code: 'sv' }, expected_profile_revision: 4 }))
      .toMatchObject({ expected_profile_revision: 4 })
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
