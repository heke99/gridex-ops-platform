import { createHash, X509Certificate } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import type { ActorRegistryImportSummary, ParsedActorRegistryActor, ActorRegistryCertificate } from '@/lib/actor-registry/types'
import { cleanString, normalizeEdielId, normalizeEic, normalizeOrgNumber } from '@/lib/actor-registry/normalizeActor'
import { parseActorRegistryXml } from '@/lib/actor-registry/parseActorRegistryXml'

function certificateSource(certificate: ActorRegistryCertificate) {
  // Preserve actual PEM boundaries; display normalization corrupts X509 bytes.
  const pem = typeof certificate.pem==='string' ? certificate.pem.trim()||null : null
  if (!pem) return { ...certificate, environment: certificate.environment === 'test' ? 'test' : 'production', purpose: certificate.purpose === 'signing' ? 'signing' : 'encryption', fingerprintSha256: cleanString(certificate.fingerprintSha256)?.toUpperCase(), derBase64: null }
  const parsed = new X509Certificate(pem)
  const fingerprint = createHash('sha256').update(parsed.raw).digest('hex').toUpperCase()
  if (certificate.fingerprintSha256 && certificate.fingerprintSha256.toUpperCase() !== fingerprint) throw new Error('ediel_registry_certificate_source_fingerprint_mismatch')
  return { ...certificate, environment: certificate.environment === 'test' ? 'test' : 'production', purpose: certificate.purpose === 'signing' ? 'signing' : 'encryption', pem,
    fingerprintSha256: fingerprint, derBase64: parsed.raw.toString('base64'),
    validFrom: new Date(parsed.validFrom).toISOString(), validTo: new Date(parsed.validTo).toISOString(), subject: parsed.subject, issuer: parsed.issuer, serialNumber: parsed.serialNumber }
}

/** Decode declared source text while retaining the exact uploaded byte archive.
 * Replacement characters must never silently alter a registry source. */
export function decodeRegistryUpload(bytes: Buffer, kind: 'companies_xml' | 'companies_txt' | 'csv'): string {
  let encoding='utf-8'
  if(kind==='companies_xml') {
    if(bytes[0]===0xff&&bytes[1]===0xfe)encoding='utf-16le'
    else if(bytes[0]===0xfe&&bytes[1]===0xff)encoding='utf-16be'
    else encoding=bytes.subarray(0,256).toString('ascii').match(/<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase()??'utf-8'
  }
  if(!['utf-8','utf8','utf-16','utf-16le','utf-16be','iso-8859-1','windows-1252'].includes(encoding))throw new Error('ediel_registry_declared_encoding_adapter_required')
  if(encoding==='iso-8859-1')return bytes.toString('latin1')
  return new TextDecoder(encoding,{fatal:true}).decode(bytes)
}

/** The actual admin and API producers share one atomic database apply. Source
 * parsing has no external certificate I/O and does not activate any capability. */
type RegistryApplyInput = {
  sourceBytes: string | Buffer; sourceKind: 'companies_xml' | 'companies_txt' | 'csv'; sourceFilename?: string | null;
  actorUserId: string; actors: ParsedActorRegistryActor[]
}
type RegistryApplyResult = ActorRegistryImportSummary & { uiRunId: string; routeIds: string[]; activation: string }
function checkedApplyResult(data: RegistryApplyResult | null): RegistryApplyResult {
  if (!data || typeof data.importRunId !== 'string' || !Array.isArray(data.routeIds) || !Number.isInteger(data.totalRecords)) throw new Error('ediel_registry_atomic_apply_result_invalid')
  // Historical immutable batches still replay their own result in the native
  // owner. A zero-route result must not be presented as a successful import.
  if (data.routeIds.length === 0) throw new Error('ediel_registry_zero_routes_source_held')
  return data
}

export async function readActorRegistryPriorResult(input: Pick<RegistryApplyInput, 'sourceBytes' | 'sourceKind' | 'actorUserId'>): Promise<RegistryApplyResult | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.actorUserId)) throw new Error('ediel_registry_authenticated_platform_actor_required')
  const bytes=typeof input.sourceBytes==='string'?Buffer.from(input.sourceBytes,'utf8'):Buffer.from(input.sourceBytes)
  const { data, error }=await supabaseService.rpc('ediel_read_actor_registry_batch_v1',{
    p_actor_user_id:input.actorUserId,p_source_base64:bytes.toString('base64'),p_source_sha256:createHash('sha256').update(bytes).digest('hex'),p_source_kind:input.sourceKind,
  })
  if(error)throw error
  if(data===null)return null
  if(data?.reusedExistingRun!==true)throw new Error('ediel_registry_prior_result_invalid')
  return checkedApplyResult(data)
}

async function applyNewActorRegistryRecords(input: RegistryApplyInput): Promise<RegistryApplyResult> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.actorUserId)) throw new Error('ediel_registry_authenticated_platform_actor_required')
  const bytes=typeof input.sourceBytes==='string'?Buffer.from(input.sourceBytes,'utf8'):Buffer.from(input.sourceBytes)
  const records = input.actors.map(actor => ({ ...actor, edielId: normalizeEdielId(actor.edielId), orgNumber: normalizeOrgNumber(actor.orgNumber), eic: normalizeEic(actor.eic), certificates: actor.certificates.flatMap(certificate => certificate.purpose==='both'?[certificateSource({...certificate,purpose:'encryption'}),certificateSource({...certificate,purpose:'signing'})]:[certificateSource(certificate)]) }))
  const { data, error } = await supabaseService.rpc('ediel_apply_actor_registry_v1', {
    p_actor_user_id: input.actorUserId, p_source_base64: bytes.toString('base64'),
    p_source_sha256: createHash('sha256').update(bytes).digest('hex'),
    p_source_kind: input.sourceKind, p_source_filename: input.sourceFilename ?? null, p_records: records,
  })
  if (error) throw error
  return checkedApplyResult(data)
}

export async function applyActorRegistryRecords(input: RegistryApplyInput): Promise<RegistryApplyResult> {
  const prior=await readActorRegistryPriorResult(input)
  if(prior)return prior
  return applyNewActorRegistryRecords(input)
}

export async function importActorRegistryXml(input: {
  xml: string; sourceBytes?: Buffer; sourceFilename?: string | null; uploadedBy?: string | null; forceReprocess?: boolean
}): Promise<ActorRegistryImportSummary> {
  if (!input.uploadedBy) throw new Error('ediel_registry_authenticated_platform_actor_required')
  const sourceBytes=input.sourceBytes??input.xml
  const prior=await readActorRegistryPriorResult({sourceBytes,sourceKind:'companies_xml',actorUserId:input.uploadedBy})
  if(prior)return prior
  if (input.sourceBytes && decodeRegistryUpload(input.sourceBytes, 'companies_xml') !== input.xml) throw new Error('ediel_registry_source_bytes_text_mismatch')
  // Exact same bytes always replay the immutable result. forceReprocess can no
  // longer invent a timestamp-suffixed source hash or adopt a partial old run.
  return applyNewActorRegistryRecords({ sourceBytes, sourceKind: 'companies_xml', sourceFilename: input.sourceFilename, actorUserId: input.uploadedBy, actors: parseActorRegistryXml(input.xml) })
}
