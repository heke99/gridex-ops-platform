import { describe, expect, it } from 'vitest'
import portal from '@/docs/openapi/customer-portal-v1.json'
import { publicPortalContract, publicPortalInvoice } from '@/lib/customer-portal/publicDto'

type Schema = {
  $ref?: string
  type?: string | string[]
  format?: string
  pattern?: string
  properties?: Record<string, Schema>
  items?: Schema
  required?: string[]
}

const paths = portal.paths as unknown as Record<string, Record<string, {
  parameters: Array<{ name?: string; in?: string; required?: boolean; schema?: Schema }>
  responses: Record<string, { content?: Record<string, { schema: Schema }> }>
  'x-required-scopes': string[]
}>>
const schemas = portal.components.schemas as unknown as Record<string, Schema>

describe('delegated customer invoice contract', () => {
  it('documents the list cursor, its public invoice DTO and page envelope', () => {
    const operation = paths['/api/v1/customer/invoices'].get
    expect(operation['x-required-scopes']).toEqual(['customer_invoices.read'])
    for (const name of ['limit', 'cursor']) {
      expect(operation.parameters).toContainEqual(expect.objectContaining({ name, in: 'query' }))
    }
    expect(operation.parameters).toContainEqual(expect.objectContaining({
      name: 'x-gridex-customer-assertion', in: 'header', required: true,
    }))
    const response = operation.responses['200'].content?.['application/json'].schema
    expect(response?.properties?.data?.items?.$ref).toBe('#/components/schemas/CustomerInvoice')
    expect(response?.properties?.page?.$ref).toBe('#/components/schemas/CustomerResourcePage')
    expect(schemas.CustomerInvoice.required?.sort()).toEqual(Object.keys(publicPortalInvoice('synthetic-organization', {})).sort())
  })

  it('documents opaque invoice lookup, nested public fields and neutral 404', () => {
    const operation = paths['/api/v1/customer/invoices/{id}'].get
    const id = operation.parameters.find((item) => item.name === 'id' && item.in === 'path')
    expect(id?.schema?.format).toBeUndefined()
    expect(id?.schema?.pattern).toBe('^invoice_[A-Za-z0-9_-]{32}$')
    const response = operation.responses['200'].content?.['application/json'].schema
    expect(response?.properties?.data?.$ref).toBe('#/components/schemas/CustomerInvoiceDetail')
    const detail = schemas.CustomerInvoiceDetail
    expect(detail.required?.sort()).toEqual(['invoice', 'lines', 'documents'].sort())
    expect(detail.properties?.invoice?.$ref).toBe('#/components/schemas/CustomerInvoice')
    expect(detail.properties?.lines?.items?.$ref).toBe('#/components/schemas/CustomerInvoiceLine')
    expect(detail.properties?.documents?.items?.$ref).toBe('#/components/schemas/CustomerInvoiceDocument')
    expect(schemas.CustomerInvoiceLine.required?.sort()).toEqual([
      'line_reference', 'description', 'quantity', 'unit_price', 'amount_ex_vat',
      'vat_amount', 'amount_inc_vat', 'created_at',
    ].sort())
    expect(schemas.CustomerInvoiceDocument.required?.sort()).toEqual([
      'document_reference', 'document_type', 'title', 'file_name', 'mime_type',
      'file_size_bytes', 'status', 'secure_url', 'version', 'created_at',
    ].sort())
    expect(operation.responses['404'].content?.['application/json'].schema.$ref).toBe('#/components/schemas/ErrorEnvelope')
  })

  it('preserves unknown invoice and contract amounts as null, without inventing zero', () => {
    expect(publicPortalInvoice('synthetic-organization', {
      invoice_reference: `invoice_${'a'.repeat(32)}`,
      status: 'issued',
      total_kwh: null,
      amount_ex_vat: null,
      vat_amount: null,
      amount_inc_vat: null,
    })).toMatchObject({ total_kwh: null, amount_ex_vat: null, vat_amount: null, amount_inc_vat: null })
    expect(publicPortalContract('synthetic-organization', {
      monthly_fee_sek: null, invoice_fee_sek: null, fixed_price_ore_per_kwh: null,
      markup_ore_per_kwh: null, spot_markup_ore_per_kwh: 12,
    })).toMatchObject({
      monthly_fee_sek: null, invoice_fee_sek: null,
      fixed_price_ore_per_kwh: null, markup_ore_per_kwh: 12,
    })
    expect(publicPortalInvoice('synthetic-organization', {
      invoice_reference: `invoice_${'b'.repeat(32)}`,
      status: 'paid', amount_inc_vat: 0, total_kwh: '',
    })).toMatchObject({ amount_inc_vat: 0, total_kwh: null })
  })
})
