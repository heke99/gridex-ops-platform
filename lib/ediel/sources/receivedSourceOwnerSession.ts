import {takeReceivedSourceOwnerSeed, type ReceivedSourceValidationReceipt} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {bindReceivedRegisterValidation} from '@/lib/ediel/core/receivedRegisterValidationBinding'
import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'
import {isSourceSwitchCommit, type SourceSwitchCommitObserver, type SourceSwitchCommit} from '@/lib/ediel/flows/sourceSwitchCommit'
import {resolveCanonicalTenantEdielIdentityWithEvidence, assertInboundTransportMatchesTenantIdentity} from '@/lib/ediel/tenant/tenantEdielIdentity'
import {readSelectedFacilityEvidence, readSourceOwnerRow} from './sourceOwnerReads'
import {readCommittedZ04Wire, type SourceObjectScope} from './sourceOwnerWire'

import {persistReceivedSourceOwnerDecisions as persist, type SourceOwnerReceipt, type SourceOwnerSeed as Seed, type SourceObjectDecision as ObjectDecision} from './sourceOwnerPersistence'
export type {SourceOwnerReceipt} from './sourceOwnerPersistence'
export type SourceOwnerSession = {onSwitchCommitted:SourceSwitchCommitObserver;finish:()=>Promise<SourceOwnerReceipt>}

/** A source-specific successful write handoff is required before reading owner
 * rows. Neither accepted rows found later nor cached status JSON authorizes it. */
async function committedOwners(seed:Seed, commit:SourceSwitchCommit, object:SourceObjectScope) {
  const {original,evidence} = seed, message = structuredClone(commit.message)
  if (!isSourceSwitchCommit(commit) || message.id !== original.id || message.company_id !== evidence.companyId
    || message.environment !== evidence.environment || message.message_code !== original.message_code
    || message.raw_payload !== original.raw_payload || original.message_code !== 'Z04'
    || ![message.customer_id,message.metering_point_id,message.site_id,commit.switchRequestId,commit.supplyPeriodId].every(isEvidenceUuid)) return null
  const wire = readCommittedZ04Wire(original.raw_payload!, object)
  if (!wire) return null
  const assessedAt = new Date().toISOString()
  const received = parseSourceReceiptInstant(original.message_received_at)
  if (received === null || received > parseSourceReceiptInstant(assessedAt)!) return null
  const signal = AbortSignal.timeout(10000)
  const receiver = await resolveCanonicalTenantEdielIdentityWithEvidence({companyId:evidence.companyId,environment:evidence.environment,asOf:assessedAt,requireExactCounts:true})
  assertInboundTransportMatchesTenantIdentity({identity:receiver.identity,unbReceiverEdielId:wire.parties.transportReceiver})
  if (receiver.identity.legalEdielId !== wire.parties.legalReceiver || !receiver.identity.roleCodes.includes('electricity_supplier')
    || receiver.evidence.records.transportIdentifiers.some(row => row.is_verified !== true)) return null
  const facility = await readSelectedFacilityEvidence({companyId:evidence.companyId,environment:evidence.environment,
    meteringPointId:message.metering_point_id!,siteId:message.site_id!,objectId:object.objectId!,signal})
  if (facility.gridOwner.ediel_id !== wire.parties.legalSender) return null
  const sw = await readSourceOwnerRow('supplier_switch_requests',evidence.companyId,commit.switchRequestId,signal)
  const sp = await readSourceOwnerRow('customer_supply_periods',evidence.companyId,commit.supplyPeriodId,signal)
  if (sw.customer_id !== message.customer_id || sp.customer_id !== message.customer_id || sw.metering_point_id !== message.metering_point_id
    || sp.metering_point_id !== message.metering_point_id || sw.site_id !== message.site_id || sw.inbound_z04_message_id !== original.id
    || sp.source_message_id !== original.id || sw.status !== 'accepted' || sp.status !== 'confirmed_by_grid_owner'
    || sw.confirmed_start_date !== wire.marketDate || sp.start_date !== wire.marketDate) return null
  const source = {sourceMessageId:evidence.sourceMessageId,sourcePayloadHash:evidence.sourcePayloadHash,companyId:evidence.companyId,environment:evidence.environment}
  const common = {companyId:evidence.companyId,customerId:message.customer_id,meteringPointId:message.metering_point_id,sourceMessageId:evidence.sourceMessageId}
  const business = {version:1,owner:'inbound-z04-switch-confirmation-v1',coverage:'committed_switch_and_supply_only',sourceDisposition:'not_established',businessDisposition:'committed',assessedAt,
    ...source,sourceReceivedAt:original.message_received_at,switchRequestId:commit.switchRequestId,supplyPeriodId:commit.supplyPeriodId,
    customerId:message.customer_id,meteringPointId:message.metering_point_id,siteId:message.site_id,graphNamespace:'legacy_unqualified',object,
    effectiveFrom:wire.effectiveFrom,committedRecords:{switch:{...common,id:sw.id,siteId:sw.site_id,status:sw.status,confirmedStartDate:sw.confirmed_start_date},
      supply:{...common,id:sp.id,status:sp.status,startDate:sp.start_date}}}
  const party = {version:1,owner:'received-source-party-binding-v1',ruleVersion:'1',source:{...source,receivedAt:original.message_received_at},
    object,assessedAt,completedAt:new Date().toISOString(),historicalKnowledge:'not_established',authentication:'not_assessed',
    disposition:'accepted',reasons:[],receiver,facility,parties:wire.parties}
  return {business,party}
}

/** Consume only a fresh, one-use canonical receipt capability. The source is
 * cloned at canonical validation, before mutable processing/link metadata can
 * change it. All physical objects remain represented, including unavailable
 * and rejected ones. This does not select temporal comparison baselines. */
export function createReceivedSourceOwnerSession(receipt:ReceivedSourceValidationReceipt):SourceOwnerSession|null {
  const seed = takeReceivedSourceOwnerSeed(receipt)
  if (!seed || typeof seed.original.raw_payload !== 'string') return null
  const canonical = JSON.parse(seed.evidence.factsText) as Record<string,unknown>
  const register = bindReceivedRegisterValidation(canonical.registerValidation, seed.original.raw_payload)
  if (!register || !register.objects.length) return null
  const ready = [canonical.syntaxDecision,canonical.applicationDecision,canonical.functionalDecision].every(state=>state==='accepted')
  const rejected = [canonical.syntaxDecision,canonical.applicationDecision,canonical.functionalDecision].includes('rejected')
  const entries: ObjectDecision[] = register.objects.map(({disposition,reasons,...object})=>({object,
    disposition:rejected||disposition==='rejected'?'rejected':'unavailable',
    reasons:rejected?['canonical_rejected']:disposition==='rejected'&&reasons.length?reasons:['source_owner_not_established'],business:null,party:null}))
  let operation:Promise<SourceOwnerReceipt>|undefined
  return {
    async onSwitchCommitted(commit) {
      if (operation || !isSourceSwitchCommit(commit)) return
      operation = (async()=>{
        if (ready) {
          // One actual legacy operation selects one physical point. Resolve
          // that point once, rather than doing owner reads in an object loop.
          try {
            const point = await readSourceOwnerRow('metering_points', seed.evidence.companyId,
              commit.message.metering_point_id ?? '', AbortSignal.timeout(2000))
            const matches = entries.map((entry,index)=>({entry,index})).filter(({entry,index})=>
              register.objects[index].disposition === 'accepted' && entry.object.messageIndex === 0
              && entry.object.identityAgency === '9' && entry.object.objectId === point.meter_point_id)
            if (matches.length === 1) {
              const {entry,index} = matches[0]
              const owners = await committedOwners(seed,commit,entry.object)
              if (owners) entries[index] = {...entry,...owners,disposition:'accepted',reasons:[]}
            }
          } catch { /* Preserve all explicit unavailable entries. */ }
        }
        return persist(seed,entries)
      })()
      return operation
    },
    finish() { return operation ??= persist(seed,entries) },
  }
}
