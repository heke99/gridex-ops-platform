import {createHash, randomUUID} from 'node:crypto'
import {expect} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import {getEdielMessageById} from '@/lib/ediel/db'
import {edielSmtpConfig} from '@/lib/ediel/mailReadiness'
import {importActorRegistryXml} from '@/lib/actor-registry/importActorRegistry'
import {requireElRegistryRouteSource, requireRegistryDispatchSource, verifyElRegistryActor} from '@/lib/actor-registry/registryMarketSource'
import {resolveCustomerInfoOperationEnvironment} from '@/lib/ediel/customerInfoEnvironmentResolver'
import {sendOutboxItem} from '@/lib/ediel/outbox/sendOutboxItem'
import {enqueueCustomerDataRequestAutomation, processCustomerOperationJobs} from '@/lib/customer-operations/automation'
import {resolveCustomerSiteProcessContext} from '@/lib/customer-operations/customerSiteProcessContext'
import {matchOutboundRequestForInbound, matchMeteringPointForInbound} from '@/lib/inbound-mail/inboundMatcher'
import {resolveInboundTenantFromIdentifiers, inboundLegalReceiverEdielId} from '@/lib/ediel/tenant/resolveInboundTenant'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {createCustomerInfoRequest} from '@/lib/onboarding/infoRequests'
import {createGridOwnerDataRequest} from '@/lib/cis/db-data'
import {getGridOwnerById} from '@/lib/masterdata/db'
import {upsertPlatformGridAreaMasterRows} from '@/lib/energy/resolver'
import {setOperationSnapshotRequestReference} from '@/lib/customer-operations/automation.part-1'
import {findOrCreateDataRequestOutbound, finalizeOutboundDraft} from '@/lib/ediel/flows/shared'
import {resolveDecisionBackedOutboundContext} from '@/lib/ediel/flows/routeDecisionContext'
import {createEdielMessageIntent} from '@/lib/ediel/intent/intentEngine'
import {allocateZ01WireReferences, z01WireReferencesFromIntent} from '@/lib/ediel/prodat/z01WireReferences'
import {buildCustomerMasterdataZ01Draft} from '@/lib/ediel/intent/renderers/customerMasterdataZ01'
import {bindCustomerMasterdataDraftContext} from '@/lib/ediel/prodat/customerMasterdataDraft'
import {bindCustomerMasterdataValidationContext, prepareCustomerMasterdataSource, type CustomerMasterdataValidationContext,
  type SourceQualifiedCustomerMasterdataProjection} from '@/lib/ediel/production/customerMasterdataSource'
import {createProdatRegisterEvidence, copyProdatRegisterFacts} from '@/lib/ediel/prodat/prodatRegisterEvidence'
import {validateRulebookMessageWithRegistry} from '@/lib/ediel/rulebook/validator'
import {segmentComposite, segmentElementCount, tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {escapeEdifactData} from '@/lib/ediel/core/una'
import type {CreateEdielMessageInput} from '@/lib/ediel/types'
import {seedNormalSwitchNativeFixture, futureNativeSupplyDate, nativeSql as sql, literal, type NormalSwitchStageNativeFixture} from './ediel-normal-switch-native-fixture'
import {seedOriginalMailboxNative} from './originalMailboxNative'
import {observeSentZ01Wire, type ExternalZ02Address} from './ediel-z01-info-request-native-wire'
import {diagnoseZ01FailedWorker} from './ediel-z01-proof-observations-native'
import {classifyZ01CausalFieldRefusal} from './ediel-z01-field-refusal-native'

type Row = Record<string, unknown>
export type Z01SupplierNativeFixture = NormalSwitchStageNativeFixture & {
  variant: 'L' | 'LK'
  provider: (email: string) => void
  z01RouteId: string
  z01RouteProfileId: string
  ackRouteId: string
  ackRouteProfileId: string
  customerAddress: ExternalZ02Address
  customerMasterdataSource: SourceQualifiedCustomerMasterdataProjection
  installationAddress: ExternalZ02Address
  registry: Awaited<ReturnType<typeof importZ01RegistryFixture>> & {
    dispatchSource: Awaited<ReturnType<typeof requireRegistryDispatchSource>>
    environmentResolution: Awaited<ReturnType<typeof resolveCustomerInfoOperationEnvironment>>
  }
}

function phaseFailure(phase: string, observations: unknown): never {
  throw new Error(`native_z01_${phase}:${JSON.stringify(observations)}`)
}

async function importZ01RegistryFixture(f: NormalSwitchStageNativeFixture) {
  const adminState = () => sql<{rows: Row[]; allowed: boolean}>(`SELECT jsonb_build_object('rows',
    (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM public.admin_users a WHERE user_id=${literal(f.actorUserId)}),
    'allowed',public.canonical_actor_is_platform_admin(${literal(f.actorUserId)}))`)
  const adminBefore = adminState(), grantId = randomUUID()
  expect(adminBefore).toEqual({rows: [], allowed: false})
  const name = sql<string>(`SELECT to_jsonb(name) FROM public.platform_market_actors WHERE id=${literal(f.marketActorId)}`)
  const xmlText = (value: string) => value.replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[char]!))
  // This is a declared synthetic registry upload, not an issuer's attestation.
  const xml = `<Market Code="EL" Country="SE"><Company><Name>${xmlText(name)}</Name><Key Type="EdielId">${xmlText(f.receiver)}</Key><Role>DSO</Role><EDIFACTDetails Type="PRODAT"><Environment>test</Environment><ApplicationReference>23-DDQ-PRODAT</ApplicationReference><PartyId>${xmlText(f.receiver)}</PartyId><InterchangePartyId>${xmlText(f.receiver)}</InterchangePartyId><CommunicationAddress Type="SMTP">recipient@example.invalid</CommunicationAddress></EDIFACTDetails></Company></Market>`
  let importResult: Awaited<ReturnType<typeof importActorRegistryXml>>, verification: Awaited<ReturnType<typeof verifyElRegistryActor>>, routeId: string
  try {
    // Public prospective administrative input, confined to these two real
    // producers. No preparation, worker, source reader or send runs as admin.
    sql(`INSERT INTO public.admin_users(id,user_id,role,is_active,metadata) VALUES(${literal(grantId)},${literal(f.actorUserId)},'platform_admin',true,'{"synthetic_native_registry_import":true}')`)
    expect(adminState().allowed).toBe(true)
    importResult = await importActorRegistryXml({xml, uploadedBy: f.actorUserId, sourceFilename: 'synthetic-z01-registry.xml'})
    const routeIds: unknown = Reflect.get(importResult, 'routeIds'), actors: unknown = Reflect.get(importResult, 'actors')
    if (!Array.isArray(routeIds) || routeIds.length !== 1 || typeof routeIds[0] !== 'string'
      || !Array.isArray(actors) || actors.length !== 1) phaseFailure('registry_actual_import_ids_required', importResult)
    routeId = routeIds[0]
    const actorId = objectRecord(actors[0]).actorId
    if (typeof actorId !== 'string' || actorId !== f.marketActorId) phaseFailure('registry_import_actor_mismatch', importResult)
    verification = await verifyElRegistryActor({actorUserId: f.actorUserId, actorId, routeId})
    expect(verification).toEqual({actorId, routeIds: [routeId], market: 'EL', autoSendAllowed: false})
  } finally {
    sql(`DELETE FROM public.admin_users WHERE id=${literal(grantId)} AND user_id=${literal(f.actorUserId)}`)
    expect(adminState()).toEqual(adminBefore)
  }
  const adminAfter = adminState(), source = await requireElRegistryRouteSource(routeId)
  expect(source).toMatchObject({actorId: f.marketActorId, routeId, market: 'EL', countryCode: 'SE', legalEdielId: f.receiver,
    sourceSha256: createHash('sha256').update(xml, 'utf8').digest('hex'), roles: ['grid_owner'],
    wire: {actorId: f.marketActorId, market: 'EL', family: 'PRODAT', environment: 'test', subaddress: null,
      applicationReference: '23-DDQ-PRODAT', address: 'recipient@example.invalid', transport: 'SMTP', partyId: f.receiver, interchangePartyId: f.receiver}})
  return {source, importResult, verification, adminBefore, adminAfter}
}

/** Declared disposable upstream inputs. The reused base owns genuine contract
 * publication/signature/PDF/authorization producers and its explicitly
 * synthetic signed source declarations; those are not real customer/issuer
 * approval. This file writes public prospective process/address/routing/admin
 * inputs and calls the real registry importer. It never inserts source admission, assessments, snapshots, dispatch
 * receipts, watches or an accepted response. SMTP is the sole injected port.
 */
export async function createZ01SupplierNativeFixture(variant: 'L' | 'LK', provider: (email: string) => void): Promise<Z01SupplierNativeFixture> {
  const f = await seedNormalSwitchNativeFixture({deferOriginal: true, requestedStartDate: futureNativeSupplyDate(), provider})
  const registry = await importZ01RegistryFixture(f)
  const z01RouteId = randomUUID(), z01RouteProfileId = randomUUID(), ackRouteId = randomUUID(), ackRouteProfileId = randomUUID()
  const smtp = edielSmtpConfig()
  // Observe the existing producer's literal signed source through the same real
  // preparation API as the Z01 renderer. Billing and installation cannot supply UD.
  const customerMasterdataSource = await prepareCustomerMasterdataSource({companyId: f.companyId, customerId: f.customerId,
    actorUserId: f.actorUserId, environment: 'test'})
  expect(customerMasterdataSource.customerIdentity).toEqual(f.customerIdentity)
  const masterdata = customerMasterdataSource.endUserMasterdata
  if (masterdata.streetParts.length !== 1) phaseFailure('external_address_requires_single_source_street', masterdata)
  const customerAddress = {street: masterdata.streetParts[0], city: masterdata.city, postalCode: masterdata.postalCode, country: masterdata.country}
  const installationAddress = {street: 'Synthetic installation road 2', city: 'Teststad', postalCode: '12345', country: 'SE'}
  const processType = variant === 'LK' ? 'move_in' : 'supplier_switch_existing_site'
  // The base's ready status is excluded by the real site-process resolver.
  // Preserve the signed contract and its source hash; select the prospective
  // process through the site's and draft request's declared public inputs.
  sql(`UPDATE public.supplier_switch_requests SET status='draft',request_type=${literal(variant === 'LK' ? 'move_in' : 'switch')},
    prodat_variant=${literal(variant)},prodat_reason=${literal(variant === 'LK' ? 'Z23' : 'Z22')},
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('process_type',${literal(processType)})
    WHERE id=${literal(f.switchId)} AND company_id=${literal(f.companyId)};
    UPDATE public.customer_sites SET street=${literal(installationAddress.street)},city=${literal(installationAddress.city)},
      postal_code=${literal(installationAddress.postalCode)},country=${literal(installationAddress.country)},
      move_in_date=${variant === 'LK' ? `${literal(f.requestedStartDate)}::date` : 'NULL'},
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('process_type',${literal(processType)})
      WHERE id=${literal(f.siteId)} AND company_id=${literal(f.companyId)};
    UPDATE public.grid_owners SET platform_market_actor_id=${literal(f.marketActorId)}
      WHERE id=${literal(f.gridId)} AND company_id=${literal(f.companyId)};
    INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email,route_type,auth_config)
      VALUES(${literal(z01RouteId)},${literal(f.companyId)},'Synthetic Z01 customer data route','customer_masterdata',${literal(f.gridId)},'bilateral_test',true,
        ${literal(registry.source.wire.address)},'ediel_partner',jsonb_build_object('platform_actor_route_id',${literal(registry.source.routeId)})),
      (${literal(ackRouteId)},${literal(f.companyId)},'Synthetic Z01 reply ACK route','ediel_ack',${literal(f.gridId)},'bilateral_test',true,'recipient@example.invalid','ediel_partner','{}');
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,
      sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,payload_format,transport_security_mode,
      smtp_to,receiver_email,mailbox,smtp_host,smtp_port,message_family,business_code,message_code,receiver_source,transport_type,receiver_sub_address,metadata)
      VALUES(${literal(z01RouteProfileId)},${literal(f.companyId)},${literal(z01RouteId)},'Synthetic Z01 customer data profile','test','edifact',
        ${literal(f.sender)},${literal(registry.source.wire.interchangePartyId)},${literal(registry.source.wire.applicationReference)},true,true,'edifact','unencrypted',
        ${literal(registry.source.wire.address)},${literal(registry.source.wire.address)},${literal(smtp.from)},${literal(smtp.host)},${literal(smtp.port)},
        'PRODAT','Z01','Z01','selected_metering_point_grid_owner','smtp',${literal(registry.source.wire.subaddress)},jsonb_build_object('platform_actor_route_id',${literal(registry.source.routeId)})),
      (${literal(ackRouteProfileId)},${literal(f.companyId)},${literal(ackRouteId)},'Synthetic Z01 reply generic ACK profile','test','edifact',
        ${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,true,'edifact','unencrypted',
        'recipient@example.invalid','recipient@example.invalid',${literal(smtp.from)},${literal(smtp.host)},${literal(smtp.port)},NULL,NULL,NULL,NULL,'smtp',NULL,'{}');`)
  const dispatchSource = await requireRegistryDispatchSource({companyId: f.companyId, communicationRouteId: z01RouteId,
    routeProfileId: z01RouteProfileId, environment: 'test', messageFamily: 'PRODAT', applicationReference: '23-DDQ-PRODAT'})
  expect(dispatchSource).toMatchObject({...registry.source, companyId: f.companyId, communicationRouteId: z01RouteId,
    routeProfileId: z01RouteProfileId, selectedApplicationReference: '23-DDQ-PRODAT'})
  const environmentResolution = await resolveCustomerInfoOperationEnvironment({companyId: f.companyId,
    explicitEnvironment: 'test', messageFamily: 'PRODAT', messageCode: 'Z01'})
  expect(environmentResolution).toMatchObject({status: 'resolved', environment: 'test', routeProfileId: z01RouteProfileId, blocker: null})
  const process = await resolveCustomerSiteProcessContext({companyId: f.companyId, customerId: f.customerId, siteId: f.siteId})
  expect(process.processType, JSON.stringify(process)).toBe(processType)
  return {...f, variant, provider, z01RouteId, z01RouteProfileId, ackRouteId, ackRouteProfileId,
    customerAddress, customerMasterdataSource, installationAddress, registry: {...registry, dispatchSource, environmentResolution}}
}

function knownAreaSourceRows(f: Z01SupplierNativeFixture) {
  return sql<Row>(`SELECT jsonb_build_object(
    'site',(SELECT to_jsonb(r) FROM public.customer_sites r WHERE id=${literal(f.siteId)} AND company_id=${literal(f.companyId)}),
    'point',(SELECT to_jsonb(r) FROM public.metering_points r WHERE id=${literal(f.pointId)} AND company_id=${literal(f.companyId)}),
    'grid',(SELECT to_jsonb(r) FROM public.grid_owners r WHERE id=${literal(f.gridId)} AND company_id=${literal(f.companyId)}),
    'platformActor',(SELECT to_jsonb(r) FROM public.platform_market_actors r WHERE id=${literal(f.marketActorId)}),
    'platformOwners',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.platform_grid_owners r
      WHERE r.market_actor_id=${literal(f.marketActorId)} OR r.ops_grid_owner_id=${literal(f.gridId)} OR r.ediel_id=${literal(f.receiver)}
      OR r.id IN(SELECT grid_owner_id FROM public.platform_grid_areas WHERE grid_area_code=${literal(f.gridAreaCode)})),
    'originalArea',(SELECT to_jsonb(r) FROM public.platform_grid_areas r WHERE grid_area_code=${literal(f.gridAreaCode)}),
    'messages',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.ediel_messages r WHERE company_id=${literal(f.companyId)}),
    'sources',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.source_message_id),'[]') FROM gridex_received_sources.sources r WHERE company_id=${literal(f.companyId)}),
    'watches',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.ediel_business_expectations r WHERE company_id=${literal(f.companyId)}),
    'requests',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.customer_info_requests r WHERE company_id=${literal(f.companyId)}),
    'snapshots',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.customer_operation_request_snapshots r WHERE company_id=${literal(f.companyId)}))`)
}

/** A distinct known reference area isolates original-area correlation from
 * unknown-area and price-area holds. Only the existing public importer may
 * create the declared synthetic reference; it cannot change the source rows.
 */
export async function ensureZ01SupplierKnownWrongGridArea(f: Z01SupplierNativeFixture) {
  const before = knownAreaSourceRows(f)
  const sourcePoint = objectRecord(before.point), sourceGrid = objectRecord(before.grid), sourceSite = objectRecord(before.site)
  const priceArea = String(sourcePoint.price_area_code ?? ''), gridOwnerName = String(sourceGrid.name ?? '')
  if (!/^SE[1-4]$/.test(priceArea) || !gridOwnerName || sourceSite.price_area_code !== priceArea)
    phaseFailure('known_area_source_mapping_required', {sourcePoint, sourceGrid, sourceSite})
  const valid = `is_active IS TRUE AND price_area=${literal(priceArea)} AND grid_owner_name=${literal(gridOwnerName)}
    AND (valid_from IS NULL OR valid_from<=(now() AT TIME ZONE 'Etc/GMT-1')::date)
    AND (valid_to IS NULL OR valid_to>=(now() AT TIME ZONE 'Etc/GMT-1')::date)`
  let row = sql<Row | null>(`SELECT to_jsonb(r) FROM public.platform_grid_areas r WHERE ${valid}
    AND grid_area_code~'^[A-Z0-9]{3}$' AND grid_area_code<>${literal(f.gridAreaCode)} ORDER BY grid_area_code LIMIT 1`)
  let importResult: Awaited<ReturnType<typeof upsertPlatformGridAreaMasterRows>> | null = null
  if (!row) {
    // The public importer updates an existing noncanonical name match. Refuse
    // that branch so no existing platform DSO can be changed by this control.
    const ownerRows = sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.platform_grid_owners r
      WHERE public.gridex_grid_owner_name_key(name)=public.gridex_grid_owner_name_key(${literal(gridOwnerName)})`)
    const canonicalOwners = ownerRows.filter(r => r.is_active !== false && typeof r.ediel_id === 'string'
      && r.ediel_id.trim() && r.ops_grid_owner_id !== null)
    if (ownerRows.length && canonicalOwners.length !== 1) phaseFailure('known_area_import_would_change_existing_owner', ownerRows)
    const gridAreaCode = sql<string | null>(`SELECT to_jsonb(code) FROM (SELECT 'Z'||upper(lpad(to_hex(n),2,'0')) code
      FROM generate_series(0,255) n) candidates WHERE code<>${literal(f.gridAreaCode)}
      AND NOT EXISTS(SELECT FROM public.platform_grid_areas WHERE grid_area_code=code) ORDER BY code LIMIT 1`)
    if (!gridAreaCode) phaseFailure('known_area_no_fresh_reference_code', {priceArea, gridOwnerName})
    importResult = await upsertPlatformGridAreaMasterRows([{gridAreaCode, priceArea, gridOwnerName,
      gridAreaName: 'Synthetic distinct Z01 reply area', metadata: {synthetic_native_fixture: true}}])
    if (importResult.length !== 1 || !importResult[0].ok || !importResult[0].id) phaseFailure('known_area_import_failed', importResult)
    row = sql<Row | null>(`SELECT to_jsonb(r) FROM public.platform_grid_areas r WHERE id=${literal(importResult[0].id)}
      AND grid_area_code=${literal(gridAreaCode)} AND ${valid}`)
  }
  if (!row || typeof row.grid_area_code !== 'string') phaseFailure('known_area_readback_unqualified', {row, importResult})
  const mapping = sql<{count: number; priceArea: string | null}>(`SELECT jsonb_build_object(
    'count',count(DISTINCT upper(price_area)),'priceArea',min(upper(price_area))) FROM public.platform_grid_areas
    WHERE is_active IS TRUE AND upper(grid_area_code)=upper(${literal(row.grid_area_code)}) AND upper(price_area) IN('SE1','SE2','SE3','SE4')
    AND (valid_from IS NULL OR valid_from<=(now() AT TIME ZONE 'Etc/GMT-1')::date)
    AND (valid_to IS NULL OR valid_to>=(now() AT TIME ZONE 'Etc/GMT-1')::date)`)
  expect(mapping).toEqual({count: 1, priceArea})
  const after = knownAreaSourceRows(f)
  expect(after, 'Public reference import must preserve the complete original source rows').toEqual(before)
  expect(row.grid_area_code).not.toBe(f.gridAreaCode)
  return {gridAreaCode: row.grid_area_code, priceArea, gridOwnerName, row, mapping, importResult, before, after}
}

/** Enqueue/claim/worker/create/queue/render/outbox/provider are all real.
 * Nothing rewrites a blocked result or stamps a source ready for the test.
 */
export async function originateZ01SupplierRequest(f: Z01SupplierNativeFixture,
  afterEnqueue?: (queued: Awaited<ReturnType<typeof enqueueCustomerDataRequestAutomation>>) => Promise<void>) {
  const queued = await enqueueCustomerDataRequestAutomation({companyId: f.companyId, customerId: f.customerId,
    siteId: f.siteId, meteringPointId: f.pointId, actorUserId: f.actorUserId, source: 'synthetic_z01_native_acceptance'})
  if (queued.redirectedToManualFacilityRequest) phaseFailure('enqueue_redirect', queued)
  // Observe the real active-job window before any worker completes this job.
  // This hook cannot replace the enqueue, worker, publication or physical send.
  await afterEnqueue?.(queued)
  const worker = await processCustomerOperationJobs({workerId: `z01-native-${f.companyId}`, limit: 100})
  const job = sql<Row | null>(`SELECT to_jsonb(j) FROM public.customer_operation_jobs j WHERE id=${literal(queued.id)} AND company_id=${literal(f.companyId)}`)
  const requests = sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.customer_info_requests r
    WHERE company_id=${literal(f.companyId)} AND operation_id=${literal(queued.operationId)} AND customer_id=${literal(f.customerId)} AND site_id=${literal(f.siteId)}`)
  if (requests.length !== 1 || typeof requests[0].ediel_message_id !== 'string') {
    const diagnostic = await diagnoseZ01FailedWorker(f, queued.operationId, job?.status === 'queued' && typeof job.last_error_code === 'string')
    phaseFailure('worker_no_own_z01', {worker, job, requests, diagnostic})
  }
  const requestId = String(requests[0].id)
  const originalZ01 = await getEdielMessageById(String(requests[0].ediel_message_id), {companyId: f.companyId})
  if (!originalZ01?.raw_payload) phaseFailure('original_unavailable', {worker, job, requests})
  expect(originalZ01.communication_route_id).toBe(f.z01RouteId)
  expect(originalZ01.route_profile_id).toBe(f.z01RouteProfileId)
  expect(originalZ01).toMatchObject({environment: 'test', message_family: 'PRODAT', transport_type: 'smtp',
    receiver_ediel_id: f.registry.source.wire.interchangePartyId, receiver_sub_address: f.registry.source.wire.subaddress,
    receiver_email: f.registry.source.wire.address, application_reference: f.registry.source.wire.applicationReference})
  const wire = observeSentZ01Wire({rawPayload: originalZ01.raw_payload, point: f.external})
  expect(wire.parties.transport.receiverComponents[0]).toBe(f.registry.source.wire.interchangePartyId)
  expect(wire.parties.transport.receiverComponents[2] || null).toBe(f.registry.source.wire.subaddress)
  expect(wire.parties.legalReceiver).toMatchObject({id: f.registry.source.legalEdielId, country: f.registry.source.countryCode})
  expect(wire.parties.applicationReference).toBe(f.registry.source.wire.applicationReference)
  expect(wire.subtype).toBe(f.variant)
  expect(wire.gridAreaCode).toBe(f.gridAreaCode)
  expect(wire.customerIdentity).toEqual(f.customerIdentity)
  expect(wire.agreedStartMinute).toBe(f.requestedStartDate.replaceAll('-', '') + '0000')
  expect([requests[0].transaction_reference, requests[0].correlation_reference]).toContain(wire.lineReference)
  const outboxes = sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]') FROM public.ediel_outbox o
    WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(originalZ01.id)}`)
  if (outboxes.length !== 1) phaseFailure('outbox_ambiguous', {outboxes, originalId: originalZ01.id})
  const outboxId = String(outboxes[0].id)
  f.provider(String(originalZ01.receiver_email))
  const sendResult = await sendOutboxItem({actorUserId: f.actorUserId, outboxItemId: outboxId, smtpMimeMode: 'nodemailer-attachment'})
  if (sendResult.status !== 'sent') phaseFailure('actual_send_blocked', sendResult)
  const sent = await getEdielMessageById(originalZ01.id, {companyId: f.companyId})
  if (!sent) phaseFailure('sent_original_unavailable', originalZ01.id)
  const request = sql<Row>(`SELECT to_jsonb(r) FROM public.customer_info_requests r WHERE id=${literal(requestId)} AND company_id=${literal(f.companyId)}`)
  const snapshot = sql<Row | null>(`SELECT to_jsonb(s) FROM public.customer_operation_request_snapshots s WHERE company_id=${literal(f.companyId)}
    AND operation_id=${literal(queued.operationId)} AND request_kind='customer_data_request' AND request_reference=${literal(requestId)} AND superseded_at IS NULL`)
  expect(request.status).toBe('waiting_for_z02')
  expect(snapshot, JSON.stringify({worker, job, request})).not.toBeNull()
  expect(sent.raw_payload).toBe(originalZ01.raw_payload)
  return {jobId: queued.id, operationId: queued.operationId, worker, job, requestId, request, originalZ01: sent,
    outboxId, sendResult, snapshot, wire}
}

/** A declared mailbox/raw-mail input is retained through the real parse,
 * matcher, tenant resolver, reception adapter and normal inbound kernel.
 * The result includes the actual decision, including honest held outcomes.
 */
export async function attemptZ01SupplierMailIntake(f: Z01SupplierNativeFixture, raw: string) {
  const mailbox = await seedOriginalMailboxNative(sql, literal, {companyId: f.companyId, environment: 'test', raw,
    smtpFrom: edielSmtpConfig().from, senderEmail: 'recipient@example.invalid'})
  const parsed = mailbox.parsed
  const [match, pointMatch] = await Promise.all([
    matchOutboundRequestForInbound({companyId: f.companyId, parsed, inboundEmailMessageId: mailbox.inboundEmailMessageId, parseResultId: mailbox.parseResultId}),
    matchMeteringPointForInbound({companyId: f.companyId, parsed, inboundEmailMessageId: mailbox.inboundEmailMessageId, parseResultId: mailbox.parseResultId}),
  ])
  const tenant = await resolveInboundTenantFromIdentifiers({mailboxCompanyId: f.companyId, mailboxId: mailbox.mailboxId,
    environment: 'test', senderEdielId: parsed.senderEdielId, senderSubaddress: parsed.senderSubAddress,
    receiverEdielId: parsed.receiverEdielId, receiverSubaddress: parsed.receiverSubAddress,
    marketActorEdielId: inboundLegalReceiverEdielId(raw, parsed.receiverEdielId),
    applicationReference: parsed.applicationReference, messageFamily: parsed.messageFamily, messageCode: parsed.messageCode,
    referenceCandidates: Object.values(parsed.references).flat()})
  if (tenant.companyId && tenant.companyId !== f.companyId) phaseFailure('foreign_tenant_resolution', tenant)
  const id = await createInboundEdielMessage({companyId: f.companyId, actorUserId: f.actorUserId, environment: 'test',
    inboundEmailMessageId: mailbox.inboundEmailMessageId, parseResultId: mailbox.parseResultId, parsed,
    outboundMatch: match, meteringPointMatch: pointMatch, tenantResolution: tenant})
  return {id, mailbox, match, pointMatch, tenant}
}

export async function receiveZ01SupplierReply(f: Z01SupplierNativeFixture, raw: string) {
  const {id, mailbox, match, pointMatch, tenant} = await attemptZ01SupplierMailIntake(f, raw)
  if (!id) phaseFailure('intake_no_message', {match, pointMatch, tenant})
  const initialProcessed = await processInboundEdielMessage({actorUserId: f.actorUserId, edielMessageId: id})
  const ownResponseJobs = () => sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY j.created_at,j.id),'[]')
    FROM public.customer_operation_jobs j WHERE company_id=${literal(f.companyId)}
    AND job_type='apply_inbound_grid_owner_response' AND payload->>'ediel_message_id'=${literal(id)}`)
  const inboundResponseJobsBefore = ownResponseJobs()
  // The actual enqueue triggers own correlation, payload, snapshot and atomic
  // apply. The worker consumes their real result and finishes the linked request.
  // A held source without its own response job must retain its intake reason.
  const inboundWorker = inboundResponseJobsBefore.length
    ? await processCustomerOperationJobs({workerId: `z01-inbound-${id}`, limit: 100}) : null
  const inboundResponseJobsAfter = ownResponseJobs()
  const inboundResponseJob = inboundResponseJobsAfter.length === 1 ? inboundResponseJobsAfter[0] : null
  const initialGate = objectRecord(inboundResponseJobsBefore[0]?.result)
  const alreadyConsumedAtomicApply = initialGate.z02_atomic_core_applied === true && objectRecord(initialGate.z02_atomic_core).ok === true
  // Completed jobs are outside enqueue's active duplicate selector. Replaying
  // an already consumed apply could enqueue a new job, so retry only when the
  // first consumer had no confirmed apply but the real worker completed it.
  const processorRetried = inboundResponseJob?.status === 'completed' && !alreadyConsumedAtomicApply
  const processed = processorRetried
    ? await processInboundEdielMessage({actorUserId: f.actorUserId, edielMessageId: id}) : initialProcessed
  const message = await getEdielMessageById(id)
  if (!message) phaseFailure('processed_source_unavailable', id)
  expect(message.raw_payload).toBe(raw)
  return {id, message, mailbox, match, pointMatch, tenant, processed, initialProcessed, processorRetried,
    inboundWorker, inboundResponseJob, inboundResponseResult: inboundResponseJob?.result ?? null,
    inboundResponseJobsBefore, inboundResponseJobsAfter}
}

export type Z01OutboundField = '311' | '312' | '202' | '203' | '205' | '206' | '207' | '208' | '314' | '209' | '210' | '223' | '260' | '261' | '226' | 'END_USER_GROUP' | '227' | '228' | '231' | '232' | '316' | '229' | '233' | '234' | 'INSTALLATION_GROUP'

function objectRecord(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
}

/** Release-aware removal of exactly one physical national field. Envelope
 * counts are repaired mechanically; no source values or applicability facts
 * are invented. Removing the optional IT parent is a separate positive probe.
 */
function omitOutboundZ01Field(raw: string, field: Z01OutboundField): string {
  const wire = tokenizeEdifact(raw)
  const unh = wire.segments.find(segment => segment.tag === 'UNH')!
  const type = segmentComposite(unh, 2, wire.una)
  if (field === '312') type[4] = ''
  const render = (elements: string[][]) => elements.map(element => element.map(value => escapeEdifactData(value, wire.una))
    .join(wire.una.componentDataElementSeparator)).join(wire.una.dataElementSeparator)
  const business: string[] = []
  let skipCharacteristicValue = false
  for (const token of wire.segments) {
    if (['UNB', 'UNH', 'UNT', 'UNZ'].includes(token.tag)) continue
    if (skipCharacteristicValue) {
      skipCharacteristicValue = false
      if (token.tag !== 'CAV') throw new Error('native_z01_own_reason_pair_required')
      continue
    }
    const elements = Array.from({length: segmentElementCount(token, wire.una) + 1}, (_, index) => segmentComposite(token, index, wire.una))
    const qualifier = elements[1]?.[0]
    if ((field === '205' && token.tag === 'DTM' && qualifier === '137')
      || (field === '206' && token.tag === 'DTM' && qualifier === 'ZZZ')
      || (field === '210' && token.tag === 'DTM' && qualifier === '92')
      || (field === '207' && token.tag === 'NAD' && qualifier === 'FR')
      || (field === '208' && token.tag === 'NAD' && qualifier === 'DO')
      || (field === 'END_USER_GROUP' && token.tag === 'NAD' && qualifier === 'UD')
      || (field === 'INSTALLATION_GROUP' && token.tag === 'NAD' && qualifier === 'IT')
      || (token.tag === 'RFF' && ((field === '260' && qualifier === 'Z05') || (field === '261' && qualifier === 'ANJ') || (field === '226' && qualifier === 'LI')))) continue
    if (field === '223' && token.tag === 'CCI' && elements[2]?.[0] === 'Z13') {skipCharacteristicValue = true; continue}
    if (token.tag === 'BGM' && (field === '202' || field === '203')) elements[field === '202' ? 1 : 2] = ['']
    if (token.tag === 'LIN' && field === '314') elements[1] = ['']
    if (token.tag === 'LIN' && field === '209') elements[3][0] = ''
    if (token.tag === 'NAD' && qualifier === 'UD') {
      if (field === '227') elements[2][0] = ''
      const slot = ({'228': 4, '229': 5, '231': 8, '232': 6, '316': 9} as Partial<Record<Z01OutboundField, number>>)[field]
      if (slot !== undefined) elements[slot] = ['']
    }
    if (token.tag === 'NAD' && qualifier === 'IT') {
      if (field === '233') elements[2][0] = ''
      if (field === '234') elements[5] = ['']
    }
    business.push(render(elements))
  }
  const unb = wire.segments.find(segment => segment.tag === 'UNB')!, unz = wire.segments.find(segment => segment.tag === 'UNZ')!
  const unbElements = Array.from({length: segmentElementCount(unb, wire.una) + 1}, (_, index) => segmentComposite(unb, index, wire.una))
  if (field === '311') unbElements[7] = ['']
  const reference = segmentComposite(unh, 1, wire.una)
  // Preserve the original service date, technical parties and identifiers.
  // Only selected APP/version data and the mechanical UNT count can change.
  return wire.una.raw + [field === '311' ? render(unbElements) : unb.raw,
    field === '312' ? render([['UNH'], reference, type]) : unh.raw, ...business,
    render([['UNT'], [String(business.length + 2)], reference]), unz.raw]
    .map(segment => segment + wire.una.segmentTerminator).join('')
}

function outboundFieldEffects(f: Z01SupplierNativeFixture) {
  return sql<Row>(`SELECT jsonb_build_object(
    'originals',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)}),
    'outbox',(SELECT count(*) FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)}),
    'attempts',(SELECT count(*) FROM gridex_ediel_transport.attempts WHERE company_id=${literal(f.companyId)}),
    'customers',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.customers r WHERE company_id=${literal(f.companyId)}),
    'sites',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.customer_sites r WHERE company_id=${literal(f.companyId)}),
    'points',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.metering_points r WHERE company_id=${literal(f.companyId)}),
    'contracts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.customer_contracts r WHERE company_id=${literal(f.companyId)}),
    'supply',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.customer_supply_periods r WHERE company_id=${literal(f.companyId)}))`)
}

async function validateFreshZ01Draft(draft: CreateEdielMessageInput, context: CustomerMasterdataValidationContext) {
  return validateRulebookMessageWithRegistry({family: draft.messageFamily, code: String(draft.messageCode),
    processGroup: draft.processType, applicationReference: draft.applicationReference, rawPayload: draft.rawPayload,
    parsedPayload: draft.parsedPayload, mode: 'send', direction: 'outbound', environment: draft.environment,
    version: draft.messageVersion, companyId: draft.companyId, customerMasterdataContext: context,
    customerMasterdataRow: {direction: 'outbound', message_family: draft.messageFamily, message_code: draft.messageCode,
      company_id: draft.companyId, customer_id: draft.customerId, environment: draft.environment,
      raw_payload: draft.rawPayload, intent_id: draft.intentId, communication_route_id: draft.communicationRouteId}})
}

/** Fresh before-original producer control, then the actual finalizer with one
 * physical omission. A prior original/dedupe, source-context failure or missing
 * registry never counts as proof of the requested field's validation.
 */
export async function exerciseZ01SupplierOutboundField(f: Z01SupplierNativeFixture, field: Z01OutboundField) {
  const initial = outboundFieldEffects(f)
  if (initial.originals !== 0) phaseFailure('outbound_field_requires_fresh_fixture', initial)
  const queued = await enqueueCustomerDataRequestAutomation({companyId: f.companyId, customerId: f.customerId, siteId: f.siteId,
    meteringPointId: f.pointId, actorUserId: f.actorUserId, source: 'synthetic_z01_before_original_field_probe'})
  if (queued.redirectedToManualFacilityRequest || queued.duplicate) phaseFailure('outbound_field_operation_not_fresh', queued)
  const request = await createCustomerInfoRequest({companyId: f.companyId, actorUserId: f.actorUserId, customerId: f.customerId,
    siteId: f.siteId, meteringPointId: f.pointId, gridOwnerId: f.gridId, requestType: 'z01_customer_masterdata',
    targetPartyType: 'grid_owner', requestedDataCategories: ['facility_id', 'metering_point_id', 'grid_area', 'customer_masterdata'],
    operationId: queued.operationId, externalReference: `NATIVE-Z01-${randomUUID().replaceAll('-', '').slice(0,20)}`})
  const dataRequest = await createGridOwnerDataRequest({actorUserId: f.actorUserId, customerId: f.customerId, siteId: f.siteId,
    meteringPointId: f.pointId, gridOwnerId: f.gridId, requestScope: 'customer_masterdata', operationId: queued.operationId,
    authorizationDocumentId: f.authorizationDocumentId, externalReference: String(objectRecord(request.verified_payload).externalReference),
    requestPayload: {customer_info_request_id: request.id, authorization_document_id: f.authorizationDocumentId}})
  const outbound = await findOrCreateDataRequestOutbound({actorUserId: f.actorUserId, requestType: 'customer_masterdata',
    communicationRouteId: f.z01RouteId, dataRequest, operationId: queued.operationId, environment: 'test', failOnMissingEnvironment: true,
    payload: {customer_info_request_id: request.id, authorization_document_id: f.authorizationDocumentId}})
  const gridOwner = await getGridOwnerById(supabaseService, f.gridId)
  const routeContext = await resolveDecisionBackedOutboundContext({actorUserId: f.actorUserId, companyId: f.companyId,
    customerId: f.customerId, siteId: f.siteId, meteringPointId: f.pointId, gridOwner, requestType: 'customer_masterdata',
    messageFamily: 'PRODAT', messageCode: 'Z01', preferredRouteId: f.z01RouteId, dataRequestId: dataRequest.id,
    outboundRequestId: outbound.id, environment: 'test', payload: outbound.payload ?? {}})
  const refs = allocateZ01WireReferences({documentReference: outbound.external_reference, transactionReference: dataRequest.external_reference})
  const intent = await createEdielMessageIntent({actorUserId: f.actorUserId, companyId: f.companyId, environment: 'test', market: 'electricity',
    messageFamily: 'PRODAT', messageCode: 'Z01', businessProcess: 'customer_masterdata', direction: 'outbound',
    senderEdielId: routeContext.senderEdielId, receiverEdielId: routeContext.receiverEdielId,
    applicationReference: routeContext.applicationReference!, routeProfileId: f.z01RouteProfileId, communicationRouteId: f.z01RouteId,
    customerId: f.customerId, customerSiteId: f.siteId, customerInfoRequestId: request.id, operationId: queued.operationId,
    facilityId: f.external, meteringPointId: f.external, gridAreaCode: f.gridAreaCode,
    interchangeReference: refs.interchangeReference, messageReference: refs.messageReference, transactionReference: refs.transactionReference,
    idempotencyKey: `native-z01-field:${queued.operationId}:${field}`,
    payload: {...dataRequest.request_payload, documentReference: refs.documentReference, outbound_request_id: outbound.id}})
  if (intent.validationStatus !== 'validated') phaseFailure('outbound_field_intent_held', intent.blockingReasons)
  await setOperationSnapshotRequestReference({companyId: f.companyId, operationId: queued.operationId,
    requestKind: 'customer_data_request', requestReference: request.id, routeProfileId: f.z01RouteProfileId})
  const draft = await buildCustomerMasterdataZ01Draft({actorUserId: f.actorUserId, routeContext, dataRequest, gridOwner,
    wireReferences: z01WireReferencesFromIntent(intent), externalReference: refs.documentReference,
    transactionReference: refs.transactionReference, messageVersion: 'E2SE6A', operationId: queued.operationId})
  draft.intentId = intent.id
  draft.routeProfileId = f.z01RouteProfileId
  draft.outboundRequestId = outbound.id
  const positiveContext = bindCustomerMasterdataDraftContext({draft, companyId: f.companyId, environment: 'test', routeId: f.z01RouteId})
  if (!positiveContext || !draft.rawPayload) phaseFailure('outbound_field_producer_projection_missing', {intentId: intent.id})
  const before = outboundFieldEffects(f), positiveValidation = await validateFreshZ01Draft(draft, positiveContext)
  const rawOriginal = draft.rawPayload, rawOmitted = omitOutboundZ01Field(rawOriginal, field), tokens = tokenizeEdifact(rawOmitted)
  const engine = objectRecord(draft.parsedPayload?.prodatEngine), evidence = objectRecord(engine.registerEvidence)
  const negativeDraft: CreateEdielMessageInput = {...draft, rawPayload: rawOmitted, parsedPayload: {...draft.parsedPayload,
    prodatEngine: {...engine, registerEvidence: createProdatRegisterEvidence({code: 'Z01', rawSegments: tokens.segments.map(segment => segment.raw),
      una: tokens.una, facts: copyProdatRegisterFacts(evidence.facts)})}}}
  const negativeContext = bindCustomerMasterdataValidationContext({...positiveContext, rawPayload: rawOmitted})
  const negativeValidation = await validateFreshZ01Draft(negativeDraft, negativeContext)
  const diagnostics = negativeValidation.issues.map(issue => ({...issue,
    fieldNumber: issue.prodatDiagnostic?.kind === 'field' ? issue.prodatDiagnostic.fieldNumber : null}))
  let finalizerError: string | null = null, originalId: string | null = null
  if (positiveValidation.ok && field !== 'INSTALLATION_GROUP') {
    try {
      const original = await finalizeOutboundDraft({actorUserId: f.actorUserId, requestType: 'customer_masterdata', routeContext,
        draft: negativeDraft, outboundRequestId: outbound.id, customerMasterdataContext: negativeContext,
        duplicateCheck: {sourceType: 'grid_owner_data_request', sourceId: dataRequest.id, receiverEdielId: routeContext.receiverEdielId,
          messageFamily: 'PRODAT', messageCode: 'Z01', messageVersion: negativeDraft.messageVersion}})
      originalId = original.id
    } catch (error) {finalizerError = error instanceof Error ? error.message : String(error)}
  }
  const after = outboundFieldEffects(f), noOriginal = before.originals === 0 && after.originals === 0
  const noBusinessEffects = JSON.stringify(before) === JSON.stringify(after)
  const target = diagnostics.find(issue => issue.blocking && issue.fieldNumber === field)
  const finalizerTarget = Boolean(target && finalizerError?.includes(`${target.code} - ${target.description}`))
  const sourceBoundFields: Z01OutboundField[] = ['227', '228', '229', '231', '232', '316']
  const sourceIssue = diagnostics.find(issue => issue.blocking && issue.code === 'PRODAT_CUSTOMER_MASTERDATA_SOURCE_UNQUALIFIED')
  const sameBoundSource = negativeContext.projection === positiveContext.projection
    && negativeContext.intentId === positiveContext.intentId && negativeContext.routeId === positiveContext.routeId
  const sourceBoundRefusal = sourceBoundFields.includes(field) && sameBoundSource && !negativeValidation.ok
    && Boolean(sourceIssue && finalizerError?.includes(`${sourceIssue.code} - ${sourceIssue.description}`))
  const causalRefusal = classifyZ01CausalFieldRefusal({field, rawOriginal, rawOmitted, positiveValidation, negativeValidation,
    diagnostics, finalizerError, sameBoundSource, noOriginal, noBusinessEffects})
  const phase = !positiveValidation.ok ? 'positive_control_held' : field === 'INSTALLATION_GROUP' && negativeValidation.ok
    ? 'optional_parent_accepted' : originalId ? 'unexpected_original' : finalizerTarget && noOriginal && noBusinessEffects
      ? 'target_field_rejected' : sourceBoundRefusal && noOriginal && noBusinessEffects ? 'source_bound_field_refused'
        : causalRefusal?.phase ?? 'precedence_hold'
  return {field, phase, causalRefusal, positiveValidation, negativeValidation, diagnostics, finalizerError, originalId,
    before, after, noOriginal, noBusinessEffects, sameBoundSource, rawOriginal, rawOmitted, operationId: queued.operationId,
    jobId: queued.id, requestId: request.id, dataRequestId: dataRequest.id, outboundId: outbound.id, intentId: intent.id}
}
