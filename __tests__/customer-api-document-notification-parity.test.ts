import { describe, expect, it } from 'vitest'
import portal from '@/docs/openapi/customer-portal-v1.json'
import { publicPortalDocument, publicPortalNotification } from '@/lib/customer-portal/publicDto'

type Schema = {
  $ref?: string
  type?: string | string[]
  pattern?: string
  properties?: Record<string, Schema>
  required?: string[]
  items?: Schema
}

const paths = portal.paths as unknown as Record<string, Record<string, {
  parameters: Array<{ name?: string; in?: string; required?: boolean; $ref?: string }>
  responses: Record<string, { content?: Record<string, { schema: Schema }> }>
  'x-required-scopes': string[]
}>>
const schemas = portal.components.schemas as unknown as Record<string, Schema>

describe('delegated customer document and notification contract', () => {
  for (const [path, scope, itemSchema] of [
    ['/api/v1/customer/documents', 'customer_documents.read', 'CustomerDocument'],
    ['/api/v1/customer/notifications', 'customer_notifications.read', 'CustomerNotification'],
  ]) {
    it(`documents the paginated public response and delegated scope for ${path}`, () => {
      const operation = paths[path].get
      expect(operation['x-required-scopes']).toEqual([scope])
      expect(operation.parameters).toContainEqual(expect.objectContaining({
        name: 'x-gridex-customer-assertion', in: 'header', required: true,
      }))
      for (const name of ['limit', 'cursor']) {
        expect(operation.parameters).toContainEqual(expect.objectContaining({ name, in: 'query' }))
      }
      const response = operation.responses['200'].content?.['application/json'].schema
      expect(response?.properties?.data?.items?.$ref).toBe(`#/components/schemas/${itemSchema}`)
      expect(response?.properties?.page?.$ref).toBe('#/components/schemas/CustomerResourcePage')
    })
  }

  it('describes the allowlisted document DTO and the optional legacy notification read_at', () => {
    const document = publicPortalDocument('synthetic-company', {
      id: '11111111-1111-4111-8111-111111111111',
      document_type: 'agreement', title: 'Synthetic document', file_name: null,
      mime_type: null, file_size_bytes: null, status: 'published',
      public_url: null, document_version: null, created_at: '2026-09-29T00:00:00Z',
      source_system: 'internal', customer_id: 'private-customer',
    })
    expect(schemas.CustomerDocument.required?.sort()).toEqual(Object.keys(document).sort())
    expect(document).toMatchObject({ file_size_bytes: null, secure_url: null })
    expect(JSON.stringify(document)).not.toContain('private-customer')

    const notification = publicPortalNotification('synthetic-company', {
      id: '22222222-2222-4222-8222-222222222222',
      type: 'info', title: 'Synthetic notice', message: null,
      status: 'unread', created_at: '2026-09-29T00:00:00Z',
      customer_id: 'private-customer', action_url: '/internal',
    })
    expect(schemas.CustomerNotification.required?.sort()).toEqual(Object.keys(notification).sort())
    expect(schemas.CustomerNotification.properties?.read_at?.type).toEqual(['string', 'null'])
    expect(notification).not.toHaveProperty('read_at')
    expect(JSON.stringify(notification)).not.toContain('private-customer')
    expect(JSON.stringify(notification)).not.toContain('/internal')
  })

  it('describes strict non-null public notification references and a neutral missing-reference error', () => {
    const operation = paths['/api/v1/customer/notifications/read'].post
    expect(operation['x-required-scopes']).toEqual(['customer_notifications.write'])
    expect(operation.parameters).toContainEqual({ $ref: '#/components/parameters/IdempotencyKey' })
    const references = schemas.CustomerNotificationReadRequest.properties?.notification_references
    expect(references?.items?.type).toBe('string')
    expect(references?.items?.pattern).toBe('^notification_[A-Za-z0-9_-]{32}$')
    expect(operation.responses['404'].content?.['application/json'].schema.$ref).toBe('#/components/schemas/ErrorEnvelope')
  })
})
