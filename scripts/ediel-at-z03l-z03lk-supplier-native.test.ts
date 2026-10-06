// Proposed whole Z03L/LK native proof; NOT_RUN at authoring. No whole-ID tags.
// Existing #595 finite assertions are retained unchanged. Public synthetic
// agreement/mail inputs and one external SMTP double; all owners and consumers
// are production code. Future activation and market certification are separate.
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
const smtp = vi.hoisted(() => vi.fn())
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: smtp }) } }))
import { seedNormalSwitchNativeFixture, nativeSql as sql, literal, type NormalSwitchStageNativeFixture } from './helpers/ediel-normal-switch-native-fixture'
import { seedOriginalMailboxNative } from './helpers/originalMailboxNative'
import { ownerSource, OWNER } from '../__tests__/helpers/sourceOwnerFixtures'
import { supabaseService } from '@/lib/supabase/service'
import { prepareAndQueueEdielZ03 } from '@/lib/ediel/flows/prodatSwitch'
import { ensureInitialSwitchEdielAutomation } from '@/lib/operations/edielAutomation'
import { evaluateSupplierSwitchSchedule } from '@/lib/operations/supplierSwitchScheduler'
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport'
import { getEdielMessageById } from '@/lib/ediel/db'
import { createInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { processInboundAckMessage } from '@/lib/ediel/flows/inboundAckProcessing'
import { readCommittedInboundAck } from '@/lib/ediel/ack/committedInboundAck'
import { recordReceivedSourceValidation } from '@/lib/ediel/core/receivedSourceValidationLedger'
import { buildContrlDraft, buildAperakDraft } from '@/lib/ediel/ack'
import { createCanonicalOutboundMessage } from '@/lib/ediel/core/kernel'
import { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { validateRulebookMessageWithRegistry } from '@/lib/ediel/rulebook/validator'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { PRODAT_26A_FIELD_MATRIX } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { prepareCustomerMasterdataSource, bindCustomerMasterdataValidationContext, loadCustomerMasterdataValidationContext } from '@/lib/ediel/production/customerMasterdataSource'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import type { ProdatInvoiceeObject } from '@/lib/ediel/prodat/prodatInvoicee'
import type { CreateEdielMessageInput, EdielMessageRow } from '@/lib/ediel/types'

type Variant = 'L' | 'LK'
type Fixture = NormalSwitchStageNativeFixture & { variant: Variant; original: EdielMessageRow; li: string }
const required = ['311','312','202','203','313','205','206','207','208','314','209','210','217','223','260','261','226','227','228','231','232','316','262'] as const
const conditional = ['229','233','234','250','251','252','253','317','318','INVOICEE_GROUP'] as const
afterEach(() => { vi.unstubAllEnvs(); smtp.mockReset() })
function configureSmtp() {
  for (const [key,value] of Object.entries({ EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',
    EDIEL_APP_DKIM_ENABLED:'false', EMAIL_PROVIDER:'resend', EDIEL_SMTP_FROM:'synthetic@example.invalid',
    EDIEL_SMTP_USER:'synthetic@example.invalid', EDIEL_SMTP_PASS:'synthetic-only', EDIEL_EMAIL_PROVIDER:'strato' })) vi.stubEnv(key,value)
  smtp.mockImplementation(async()=>({ accepted:['recipient@example.invalid'], rejected:[], messageId:randomUUID(), response:'250 synthetic accepted' }))
}
// Independent calendar oracle: real Stockholm today, calendar arithmetic only.
function today() { return new Intl.DateTimeFormat('sv-SE',{ timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date()) }
function days(date: string, offset: number) { const value=new Date(date+'T12:00:00Z'); value.setUTCDate(value.getUTCDate()+offset); return value.toISOString().slice(0,10) }
function months(date: string, offset: number) {
  const value=new Date(date+'T12:00:00Z'),day=value.getUTCDate(); value.setUTCDate(1); value.setUTCMonth(value.getUTCMonth()+offset)
  const last=new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth()+1,0)).getUTCDate(); value.setUTCDate(Math.min(day,last)); return value.toISOString().slice(0,10)
}
async function stage(variant: Variant, date=days(today(),14), invoicee=false) {
  configureSmtp()
  const f=await seedNormalSwitchNativeFixture({ deferOriginal:true,requestedStartDate:date })
  if (variant==='LK') sql(`UPDATE public.supplier_switch_requests SET request_type='move_in',prodat_variant='LK',prodat_reason='Z23' WHERE id=${literal(f.switchId)} AND company_id=${literal(f.companyId)};`)
  if (invoicee) {
    // Typed caller selection is prospective protocol input, not an accepted
    // decision. Preserve the producer's UD source and qualify a distinct IV.
    const snapshot=sql<{ portalData: { dependentConditionFacts: { invoiceeObjects: ProdatInvoiceeObject[] }; [key:string]:unknown } }>(`SELECT to_jsonb(validation_snapshot) FROM public.supplier_switch_requests WHERE id=${literal(f.switchId)};`)
    const selected=snapshot.portalData.dependentConditionFacts.invoiceeObjects[0]
    selected.invoicee={ ...selected.invoicee,nameLines:['Synthetic Invoicee'],address:{ ...selected.invoicee.address,
      lines:['Invoicegatan 2','',''],postalCode:'54321',city:'Annanstad',country:'SE' } }
    snapshot.portalData.invoicee={ id:selected.invoicee.identity.id,idCodeListQualifier:selected.invoicee.identity.qualifier,
      idAgency:selected.invoicee.identity.agency,name:'Synthetic Invoicee',nameLines:['Synthetic Invoicee'],
      address:'Invoicegatan 2',addressLines:['Invoicegatan 2'],postalCode:'54321',city:'Annanstad',country:'SE' }
    sql(`UPDATE public.supplier_switch_requests SET validation_snapshot=${literal(snapshot)}::jsonb WHERE id=${literal(f.switchId)} AND company_id=${literal(f.companyId)};`)
  }
  return { ...f,variant }
}
async function originate(f: NormalSwitchStageNativeFixture & { variant:Variant }): Promise<Fixture> {
  const prepared=await prepareAndQueueEdielZ03({ actorUserId:f.actorUserId,switchRequestId:f.switchId,communicationRouteId:f.routeId,environment:'test' })
  const original=(await getEdielMessageById(prepared.id))!
  expect(original).toBeTruthy()
  const wire=tokenizeEdifact(original.raw_payload!),reference=wire.segments.find(s=>s.tag==='RFF'&&segmentComposite(s,1,wire.una)[0]==='LI')
  expect(reference).toBeTruthy(); const li=segmentComposite(reference!,1,wire.una)[1]; expect(li).toBeTruthy()
  return { ...f,original,li }
}
async function seed(variant: Variant, invoicee=false) { return originate(await stage(variant,days(today(),14),invoicee)) }
function business(f: NormalSwitchStageNativeFixture) {
  return sql(`SELECT jsonb_build_object(
    'switches',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.supplier_switch_requests s WHERE company_id=${literal(f.companyId)}),
    'periods',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.customer_supply_periods s WHERE company_id=${literal(f.companyId)}),
    'contracts',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.customer_contracts s WHERE company_id=${literal(f.companyId)}),
    'sites',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.customer_sites s WHERE company_id=${literal(f.companyId)}),
    'points',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.metering_points s WHERE company_id=${literal(f.companyId)}),
    'permissions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.metering_permissions s WHERE company_id=${literal(f.companyId)}),
    'permissionSites',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.metering_permission_sites s WHERE company_id=${literal(f.companyId)}),
    'actorPermissions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.user_id,s.permission_id),'[]') FROM public.user_permissions s WHERE company_id=${literal(f.companyId)}),
    'confirmations',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.source_message_id),'[]') FROM gridex_received_sources.normal_switch_confirmations s WHERE company_id=${literal(f.companyId)}),
    'transitions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.source_message_id),'[]') FROM gridex_received_sources.supply_source_transitions s WHERE company_id=${literal(f.companyId)}));`)
}
function effects(f: NormalSwitchStageNativeFixture) {
  return { business:business(f), durable:sql(`SELECT jsonb_build_object(
    'messages',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.ediel_messages s WHERE company_id=${literal(f.companyId)}),
    'intents',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.ediel_message_intents s WHERE company_id=${literal(f.companyId)}),
    'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.ediel_outbox s WHERE company_id=${literal(f.companyId)}),
    'requests',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.outbound_requests s WHERE company_id=${literal(f.companyId)}),
    'providerAttempts',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM gridex_ediel_transport.attempts s WHERE company_id=${literal(f.companyId)}),
    'originals',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.message_id),'[]') FROM gridex_received_sources.switch_originals s WHERE company_id=${literal(f.companyId)}),
    'events',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.supplier_switch_events s WHERE switch_request_id=${literal(f.switchId)}),
    'cases',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.customer_cases s WHERE company_id=${literal(f.companyId)}));`),providerCalls:smtp.mock.calls.length }
}
function noActivation(f: NormalSwitchStageNativeFixture) {
  expect(sql(`SELECT jsonb_build_object('periods',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)}),
    'accepted',(SELECT status IN('accepted','confirmed','active','completed') OR inbound_z04_message_id IS NOT NULL OR completed_at IS NOT NULL FROM public.supplier_switch_requests WHERE id=${literal(f.switchId)}))`)).toEqual({ periods:0,accepted:false })
}
function encode(f: Fixture, body: string[], inbound=false) {
  const envelope=EdifactEnvelopeCodec.decode(f.original.raw_payload!)
  return EdifactEnvelopeCodec.encode({ sender:inbound?f.receiver:f.sender,receiver:inbound?f.sender:f.receiver,
    senderQualifier:'14',receiverQualifier:'14',senderSubAddress:inbound?envelope.receiverSubAddress:envelope.senderSubAddress,
    receiverSubAddress:inbound?envelope.senderSubAddress:envelope.receiverSubAddress,applicationReference:'23-DDQ-PRODAT',
    acknowledgementRequest:true,environment:'test',interchangeReference:randomUUID().replaceAll('-','').slice(0,14),
    messages:[{ messageReference:randomUUID().replaceAll('-','').slice(0,14),messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:body }] })
}
function confirmation(f: Fixture, change: (body:string[])=>string[]=body=>body) {
  const selected=ownerSource().raw_payload!.replaceAll(OWNER.external,f.external)
    .replaceAll('12345:160:SVK',`${f.receiver}:160:SVK`).replaceAll('54321:160:SVK',`${f.sender}:160:SVK`)
    .replaceAll('11111:160:SVK',`${f.brpEdielId}:160:SVK`).replaceAll('CUSTOMER-1::89',`${f.customerIdentity.id}:SE2:260`)
    .replaceAll('RFF+Z05:NET-1',`RFF+Z05:${f.gridAreaCode}`).replaceAll('RFF+LI:CASE-1',`RFF+LI:${f.li}`)
    .replaceAll('202610010000',f.requestedStartDate.replaceAll('-','')+'0000').replaceAll('CAV+Z22',`CAV+${f.variant==='L'?'Z22':'Z23'}`)
  const body=tokenizeEdifact(selected).segments.filter(s=>!['UNA','UNB','UNH','UNT','UNZ'].includes(s.tag))
    .map(s=>s.tag==='BGM'?`BGM+Z04+${randomUUID().replaceAll('-','').slice(0,20)}+9+AB`:s.raw)
  return encode(f,change(body),true)
}
async function receive(f: Fixture, raw: string) {
  const mail=await seedOriginalMailboxNative(sql,literal,{ companyId:f.companyId,environment:'test',raw,smtpFrom:'synthetic@example.invalid' })
  const id=await createInboundEdielMessage({ companyId:f.companyId,actorUserId:f.actorUserId,environment:'test',
    inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed })
  expect(id).toBeTruthy(); return (await getEdielMessageById(id!))!
}
async function send(f: Fixture) {
  await sendEdielMessageViaSmtp(f.original,{ actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment' })
  f.original=(await getEdielMessageById(f.original.id))!; expect(f.original.status).toBe('sent')
  expect(sql(`SELECT to_jsonb(gridex_received_sources.sent_source_is_current_v1(m)) FROM public.ediel_messages m WHERE id=${literal(f.original.id)}`)).toBe(true)
}
async function physicalAck(f: Fixture, family:'CONTRL'|'APERAK') {
  const input={ actorUserId:f.actorUserId,sourceMessage:{ ...f.original,direction:'inbound' as const },outcome:'positive' as const }
  const ack=await receive(f,(family==='CONTRL'?buildContrlDraft(input):buildAperakDraft(input)).rawPayload!)
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(ack)
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
  expect(await recordReceivedSourceValidation({ original:ack,validated:ack,resolvedCompanyId:f.companyId,decision })).toMatchObject({ status:'recorded' })
  expect(await processInboundAckMessage({ actorUserId:f.actorUserId,message:ack })).toMatchObject({ outcome:'positive',sourceMessage:{ id:f.original.id } })
  expect(await readCommittedInboundAck({ actorUserId:f.actorUserId,message:(await getEdielMessageById(ack.id))! })).toMatchObject({ kind:'exact_receipt',sourceMessageId:f.original.id })
  const before=effects(f)
  expect(await processInboundAckMessage({ actorUserId:f.actorUserId,message:ack })).toMatchObject({ outcome:'positive',sourceMessage:{ id:f.original.id } })
  expect(effects(f)).toEqual(before)
}
function draft(f: Fixture, raw=f.original.raw_payload!): CreateEdielMessageInput {
  const m=f.original
  return { actorUserId:f.actorUserId,companyId:f.companyId,direction:'outbound',messageStandard:'edifact',messageFamily:'PRODAT',messageCode:'Z03',
    environment:'test',testFlag:1,status:'draft',transportType:'smtp',mailbox:m.mailbox,receiverEmail:m.receiver_email,
    messageVersion:m.message_version,processType:m.process_type,senderEdielId:f.sender,receiverEdielId:f.receiver,
    senderSubAddress:m.sender_sub_address,receiverSubAddress:m.receiver_sub_address,applicationReference:m.application_reference,
    communicationRouteId:m.communication_route_id,routeProfileId:m.route_profile_id,intentId:m.intent_id,
    outboundRequestId:m.outbound_request_id,sourceOperationId:f.switchId,switchRequestId:f.switchId,customerId:f.customerId,
    siteId:f.siteId,meteringPointId:f.pointId,gridOwnerId:f.gridId,rawPayload:raw,parsedPayload:m.parsed_payload??{} }
}
async function sourceContext(f: Fixture, raw: string) {
  const projection=await prepareCustomerMasterdataSource({ companyId:f.companyId,customerId:f.customerId,
    actorUserId:f.actorUserId,environment:'test',asOf:f.requestedStartDate+'T00:00:00+01:00' })
  return bindCustomerMasterdataValidationContext({ kind:'customer_masterdata',companyId:f.companyId,customerId:f.customerId,
    environment:'test',rawPayload:raw,intentId:f.original.intent_id!,routeId:f.routeId,projection })
}
function masterdataRow(f:Fixture,raw:string) {
  return {company_id:f.companyId,customer_id:f.customerId,environment:'test' as const,direction:'outbound' as const,
    message_family:'PRODAT',message_code:'Z03',raw_payload:raw,intent_id:f.original.intent_id,communication_route_id:f.routeId}
}
async function registryProfile(f:Fixture) {
  // Retained producer evidence is read through its public protected owner. A
  // runtime parse projection intentionally does not carry caller invoicee facts.
  const context=await loadCustomerMasterdataValidationContext(f.original,f.actorUserId)
  expect(context).toBeTruthy()
  const result=await validateRulebookMessageWithRegistry({family:'PRODAT',code:'Z03',rawPayload:f.original.raw_payload,
    mode:'send',direction:'outbound',environment:'test',companyId:f.companyId,applicationReference:'23-DDQ-PRODAT',
    parsedPayload:f.original.parsed_payload,customerMasterdataContext:context,customerMasterdataRow:masterdataRow(f,f.original.raw_payload!),
    validationPurpose:'outbound_original',version:f.original.message_version,processGroup:f.original.process_type})
  expect(result.blocking,JSON.stringify(result.issues)).toBe(false)
  expect(result.fieldRuleSource).toBe('registry'); expect(result.rulePackSnapshot).toBeTruthy(); expect(result.canonicalPolicy).toBeTruthy()
  return result.canonicalPolicy!
}

// Pure wire mutation preserves untouched raw elements and release sequences.
// Count changes are owned by the existing envelope codec, never hand-edited UNT.
function splitWire(value:string, separator:string, release:string) {
  const parts:string[]=[]; let part='',released=false
  for (const character of value) {
    if (released) { part+=character; released=false; continue }
    if (character===release) { part+=character; released=true; continue }
    if (character===separator) { parts.push(part); part=''; continue }
    part+=character
  }
  parts.push(part); return parts
}
function omitField(f:Fixture, field:string) {
  const descriptor=PRODAT_26A_FIELD_MATRIX.find(row=>row.fieldNumber===field)!
  expect(descriptor,field).toBeTruthy()
  const tokens=tokenizeEdifact(f.original.raw_payload!),una=tokens.una
  let removed=0,discardNextCav=false
  const body=tokens.segments.filter(s=>!['UNA','UNB','UNH','UNT','UNZ'].includes(s.tag)).flatMap(token=>{
    if (discardNextCav && token.tag==='CAV') { discardNextCav=false; return [] }
    const elements=splitWire(token.raw,una.dataElementSeparator,una.releaseCharacter)
    const role=segmentComposite(token,1,una)[0]
    if (descriptor.partyQualifier && token.tag==='NAD' && role===descriptor.partyQualifier) {
      removed++
      if (field.endsWith('_GROUP')) return []
      if (descriptor.partyElement===2) {
        const components=splitWire(elements[2]??'',una.componentDataElementSeparator,una.releaseCharacter)
        components[0]=''; elements[2]=components.join(una.componentDataElementSeparator)
      } else elements[descriptor.partyElement!]=''
      return [elements.join(una.dataElementSeparator)]
    }
    if (field.endsWith('_GROUP') && token.tag==='NAD' && role===(field==='END_USER_GROUP'?'UD':'IV')) { removed++; return [] }
    if (descriptor.documentElement && token.tag==='BGM') { removed++; elements[descriptor.documentElement]=''; return [elements.join(una.dataElementSeparator)] }
    if (descriptor.linElement && token.tag==='LIN') {
      removed++; const components=splitWire(elements[descriptor.linElement]??'',una.componentDataElementSeparator,una.releaseCharacter)
      components[descriptor.linComponent??0]=''; elements[descriptor.linElement]=components.join(una.componentDataElementSeparator)
      return [elements.join(una.dataElementSeparator)]
    }
    if (descriptor.dateQualifier && token.tag==='DTM' && role===descriptor.dateQualifier) { removed++; return [] }
    if (descriptor.referenceScope && token.tag==='RFF' && token.raw.startsWith(descriptor.segmentPath+':')) { removed++; return [] }
    if (descriptor.cavComponent!==undefined && token.tag==='CCI' && segmentComposite(token,2,una)[0]===descriptor.segmentPath.split('++')[1].split('/')[0]) {
      removed++; discardNextCav=true; return []
    }
    return [token.raw]
  })
  let raw=encode(f,body)
  if (field==='311' || field==='312') {
    const tag=field==='311'?'UNB':'UNH'
    const token=tokenizeEdifact(raw).segments.find(s=>s.tag===tag)!
    const elements=splitWire(token.raw,una.dataElementSeparator,una.releaseCharacter)
    if (field==='311') elements[7]=''
    else { const components=splitWire(elements[2],una.componentDataElementSeparator,una.releaseCharacter); components[4]=''; elements[2]=components.join(una.componentDataElementSeparator) }
    raw=raw.replace(token.raw,elements.join(una.dataElementSeparator)); removed++
  }
  expect(removed,field+' exactly one own field selection').toBe(1)
  return raw
}
function replies(f:Fixture, sourceId:string) {
  return sql<EdielMessageRow[]>(`SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]') FROM public.ediel_messages m
    WHERE company_id=${literal(f.companyId)} AND environment='test' AND direction='outbound' AND related_message_id=${literal(sourceId)};`)
}
function noPositiveAperak(f:Fixture, sourceId:string) {
  expect(replies(f,sourceId).filter(m=>m.message_family==='APERAK' && tokenizeEdifact(m.raw_payload).segments
    .some(s=>s.tag==='ERC'&&segmentComposite(s,1)[0]==='100'))).toHaveLength(0)
}
function originalHistory(f:Fixture) {
  return sql(`SELECT jsonb_build_object('original',(SELECT to_jsonb(o) FROM gridex_received_sources.switch_originals o WHERE message_id=${literal(f.original.id)}),
    'raw',(SELECT raw_payload FROM public.ediel_messages WHERE id=${literal(f.original.id)}),
    'hash',(SELECT immutable_payload_hash FROM public.ediel_messages WHERE id=${literal(f.original.id)}),
    'permissions',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.metering_permissions p WHERE company_id=${literal(f.companyId)}),
    'permissionSites',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.metering_permission_sites p WHERE company_id=${literal(f.companyId)}));`)
}
async function assertMissingField(f:Fixture,field:string,policy:NonNullable<Awaited<ReturnType<typeof resolveCanonicalRuntimeDecisionWithRegistry>>['policy']>) {
  const raw=omitField(f,field),wire=tokenizeEdifact(raw),descriptor=PRODAT_26A_FIELD_MATRIX.find(row=>row.fieldNumber===field)!
  const unh=wire.segments.findIndex(s=>s.tag==='UNH'),unt=wire.segments.findIndex(s=>s.tag==='UNT')
  expect(segmentComposite(wire.segments[unt],1,wire.una)[0],field+' unchanged envelope framing').toBe(String(unt-unh+1))
  expect(segmentComposite(wire.segments.find(s=>s.tag==='UNZ'),1,wire.una)[0]).toBe('1')
  if (field==='311') {
    const originalContext=await loadCustomerMasterdataValidationContext(f.original,f.actorUserId)
    expect(originalContext).toBeTruthy()
    const positive=preflightEdielPayload({rawPayload:f.original.raw_payload,mimeType:f.original.mime_type,messageStandard:'edifact',mode:'send',
      companyId:f.companyId,parsedPayload:f.original.parsed_payload,dateEventRow:f.original,customerMasterdataRow:f.original,
      customerMasterdataContext:originalContext,validationPurpose:'outbound_original'})
    expect(positive.blocking,JSON.stringify(positive.issues)).toBe(false)
    expect(segmentComposite(wire.segments.find(s=>s.tag==='UNB'),7,wire.una)[0]).toBe('')
  } else {
    // Use the actual current selected registry policy, retaining the genuine
    // producer's typed condition facts. No constructed field-rule/policy override.
    const issues=validateCanonicalPolicyFields({ policy,rawPayload:raw,rawSegments:wire.segments.map(s=>s.raw),una:wire.una })
    const diagnostic=issues.find(issue=>issue.severity==='error' && (field.endsWith('_GROUP')
      ? issue.fieldPath===descriptor.segmentPath : issue.prodatDiagnostic?.kind==='field' && issue.prodatDiagnostic.fieldNumber===field))
    expect(diagnostic,field+': '+JSON.stringify(issues)).toBeTruthy()
    if (!field.endsWith('_GROUP')) {
      expect(diagnostic!.prodatDiagnostic).toMatchObject({kind:'field',fieldNumber:field,
        errorKind:['207','208','209','227','233','250','262'].includes(field)?'invalid':'missing'})
    }
  }
  const input=draft(f,raw),context=await sourceContext(f,raw),before=effects(f)
  if (field==='311') {
    // The physical preflight owns this diagnostic. The matrix consumes policy
    // metadata; the public kernel separately refuses the physical UNB in its
    // pre-INSERT native legal-context owner. Keep original metadata unchanged.
    const preflight=preflightEdielPayload({rawPayload:raw,mimeType:f.original.mime_type,messageStandard:'edifact',mode:'send',
      companyId:f.companyId,parsedPayload:input.parsedPayload,dateEventRow:f.original,
      customerMasterdataContext:context,customerMasterdataRow:masterdataRow(f,raw),validationPurpose:'outbound_original'})
    expect(preflight.blocking,JSON.stringify(preflight.issues)).toBe(true)
    expect(preflight.issues).toEqual(expect.arrayContaining([expect.objectContaining({
      code:'PROFILE_APPLICATION_REFERENCE_MISSING',severity:'error',segment:wire.segments.find(s=>s.tag==='UNB')!.raw,
    })]))
    expect(input.applicationReference).toBe(f.original.application_reference)
    await expect(createCanonicalOutboundMessage({actorUserId:f.actorUserId,requestType:'supplier_switch',baseInput:input,customerMasterdataContext:context}))
      .rejects.toMatchObject({message:'ediel_outbound_owner_witness_required',cause:{code:'P0001',message:'ediel_inbound_legal_context_required'}})
    expect(effects(f),field+' no durable/provider effects').toEqual(before)
    return
  }
  // UD omissions can be refused by the authentic source comparison before
  // registry field selection. The numeric oracle above and this native public
  // persistence boundary intentionally assert different owners.
  const validation=await validateRulebookMessageWithRegistry({ family:'PRODAT',code:'Z03',applicationReference:'23-DDQ-PRODAT',
      rawPayload:raw,mode:'send',roleCode:'DDQ',direction:'outbound',environment:'test',companyId:f.companyId,
      parsedPayload:input.parsedPayload,customerMasterdataContext:context,customerMasterdataRow:masterdataRow(f,raw),validationPurpose:'outbound_original',
      version:input.messageVersion,processGroup:input.processType })
  expect(validation.blocking,field+': '+JSON.stringify(validation.issues)).toBe(true)
  const first=validation.issues.find(issue=>issue.severity==='error')!
  expect(first,field).toBeTruthy()
  await expect(createCanonicalOutboundMessage({actorUserId:f.actorUserId,requestType:'supplier_switch',baseInput:input,customerMasterdataContext:context}))
    .rejects.toThrow(`Outbound PRODAT Z03 blockerades av canonical Ediel-policy: ${first.code} - ${first.description}`)
  expect(effects(f),field+' no durable/provider effects').toEqual(before)
}

describe.each(['L','LK'] as const)('ordinary supplier Z03%s native proposals',variant=>{
  it('queues the signed own original and keeps physical ACKs distinct from the causal business confirmation',async()=>{
    const staged=await stage(variant)
    // Establish the caller facts before production; rendered absence is not
    // evidence that the invoicee condition is inactive or annual basis absent.
    const snapshot=sql<{ portalData: { dependentConditionFacts: { invoiceeObjects: ProdatInvoiceeObject[] }; [key:string]:unknown }; [key:string]:unknown }>(`SELECT to_jsonb(validation_snapshot) FROM public.supplier_switch_requests WHERE id=${literal(staged.switchId)} AND company_id=${literal(staged.companyId)};`)
    const selected=snapshot.portalData.dependentConditionFacts.invoiceeObjects
    expect(selected).toHaveLength(1)
    expect(selected[0]).toMatchObject({meteringPointId:staged.external,invoicee:{availability:'available'},event:{state:'none'},source:{kind:'caller_selection',companyId:staged.companyId}})
    expect(selected[0].endUser.identity).toEqual(staged.customerIdentity)
    expect(selected[0].invoicee.identity).toEqual(selected[0].endUser.identity)
    expect(selected[0].invoicee.address).toEqual(selected[0].endUser.address)
    for (const input of [snapshot,snapshot.portalData]) {
      expect(input.registers).toBeUndefined()
      expect(input.annualConsumption).toBeUndefined()
      expect(input.annualEnergyKwh).toBeUndefined()
    }
    expect(sql(`SELECT jsonb_build_object('point',(SELECT to_jsonb(p.estimated_annual_consumption_kwh) FROM public.metering_points p WHERE id=${literal(staged.pointId)} AND company_id=${literal(staged.companyId)}),'site',(SELECT to_jsonb(s.annual_consumption_kwh) FROM public.customer_sites s WHERE id=${literal(staged.siteId)} AND company_id=${literal(staged.companyId)}));`)).toEqual({point:null,site:null})
    const started=Date.now(),f=await originate(staged),finished=Date.now()
    const original=f.original,wire=tokenizeEdifact(original.raw_payload!),history=originalHistory(f)
    expect(wire.segments.filter(s=>s.tag==='NAD'&&segmentComposite(s,1,wire.una)[0]==='IV')).toEqual([])
    expect(wire.segments.filter(s=>s.tag==='QTY'&&segmentComposite(s,1,wire.una)[0]==='31')).toEqual([])
    expect(EdifactEnvelopeCodec.decode(original.raw_payload!)).toMatchObject({ sender:f.sender,receiver:f.receiver,applicationReference:'23-DDQ-PRODAT',environment:'test',acknowledgementRequest:'1' })
    expect(wire.segments.find(s=>s.tag==='BGM')?.elements.slice(1,5)).toEqual(['Z03',original.external_reference,'9','AB'])
    const reason=wire.segments.findIndex(s=>s.tag==='CCI'&&segmentComposite(s,2,wire.una)[0]==='Z13')
    expect(segmentComposite(wire.segments[reason+1],1,wire.una)[0]).toBe(variant==='L'?'Z22':'Z23')
    expect(wire.segments.some(s=>s.tag==='DTM'&&segmentComposite(s,1,wire.una).join(':')===`92:${f.requestedStartDate.replaceAll('-','')}0000:203`)).toBe(true)
    expect(original).toMatchObject({ direction:'outbound',message_code:'Z03',requires_contrl:true,requires_aperak:true,contrl_status:'pending',aperak_status:'pending' })
    expect(Date.parse(original.ack_due_at!)).toBeGreaterThanOrEqual(started+30*60*1000)
    expect(Date.parse(original.ack_due_at!)).toBeLessThanOrEqual(finished+30*60*1000)
    expect(sql(`SELECT jsonb_build_object('binding',(SELECT count(*) FROM gridex_received_sources.switch_originals WHERE message_id=${literal(original.id)} AND company_id=${literal(f.companyId)} AND switch_id=${literal(f.switchId)} AND contract_id=${literal(f.contractId)}),
      'intent',(SELECT count(*) FROM public.ediel_message_intents WHERE id=${literal(original.intent_id)} AND company_id=${literal(f.companyId)}),
      'outbox',(SELECT count(*) FROM public.ediel_outbox WHERE ediel_message_id=${literal(original.id)} AND company_id=${literal(f.companyId)}),
      'switch',(SELECT count(*) FROM public.supplier_switch_requests WHERE id=${literal(f.switchId)} AND company_id=${literal(f.companyId)} AND customer_id=${literal(f.customerId)} AND customer_contract_id=${literal(f.contractId)} AND outbound_z03_message_id=${literal(original.id)} AND rff_li_reference=${literal(f.li)}))`)).toEqual({ binding:1,intent:1,outbox:1,switch:1 })
    noActivation(f)
    const queued=effects(f),replay=await prepareAndQueueEdielZ03({actorUserId:f.actorUserId,switchRequestId:f.switchId,communicationRouteId:f.routeId,environment:'test'})
    expect(replay.id).toBe(original.id); expect(effects(f)).toEqual(queued)
    await send(f); noActivation(f)
    await physicalAck(f,'CONTRL'); noActivation(f)
    await physicalAck(f,'APERAK'); noActivation(f)
    expect(await getEdielMessageById(original.id)).toMatchObject({contrl_status:'positive',aperak_status:'positive'})
    const source=await receive(f,confirmation(f)),decision=await resolveCanonicalRuntimeDecisionWithRegistry(source)
    expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:source.id})
    expect(sql(`SELECT jsonb_build_object('switch',(SELECT jsonb_build_object('status',status,'original',outbound_z03_message_id,'source',inbound_z04_message_id,'li',rff_li_reference) FROM public.supplier_switch_requests WHERE id=${literal(f.switchId)}),
      'periods',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)} AND customer_id=${literal(f.customerId)} AND metering_point_id=${literal(f.pointId)} AND source_message_id=${literal(source.id)} AND status='confirmed_by_grid_owner'),
      'active',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)} AND status='active'),
      'proof',(SELECT count(*) FROM gridex_received_sources.normal_switch_confirmations WHERE company_id=${literal(f.companyId)} AND switch_id=${literal(f.switchId)} AND original_message_id=${literal(original.id)} AND source_message_id=${literal(source.id)}))`))
      .toEqual({switch:{status:'accepted',original:original.id,source:source.id,li:f.li},periods:1,active:0,proof:1})
    expect(originalHistory(f)).toEqual(history)
    const returned=replies(f,source.id)
    expect(returned.map(m=>m.message_family).sort()).toEqual(['APERAK','CONTRL'])
    expect(returned.find(m=>m.message_family==='APERAK')!.raw_payload).toContain('ERC+100')
    for (const reply of returned) {
      await sendEdielMessageViaSmtp(reply,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})
      expect(await getEdielMessageById(reply.id)).toMatchObject({status:'sent',related_message_id:source.id})
      expect(sql(`SELECT to_jsonb(gridex_received_sources.sent_source_is_current_v1(m)) FROM public.ediel_messages m WHERE id=${literal(reply.id)}`)).toBe(true)
    }
    const confirmed=business(f),replyIds=replies(f,source.id).map(m=>m.id),providerCalls=smtp.mock.calls.length
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:source.id})
    expect(business(f)).toEqual(confirmed); expect(replies(f,source.id).map(m=>m.id)).toEqual(replyIds)
    expect(smtp.mock.calls.length).toBe(providerCalls); expect(originalHistory(f)).toEqual(history)
  })

  it('refuses each of the 23 required fields and the UD parent before public persistence',async()=>{
    const f=await seed(variant),policy=await registryProfile(f)
    expect(policy.fieldRules.filter(rule=>'requirement' in rule && rule.requirement==='required').map(rule=>'fieldNumber' in rule?rule.fieldNumber:null)).toEqual(expect.arrayContaining([...required]))
    for (const field of [...required,'END_USER_GROUP']) await assertMissingField(f,field,policy)
  })

  it('qualifies active IV and selected IT/address facts through the ordinary producer, then refuses each applicable D omission',async()=>{
    const f=await seed(variant,true),wire=tokenizeEdifact(f.original.raw_payload!),policy=await registryProfile(f)
    expect(wire.segments.filter(s=>s.tag==='NAD'&&segmentComposite(s,1,wire.una)[0]==='IV')).toHaveLength(1)
    expect(wire.segments.filter(s=>s.tag==='NAD'&&segmentComposite(s,1,wire.una)[0]==='IT')).toHaveLength(1)
    expect(validateCanonicalPolicyFields({policy,rawPayload:f.original.raw_payload!,rawSegments:wire.segments.map(s=>s.raw),una:wire.una}).filter(issue=>issue.severity==='error')).toEqual([])
    for (const field of conditional) await assertMissingField(f,field,policy)
    noActivation(f)
  })

  for (const contrast of ['line reference','object','grid area','start date','opposite subtype'] as const) {
    it(`refuses a counted received Z04 with wrong ${contrast}`,async()=>{
      const f=await seed(variant); await send(f)
      const other=contrast==='object'?await seed(variant):null
      const raw=confirmation(f,body=>body.map(segment=>{
        if (contrast==='line reference'&&segment.startsWith('RFF+LI:')) return 'RFF+LI:'+randomUUID()
        if (contrast==='object') return segment.replaceAll(f.external,other!.external)
        if (contrast==='grid area'&&segment.startsWith('RFF+Z05:')) return 'RFF+Z05:OTHER'
        if (contrast==='start date'&&segment.startsWith('DTM+92:')) return `DTM+92:${days(f.requestedStartDate,1).replaceAll('-','')}0000:203`
        if (contrast==='opposite subtype'&&segment.startsWith('CAV+'+(variant==='L'?'Z22':'Z23'))) return 'CAV+'+(variant==='L'?'Z23':'Z22')
        return segment
      }))
      const source=await receive(f,raw),before=business(f),history=originalHistory(f),otherBefore=other?business(other):null
      await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:source.id})
      expect(business(f)).toEqual(before); expect(originalHistory(f)).toEqual(history); noPositiveAperak(f,source.id)
      if (other) expect(business(other)).toEqual(otherBefore)
      noActivation(f)
    })
  }

  it('refuses a genuine other grid party using the same own LI and object',async()=>{
    const f=await seed(variant),other=await seed(variant); await send(f)
    const source=await receive(f,confirmation(f).replaceAll(f.receiver,other.receiver))
    const before=business(f),otherBefore=business(other),history=originalHistory(f)
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:source.id})
    expect(business(f)).toEqual(before); expect(business(other)).toEqual(otherBefore)
    expect(originalHistory(f)).toEqual(history); noPositiveAperak(f,source.id); noActivation(f)
  })

  it('rejects wrong direction, foreign actor and disabled environment at the actual public outbound boundary',async()=>{
    const f=await seed(variant),other=await seed(variant),context=await sourceContext(f,f.original.raw_payload!),before=effects(f),otherBefore=effects(other)
    await expect(createCanonicalOutboundMessage({actorUserId:f.actorUserId,requestType:'supplier_switch',baseInput:{...draft(f),direction:'inbound'},customerMasterdataContext:context}))
      .rejects.toThrow('canonical_outbound_owner_scope_required')
    await expect(createCanonicalOutboundMessage({actorUserId:other.actorUserId,requestType:'supplier_switch',baseInput:draft(f),customerMasterdataContext:context}))
      .rejects.toMatchObject({disposition:{kind:'security_quarantine',code:'EDIEL_TENANT_ACTOR_FORBIDDEN'},message:'ediel_tenant_actor_forbidden'})
    await expect(createCanonicalOutboundMessage({actorUserId:f.actorUserId,requestType:'supplier_switch',baseInput:{...draft(f),environment:'production'},customerMasterdataContext:context}))
      .rejects.toThrow(`tenant_ediel_profile_not_enabled:${f.companyId}:production`)
    expect(effects(f)).toEqual(before); expect(effects(other)).toEqual(otherBefore)
  })

  it('refuses a formerly qualified supplier after real current-role expiry without persistence',async()=>{
    const f=await seed(variant),context=await sourceContext(f,f.original.raw_payload!)
    expect(sql(`WITH changed AS(UPDATE public.tenant_actor_roles SET valid_to=clock_timestamp() WHERE company_id=${literal(f.companyId)} AND environment='test' AND actor_id=${literal(f.actorUserId)} AND role_code='electricity_supplier' RETURNING id) SELECT to_jsonb(count(*)) FROM changed`)).toBe(1)
    const before=effects(f)
    await expect(createCanonicalOutboundMessage({actorUserId:f.actorUserId,requestType:'supplier_switch',baseInput:draft(f),customerMasterdataContext:context}))
      .rejects.toThrow(`tenant_market_roles_missing:${f.companyId}:test`)
    expect(effects(f)).toEqual(before)
  })

  it('rejects source raw/direction mutation through installed immutable-original guards',async()=>{
    const f=await seed(variant),before=effects(f)
    for (const attempt of [
      {update:{raw_payload:f.original.raw_payload!+' '},error:{code:'23514',message:'immutable_ediel_payload_cannot_change'}},
      {update:{direction:'inbound'},error:{code:'P0001',message:'switch_original_bound_message_immutable'}},
    ]) {
      const result=await supabaseService.from('ediel_messages').update(attempt.update).eq('company_id',f.companyId).eq('id',f.original.id)
      expect(result.error).toMatchObject(attempt.error)
      expect(effects(f)).toEqual(before)
    }
  })

  for (const boundary of ['latest lawful','one day late','fourteen months','one day too early'] as const) {
    it(`uses the actual public dispatch owner at the real ${boundary} calendar boundary`,async()=>{
      const calendar=today(),latest=days(calendar,variant==='L'?14:0),upper=months(calendar,14)
      const date=boundary==='latest lawful'?latest:boundary==='one day late'?days(latest,-1):boundary==='fourteen months'?upper:days(upper,1)
      const expected=boundary==='one day late'?'expired':boundary==='one day too early'?'too_early':'open'
      const f=await stage(variant,date),before=business(f)
      expect(today(),'no boundary crossed while constructing this prospective agreement').toBe(calendar)
      const schedule=await evaluateSupplierSwitchSchedule({ switchRequestId:f.switchId,companyId:f.companyId,requestedStartDate:date,
        transactionSubtype:variant,requestType:variant==='L'?'supplier_switch':'move_in',siteId:f.siteId,meteringPointId:f.pointId })
      expect(schedule.window).toMatchObject({reason:expected,windowOpen:expected==='open',transactionSubtype:variant})
      const result=await ensureInitialSwitchEdielAutomation({actorUserId:f.actorUserId,switchRequestId:f.switchId,communicationRouteId:f.routeId})
      if (expected==='open') {
        expect(result.blocked,JSON.stringify(result)).not.toBe(true); expect(result.message).toBeTruthy()
        expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.switch_originals WHERE company_id=${literal(f.companyId)} AND switch_id=${literal(f.switchId)}`)).toBe(1)
      } else {
        expect(result).toMatchObject({blocked:true,message:null,outboundRequestId:null,blockers:expect.arrayContaining([expect.objectContaining({code:'supplier_switch_send_window_'+expected})])})
        expect(sql(`SELECT jsonb_build_object('messages',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)}),
          'originals',(SELECT count(*) FROM gridex_received_sources.switch_originals WHERE company_id=${literal(f.companyId)}),
          'periods',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)}))`)).toEqual({messages:0,originals:0,periods:0})
        // The dispatch owner is allowed to record readiness/blocker diagnostics.
        const after=business(f) as Record<string,unknown>,initial=before as Record<string,unknown>
        for (const key of ['periods','contracts','sites','points','permissions','permissionSites','actorPermissions','confirmations','transitions']) expect(after[key],key).toEqual(initial[key])
      }
      expect(smtp).not.toHaveBeenCalled(); noActivation(f)
    })
  }
})
