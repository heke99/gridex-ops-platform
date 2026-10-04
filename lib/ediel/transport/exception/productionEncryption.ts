// TR-09 (owner decision 2026-10-04): S/MIME is required for every message
// family in production. Plaintext is admitted only through a journaled, bounded
// transport exception that keeps mandatory TLS. There is no general switch.
export const PRODUCTION_PLAINTEXT_REFUSAL = 'transport_exception_actual_approved_plaintext_source_required'
export const PLAINTEXT_EXCEPTION_TLS_REFUSAL = 'transport_exception_current_verified_tls_route_required'

export function assertProductionTransportEncrypted(params: {
  environment?: string | null
  wireEncrypted: boolean
  plaintextException: boolean
}): void {
  if (params.environment === 'production' && !params.wireEncrypted && !params.plaintextException) {
    throw new Error(PRODUCTION_PLAINTEXT_REFUSAL)
  }
}

export function assertPlaintextExceptionKeepsTls(
  route: { tls_required?: boolean | null; transport_security_mode?: string | null } | null,
): void {
  if (!route || route.tls_required !== true || route.transport_security_mode === 'needs_verification') {
    throw new Error(PLAINTEXT_EXCEPTION_TLS_REFUSAL)
  }
}
