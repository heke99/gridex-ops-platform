import { createHash, X509Certificate } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import type { ActorRegistryImportSummary, ParsedActorRegistryActor, ActorRegistryCertificate } from '@/lib/actor-registry/types'
import { cleanString, normalizeEdielId, normalizeEic, normalizeOrgNumber } from '@/lib/actor-registry/normalizeActor'
import { parseActorRegistryXml } from '@/lib/actor-registry/parseActorRegistryXml'

function certificateSource(certificate: ActorRegistryCertificate) {
  const pem = cleanString(certificate.pem)
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
export async function applyActorRegistryRecords(input: {
  sourceBytes: string | Buffer; sourceKind: 'companies_xml' | 'companies_txt' | 'csv'; sourceFilename?: string | null;
  actorUserId: string; actors: ParsedActorRegistryActor[]
}): Promise<ActorRegistryImportSummary & { uiRunId: string; routeIds: string[]; activation: string }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.actorUserId)) throw new Error('ediel_registry_authenticated_platform_actor_required')
  const bytes=typeof input.sourceBytes==='string'?Buffer.from(input.sourceBytes,'utf8'):Buffer.from(input.sourceBytes)
  const records = input.actors.map(actor => ({ ...actor, edielId: normalizeEdielId(actor.edielId), orgNumber: normalizeOrgNumber(actor.orgNumber), eic: normalizeEic(actor.eic), certificates: actor.certificates.flatMap(certificate => certificate.purpose==='both'?[certificateSource({...certificate,purpose:'encryption'}),certificateSource({...certificate,purpose:'signing'})]:[certificateSource(certificate)]) }))
  const { data, error } = await supabaseService.rpc('ediel_apply_actor_registry_v1', {
    p_actor_user_id: input.actorUserId, p_source_base64: bytes.toString('base64'),
    p_source_sha256: createHash('sha256').update(bytes).digest('hex'),
    p_source_kind: input.sourceKind, p_source_filename: input.sourceFilename ?? null, p_records: records,
  })
  if (error) throw error
  if (!data || typeof data.importRunId !== 'string' || !Array.isArray(data.routeIds) || !Number.isInteger(data.totalRecords)) throw new Error('ediel_registry_atomic_apply_result_invalid')
  return data
}

export async function importActorRegistryXml(input: {
  xml: string; sourceFilename?: string | null; uploadedBy?: string | null; forceReprocess?: boolean
}): Promise<ActorRegistryImportSummary> {
  if (!input.uploadedBy) throw new Error('ediel_registry_authenticated_platform_actor_required')
  // Exact same bytes always replay the immutable result. forceReprocess can no
  // longer invent a timestamp-suffixed source hash or adopt a partial old run.
  return applyActorRegistryRecords({ sourceBytes: input.xml, sourceKind: 'companies_xml', sourceFilename: input.sourceFilename, actorUserId: input.uploadedBy, actors: parseActorRegistryXml(input.xml) })
}
