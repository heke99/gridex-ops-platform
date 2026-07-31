import { ExternalTenantContextError } from '@/lib/integrations/tenantContext'

type ErrorRecord = {
  code?: unknown
  message?: unknown
  details?: unknown
  hint?: unknown
}

export type PublicApiErrorClassification = {
  status: number
  code:
    | 'TENANT_NOT_FOUND'
    | 'EXTERNAL_TENANT_REFERENCE_MISSING'
    | 'TENANT_NOT_OPERATIONALLY_READY'
    | 'PUBLICATION_GRAPH_INCOMPLETE'
    | 'PUBLIC_CONTRACT_SCHEMA_OUTDATED'
    | 'PUBLIC_CONTRACTS_TEMPORARILY_UNAVAILABLE'
  message: string
  databaseCode: string | null
}

function errorRecord(error: unknown): ErrorRecord {
  return error && typeof error === 'object' ? (error as ErrorRecord) : {}
}

export function classifyPublicContractsError(
  error: unknown,
): PublicApiErrorClassification {
  if (error instanceof ExternalTenantContextError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      databaseCode: null,
    }
  }

  const record = errorRecord(error)
  const databaseCode =
    typeof record.code === 'string' && record.code.trim()
      ? record.code.trim()
      : null
  const message =
    typeof record.message === 'string' ? record.message : String(error ?? '')
  const technical = `${message} ${String(record.details ?? '')} ${String(
    record.hint ?? '',
  )}`

  if (
    databaseCode === '42P01' ||
    databaseCode === '42703' ||
    databaseCode === '42883' ||
    databaseCode === 'PGRST202' ||
    databaseCode === 'PGRST204' ||
    databaseCode === 'PGRST205' ||
    technical.includes('PUBLIC_CONTRACT_SCHEMA_OUTDATED')
  ) {
    return {
      status: 503,
      code: 'PUBLIC_CONTRACT_SCHEMA_OUTDATED',
      message: 'Public contracts-schemat är inte uppdaterat.',
      databaseCode,
    }
  }

  if (
    databaseCode === '23514' ||
    technical.includes('PUBLICATION_') ||
    technical.includes('publication graph')
  ) {
    return {
      status: 409,
      code: 'PUBLICATION_GRAPH_INCOMPLETE',
      message: 'Publiceringsgrafen är ofullständig och exponeras inte.',
      databaseCode,
    }
  }

  if (
    databaseCode === '57014' ||
    databaseCode === '55P03' ||
    databaseCode?.startsWith('08') ||
    databaseCode === 'PGRST000' ||
    databaseCode === 'PGRST001' ||
    databaseCode === 'PGRST002' ||
    technical.includes('fetch failed') ||
    technical.includes('timeout')
  ) {
    return {
      status: 503,
      code: 'PUBLIC_CONTRACTS_TEMPORARILY_UNAVAILABLE',
      message: 'Publicerade avtal är tillfälligt otillgängliga.',
      databaseCode,
    }
  }

  return {
    status: 500,
    code: 'PUBLIC_CONTRACTS_TEMPORARILY_UNAVAILABLE',
    message: 'Publicerade avtal kunde inte hämtas.',
    databaseCode,
  }
}
