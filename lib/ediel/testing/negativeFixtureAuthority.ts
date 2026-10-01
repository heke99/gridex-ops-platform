import { createHash } from 'node:crypto'
import { encodeEdifactLatin1 } from '@/lib/ediel/core/edifactEncoding'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { EdielPayloadPreflightResult } from '@/lib/ediel/core/messageBuilder'
import { supabaseService } from '@/lib/supabase/service'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'

export type SourceQualifiedNegativeFixture = Readonly<{
  registrationId: string; companyId: string; runId: string; roleCode: string; caseCode: string; suite: string; revision: string; stepNo: number;
  wireSha256: string; originalFileSha256: string; expectedOutcome: 'negative'; expectedDiagnosticCodes: readonly string[];
  testReceiverEdielId: string; validUntil: string; sourceReference: string; ownerDecisionReference: string;
}>
type SourceBinding = { registration: SourceQualifiedNegativeFixture; messageId: string | null;actorUserId:string }
const returnedAuthority = new WeakMap<SourceQualifiedNegativeFixture, SourceBinding>()
const qualifiedDrafts = new WeakMap<object, SourceQualifiedNegativeFixture>()
const hash = (raw: string) => createHash('sha256').update(encodeEdifactLatin1(raw)).digest('hex')
const codes = (values: readonly string[]) => [...new Set(values)].sort()
function matchesRaw(registration: SourceQualifiedNegativeFixture, companyId: string, rawPayload: string): boolean {
  try {
    const wire = tokenizeEdifact(rawPayload), unbs = wire.segments.filter(segment => segment.tag === 'UNB')
    return registration.companyId === companyId && registration.expectedOutcome === 'negative'
      && Number.isFinite(Date.parse(registration.validUntil)) && Date.parse(registration.validUntil) > Date.now()
      && registration.wireSha256 === hash(rawPayload) && registration.originalFileSha256 === registration.wireSha256
      && unbs.length === 1 && segmentComposite(unbs[0], 3, wire.una)[0] === registration.testReceiverEdielId
  } catch { return false }
}
async function read(context: Record<string, unknown>, rawPayload: string, companyId: string, messageId: string | null): Promise<SourceQualifiedNegativeFixture | null> {
  if(messageId===null)await assertEdielTenantActor({companyId,actorUserId:String(context.actorUserId??''),permissionAnyOf:['communication.write','ediel_testing.write']})
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as (name: 'gridex_ediel_negative_fixture_read_v1'|'gridex_ediel_negative_fixture_prepare_read_v1', args: {p_context: Record<string, unknown>}) => PromiseLike<{data: unknown; error: unknown}>
  const {data,error} = await rpc(messageId===null?'gridex_ediel_negative_fixture_prepare_read_v1':'gridex_ediel_negative_fixture_read_v1',{p_context:context})
  if (error) throw error
  if (data === null) return null
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('ediel_negative_fixture_authority_invalid')
  const value = data as SourceQualifiedNegativeFixture
  if (!value.registrationId || !value.runId || !value.roleCode || !value.caseCode || !value.suite || !value.revision || !Number.isInteger(value.stepNo) || value.stepNo <= 0
    || !value.sourceReference || !value.ownerDecisionReference || !Array.isArray(value.expectedDiagnosticCodes) || !value.expectedDiagnosticCodes.length
    || !value.expectedDiagnosticCodes.every(code => typeof code === 'string' && code.length > 0) || !matchesRaw(value,companyId,rawPayload)) throw new Error('ediel_negative_fixture_authority_scope_invalid')
  const registration = Object.freeze({...value,expectedDiagnosticCodes:Object.freeze([...value.expectedDiagnosticCodes])})
  returnedAuthority.set(registration,{registration,messageId,actorUserId:String(context.actorUserId??'')})
  return registration
}
/** Before persistence, qualify exact original bytes against the actual private
 * run/role/case/revision registration. Neither imported JSON nor generated
 * metadata can grant this evidence. Absent originals simply remain held. */
export async function resolveSourceQualifiedNegativeFixtureDraft(input: {
  companyId:string;runId:string;stepNo:number;actorUserId:string;rawPayload:string;diagnosticCodes:readonly string[]
}): Promise<SourceQualifiedNegativeFixture | null> {
  const registration = await read(input,input.rawPayload,input.companyId,null)
  return registration && JSON.stringify(codes(input.diagnosticCodes)) === JSON.stringify(codes(registration.expectedDiagnosticCodes)) ? registration : null
}
/** Live test transport requires the actual persisted message's unique run/step
 * link; caller parsed_payload.testRunId never chooses a qualification. */
export async function resolveSourceQualifiedNegativeFixtureForMessage(input: {message:EdielMessageRow;actorUserId:string}): Promise<SourceQualifiedNegativeFixture | null> {
  const {message} = input
  if (message.direction !== 'outbound' || message.environment !== 'test' || message.message_standard !== 'edifact' || !message.company_id || !message.id || !message.raw_payload) return null
  return read({companyId:message.company_id,messageId:message.id,actorUserId:input.actorUserId},message.raw_payload,message.company_id,message.id)
}
export function sourceQualifiedNegativeFixtureMatchesMessage(input: {message:EdielMessageRow;diagnosticCodes:readonly string[];qualification?:SourceQualifiedNegativeFixture | null}): boolean {
  const binding = input.qualification ? returnedAuthority.get(input.qualification) : null
  return Boolean(binding && binding.messageId === input.message.id && input.message.direction === 'outbound' && input.message.environment === 'test' && input.message.message_standard === 'edifact'
    && input.message.company_id && matchesRaw(binding.registration,input.message.company_id,input.message.raw_payload ?? '')
    && input.diagnosticCodes.length > 0 && JSON.stringify(codes(input.diagnosticCodes)) === JSON.stringify(codes(binding.registration.expectedDiagnosticCodes)))
}
/** The preflight still reports the deliberately failed national test. Only its
 * exact registered original and expected findings may proceed on the test
 * port. Local authority failures and protected register/D facts stay blocking;
 * production, crypto, routing and tenant gates keep their own strict evidence. */
export function sourceQualifiedNegativeFixtureAllowsPreflight(input:{message:EdielMessageRow;preflight:EdielPayloadPreflightResult;qualification?:SourceQualifiedNegativeFixture|null}):boolean {
 const errors=input.preflight.issues.filter(issue=>issue.severity==='error')
 return input.preflight.blocking&&errors.length>0&&!errors.some(issue=>issue.code.startsWith('CANONICAL_')||issue.code.startsWith('PRODAT_REGISTER_')||issue.code.startsWith('PRODAT_DEPENDENT_PREFLIGHT_'))
  &&sourceQualifiedNegativeFixtureMatchesMessage({message:input.message,qualification:input.qualification,diagnosticCodes:errors.map(issue=>issue.code)})
}
type DraftIdentity = {companyId?:string | null;environment?:string | null;direction?:string | null;rawPayload?:string | null}
/** Recheck the prospective opaque port against the final creation bytes after
 * the kernel read the exact bound input and made its internal clone. */
export function sourceQualifiedNegativeFixtureMatchesDraft(input:{draft:DraftIdentity;diagnosticCodes:readonly string[];qualification?:SourceQualifiedNegativeFixture | null}):boolean {
  const binding=input.qualification ? returnedAuthority.get(input.qualification) : null
  return Boolean(binding && binding.messageId === null && input.draft.direction === 'outbound' && input.draft.environment === 'test'
    && input.draft.companyId && matchesRaw(binding.registration,input.draft.companyId,input.draft.rawPayload ?? '')
    && input.diagnosticCodes.length > 0 && JSON.stringify(codes(input.diagnosticCodes)) === JSON.stringify(codes(binding.registration.expectedDiagnosticCodes)))
}
/** Pass evidence to the exact create input without serializing an authority
 * marker. Any copy or altered bytes lose this prospective qualification. */
export function bindSourceQualifiedNegativeFixtureDraft(draft:DraftIdentity,qualification:SourceQualifiedNegativeFixture): void {
  const binding=returnedAuthority.get(qualification)
  if (!binding || binding.messageId !== null || draft.direction !== 'outbound' || draft.environment !== 'test' || !draft.companyId || !matchesRaw(binding.registration,draft.companyId,draft.rawPayload ?? '')) throw new Error('ediel_negative_fixture_draft_binding_invalid')
  qualifiedDrafts.set(draft,qualification)
}
export function readSourceQualifiedNegativeFixtureDraft(draft:DraftIdentity):SourceQualifiedNegativeFixture | null {
  const qualification=qualifiedDrafts.get(draft), binding=qualification ? returnedAuthority.get(qualification) : null
  return binding && binding.messageId === null && draft.direction === 'outbound' && draft.environment === 'test' && draft.companyId && matchesRaw(binding.registration,draft.companyId,draft.rawPayload ?? '') ? qualification! : null
}
/** Prepare a native one-use source original before the ordinary canonical
 * owner seal. Permission to prepare does not permit provider entry. */
export async function prepareSourceQualifiedNegativeFixtureWitness(input:{qualification:SourceQualifiedNegativeFixture;actorUserId:string;rawPayload:string}):Promise<{witnessId:string;qualification:SourceQualifiedNegativeFixture}>{
 const q=input.qualification,b=returnedAuthority.get(q)
 if(!b||b.messageId!==null||b.actorUserId!==input.actorUserId||!matchesRaw(q,q.companyId,input.rawPayload))throw Error('ediel_negative_fixture_witness_required')
 await assertEdielTenantActor({companyId:q.companyId,actorUserId:input.actorUserId,permissionAnyOf:['communication.write','ediel_testing.write']})
 const {data,error}=await supabaseService.rpc('gridex_ediel_negative_fixture_prepare_v1',{p_context:{companyId:q.companyId,runId:q.runId,stepNo:q.stepNo,actorUserId:input.actorUserId,rawPayload:input.rawPayload,registrationId:q.registrationId}})
 if(error||typeof data?.witnessId!=='string'||data?.qualification?.registrationId!==q.registrationId||data?.qualification?.wireSha256!==q.wireSha256)throw Error('ediel_negative_fixture_witness_required',{cause:error})
 return {witnessId:data.witnessId,qualification:q}
}
