import { expect, it, vi } from 'vitest'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { selectedAddressFact, selectedInvoiceeFact } from './fixtures/prodat-ud'

// The actual renderer and source-controlled canonical version policy run.
// This file has no Auth/role/permission/SQL/receive/dispatch exercise. The only
// database import boundary is unavailable, so an accidental DB call fails.
vi.mock('@/lib/supabase/service', () => ({ supabaseService: new Proxy({}, {
  get: () => { throw new Error('pure_switch_builder_database_io_forbidden') },
}) }))
import { buildProdatZ03FromSwitch } from '@/lib/ediel/prodat/compatAdapter'

const id = (n: number) => `f0350000-0000-4000-8000-${String(n).padStart(12, '0')}`
const requestedStart = new Date(Date.now() + 28 * 86_400_000).toISOString().slice(0, 10)
const request = { id: id(1), company_id: id(2), customer_id: id(3), site_id: id(4), metering_point_id: id(5),
  grid_owner_id: id(6), operation_id: id(7), power_of_attorney_id: id(10), authorization_document_id: id(11),
  request_type: 'switch', status: 'queued', requested_start_date: requestedStart,
  current_supplier_name: 'Synthetic prior supplier', incoming_supplier_name: 'Synthetic current supplier',
  incoming_supplier_org_number: '5590001235', external_reference: 'ACTUAL-CASE-REFERENCE',
  validation_snapshot: { portalData: { customerName: 'Synthetic customer', customerId: '5590001235',
    customerIdCodeListQualifier: 'SE1', customerAddress: 'Testgatan 1', customerPostalCode: '12345',
    customerCity: 'Teststad', customerCountry: 'SE', reasonForTransaction: 'Z22',
    meteringMethod: 'Z03', powerOfAttorneyReference: 'SYNTHETIC-SIGNED-MANDATE', balanceResponsibleId: '54321',
    dependentConditionFacts: { market: 'electricity', meterReadingsSentInUtilts: true,
      endUserAddressObjects: [selectedAddressFact('735123456789012352', id(2), '9', '5590001235', ['Testgatan 1'], 'SE1')],
      invoiceeObjects: [selectedInvoiceeFact('735123456789012352', id(2), '9', '5590001235', ['Testgatan 1'], 'SE1', '12345', 'Teststad')],
    } } } }
const input = { actorUserId: id(8), senderEdielId: '12345', receiverEdielId: '60001',
  communicationRouteId: id(9), applicationReference: '23-DDQ-PRODAT', environment: 'test',
  externalReference: request.external_reference, switchRequest: request,
  site: { id: id(4), company_id: id(2), customer_id: id(3), site_type: 'consumption',
    facility_id: '735123456789012352', street: 'Testgatan 1', postal_code: '12345', city: 'Teststad',
    grid_owner_id: id(6), grid_area_code: 'SYN', current_supplier_name: 'Synthetic prior supplier' },
  meteringPoint: { id: id(5), company_id: id(2), customer_id: id(3), site_id: id(4), customer_site_id: id(4),
    meter_point_id: '735123456789012352', metering_point_id: '735123456789012352', grid_owner_id: id(6) },
  gridOwner: { id: id(6), company_id: id(2), ediel_id: '60001', owner_code: 'SYN', name: 'Synthetic grid owner' },
} as unknown as Parameters<typeof buildProdatZ03FromSwitch>[0]

it('the actual canonical Z03 builder retains its real request/site/point/party and future effective-date inputs', async () => {
  const draft = await buildProdatZ03FromSwitch(input)
  expect(draft).toMatchObject({ messageFamily: 'PRODAT', messageCode: 'Z03', switchRequestId: request.id,
    customerId: request.customer_id, siteId: request.site_id, meteringPointId: request.metering_point_id,
    gridOwnerId: request.grid_owner_id, senderEdielId: '12345', receiverEdielId: '60001' })
  const wire = tokenizeEdifact(draft.rawPayload!)
  const dtm = wire.segments.find(s => s.tag === 'DTM' && segmentComposite(s, 1, wire.una)[0] === '92')
  expect(segmentComposite(dtm, 1, wire.una)[1]).toBe(requestedStart.replaceAll('-', '') + '0000')
})

it.each([request.operation_id, null])('the actual Z03 draft carries its real operation/request identity when stored operation is %s', async operationId => {
  const draft = await buildProdatZ03FromSwitch({ ...input,
    switchRequest: { ...input.switchRequest, operation_id: operationId } })
  expect(draft.sourceOperationId ?? draft.parsedPayload?.operation_id ?? draft.parsedPayload?.operationId)
    .toBe(operationId ?? `supplier_switch_request:${request.id}`)
})
