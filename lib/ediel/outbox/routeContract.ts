import type { EdielMessageRow } from '@/lib/ediel/types'
import {
  evaluateProductionTransportSecurity,
  getEdielRouteRuntimeByCommunicationRouteId,
  type EdielRouteRuntimeRow,
} from '@/lib/ediel/config'
import { supabaseService } from '@/lib/supabase/service'
import { expectedApplicationReference } from '@/lib/routes/routeReadiness'

type CertificateRow = {
  id: string
  environment?: string | null
  owner_ediel_id?: string | null
  owner_subaddress?: string | null
  message_family?: string | null
  message_type?: string | null
  usage?: string | null
  purpose?: string | null
  status?: string | null
  valid_from?: string | null
  valid_to?: string | null
  fingerprint_sha256?: string | null
  certificate_fingerprint?: string | null
}

export type EdielRouteContract = {
  ok: boolean
  blocker: string | null
  fingerprint: string | null
  routeId: string | null
  receiverEdielId: string | null
  receiverSubaddress: string | null
  certificateId: string | null
  certificateFingerprint: string | null
  checks: string[]
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function upper(value: unknown): string | null {
  const output = clean(value)
  return output ? output.toUpperCase() : null
}

function same(a: unknown, b: unknown): boolean {
  const left = upper(a)
  const right = upper(b)
  return Boolean(left && right && left === right)
}

function requestTypeFor(message: EdielMessageRow): 'supplier_switch' | 'customer_masterdata' | 'metering_access' | 'meter_values' | 'billing_underlay' | 'ediel_ack' {
  const family = upper(message.message_family)
  const code = upper(message.message_code)
  if (family === 'PRODAT' && code === 'Z01') return 'customer_masterdata'
  if (family === 'PRODAT' && ['Z13', 'Z18'].includes(String(code))) return 'metering_access'
  if (family === 'UTILTS' && code === 'E66') return 'meter_values'
  if (family === 'UTILTS') return 'billing_underlay'
  if (family === 'APERAK' || family === 'CONTRL' || family === 'UTILTS_ERR') return 'ediel_ack'
  return 'supplier_switch'
}

function effectiveRuntimeSubaddress(runtime: EdielRouteRuntimeRow): string | null {
  return clean(runtime.receiver_message_subaddress) ?? clean(runtime.receiver_subaddress) ?? clean(runtime.receiver_sub_address)
}

function certificateRequired(runtime: EdielRouteRuntimeRow, message: EdielMessageRow): boolean {
  const security = evaluateProductionTransportSecurity({ runtime, messageFamily: message.message_family })
  const smime = clean(runtime.encryption_mode)?.toLowerCase() === 'smime'
  return runtime.certificate_required === true || smime || security.issues.some((issue) => issue.key === 'certificate_missing')
}

function certificateUsable(row: CertificateRow, message: EdielMessageRow, runtime: EdielRouteRuntimeRow): string | null {
  const now = Date.now()
  const status = clean(row.status)?.toLowerCase()
  if (status && !['valid', 'active'].includes(status)) return `receiver_certificate_status_${status}`
  const validFrom = clean(row.valid_from)
  if (validFrom && new Date(validFrom).getTime() > now) return 'receiver_certificate_not_yet_valid'
  const validTo = clean(row.valid_to)
  if (validTo && new Date(validTo).getTime() <= now) return 'receiver_certificate_expired'
  if (clean(row.environment) && clean(row.environment) !== message.environment) return 'receiver_certificate_environment_mismatch'
  if (clean(row.owner_ediel_id) && !same(row.owner_ediel_id, runtime.receiver_ediel_id)) return 'receiver_certificate_owner_mismatch'
  const runtimeSubaddress = effectiveRuntimeSubaddress(runtime)
  if (clean(row.owner_subaddress) && runtimeSubaddress && !same(row.owner_subaddress, runtimeSubaddress)) return 'receiver_certificate_subaddress_mismatch'
  if (clean(row.message_family) && !same(row.message_family, message.message_family)) return 'receiver_certificate_message_family_mismatch'
  if (clean(row.message_type) && !same(row.message_type, message.message_code)) return 'receiver_certificate_message_code_mismatch'
  return null
}

async function loadCertificate(id: string): Promise<CertificateRow | null> {
  const { data, error } = await supabaseService
    .from('ediel_certificates')
    .select('id,environment,owner_ediel_id,owner_subaddress,message_family,message_type,usage,purpose,status,valid_from,valid_to,fingerprint_sha256,certificate_fingerprint')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as CertificateRow | null) ?? null
}

export async function evaluateEdielRouteContract(message: EdielMessageRow): Promise<EdielRouteContract> {
  if (message.direction !== 'outbound') {
    return { ok: true, blocker: null, fingerprint: null, routeId: null, receiverEdielId: null, receiverSubaddress: null, certificateId: null, certificateFingerprint: null, checks: ['not_outbound'] }
  }

  const routeId = clean(message.communication_route_id)
  if (!routeId) return { ok: false, blocker: 'route_profile_missing', fingerprint: null, routeId: null, receiverEdielId: null, receiverSubaddress: null, certificateId: null, certificateFingerprint: null, checks: [] }
  const runtime = await getEdielRouteRuntimeByCommunicationRouteId(routeId, { companyId: message.company_id ?? null })
  if (!runtime || runtime.is_enabled !== true || runtime.communication_route_active !== true) {
    return { ok: false, blocker: 'route_not_active', fingerprint: null, routeId, receiverEdielId: null, receiverSubaddress: null, certificateId: null, certificateFingerprint: null, checks: [] }
  }
  if (runtime.environment !== message.environment) {
    return { ok: false, blocker: 'route_environment_mismatch', fingerprint: null, routeId, receiverEdielId: null, receiverSubaddress: null, certificateId: null, certificateFingerprint: null, checks: [] }
  }

  const receiverEdielId = clean(runtime.receiver_ediel_id)
  const receiverSubaddress = effectiveRuntimeSubaddress(runtime)
  if (!receiverEdielId) return { ok: false, blocker: 'route_receiver_ediel_id_missing', fingerprint: null, routeId, receiverEdielId, receiverSubaddress, certificateId: null, certificateFingerprint: null, checks: [] }
  if (clean(message.receiver_ediel_id) && !same(message.receiver_ediel_id, receiverEdielId)) {
    return { ok: false, blocker: 'route_receiver_ediel_id_mismatch', fingerprint: null, routeId, receiverEdielId, receiverSubaddress, certificateId: null, certificateFingerprint: null, checks: [] }
  }
  if (runtime.subaddress_required === true && !receiverSubaddress) {
    return { ok: false, blocker: 'route_receiver_subaddress_missing', fingerprint: null, routeId, receiverEdielId, receiverSubaddress, certificateId: null, certificateFingerprint: null, checks: [] }
  }
  if (clean(message.receiver_sub_address) && receiverSubaddress && !same(message.receiver_sub_address, receiverSubaddress)) {
    return { ok: false, blocker: 'route_receiver_subaddress_mismatch', fingerprint: null, routeId, receiverEdielId, receiverSubaddress, certificateId: null, certificateFingerprint: null, checks: [] }
  }
  if (clean(runtime.message_family) && !same(runtime.message_family, message.message_family)) {
    return { ok: false, blocker: 'route_message_family_mismatch', fingerprint: null, routeId, receiverEdielId, receiverSubaddress, certificateId: null, certificateFingerprint: null, checks: [] }
  }
  if (clean(runtime.business_code) && !same(runtime.business_code, message.message_code)) {
    return { ok: false, blocker: 'route_message_code_mismatch', fingerprint: null, routeId, receiverEdielId, receiverSubaddress, certificateId: null, certificateFingerprint: null, checks: [] }
  }

  const requestType = requestTypeFor(message)
  const expectedReference = expectedApplicationReference(requestType)
  if (expectedReference && clean(message.application_reference) && !same(message.application_reference, expectedReference)) {
    return { ok: false, blocker: 'route_application_reference_mismatch', fingerprint: null, routeId, receiverEdielId, receiverSubaddress, certificateId: null, certificateFingerprint: null, checks: [] }
  }
  if (expectedReference && clean(runtime.application_reference) && !same(runtime.application_reference, expectedReference)) {
    return { ok: false, blocker: 'route_runtime_application_reference_mismatch', fingerprint: null, routeId, receiverEdielId, receiverSubaddress, certificateId: null, certificateFingerprint: null, checks: [] }
  }

  const transport = evaluateProductionTransportSecurity({ runtime, messageFamily: message.message_family })
  const transportFailure = transport.issues.find((issue) => issue.severity === 'error')
  if (transportFailure) return { ok: false, blocker: transportFailure.key, fingerprint: null, routeId, receiverEdielId, receiverSubaddress, certificateId: null, certificateFingerprint: null, checks: transport.issues.map((issue) => issue.key) }

  const certId = clean(runtime.receiver_certificate_id) ?? clean(runtime.certificate_id)
  let certificateFingerprint: string | null = null
  if (certificateRequired(runtime, message)) {
    if (!certId) return { ok: false, blocker: 'receiver_certificate_missing', fingerprint: null, routeId, receiverEdielId, receiverSubaddress, certificateId: null, certificateFingerprint: null, checks: [] }
    const cert = await loadCertificate(certId)
    if (!cert) return { ok: false, blocker: 'receiver_certificate_not_found', fingerprint: null, routeId, receiverEdielId, receiverSubaddress, certificateId: certId, certificateFingerprint: null, checks: [] }
    const certificateBlocker = certificateUsable(cert, message, runtime)
    if (certificateBlocker) return { ok: false, blocker: certificateBlocker, fingerprint: null, routeId, receiverEdielId, receiverSubaddress, certificateId: certId, certificateFingerprint: null, checks: [] }
    certificateFingerprint = clean(cert.fingerprint_sha256) ?? clean(cert.certificate_fingerprint)
  }

  const fingerprint = [
    message.company_id ?? 'platform', routeId, message.environment, message.message_family, message.message_code,
    receiverEdielId, receiverSubaddress ?? '-', expectedReference ?? clean(runtime.application_reference) ?? '-', certId ?? '-', certificateFingerprint ?? '-',
  ].join('|')
  return { ok: true, blocker: null, fingerprint, routeId, receiverEdielId, receiverSubaddress, certificateId: certId, certificateFingerprint, checks: ['route', 'environment', 'receiver', 'subaddress', 'message', 'application_reference', 'transport', 'certificate'] }
}
