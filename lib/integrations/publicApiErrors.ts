import {
  PUBLIC_CONTRACT_ERROR_CODES,
  PublicContractSerializationError,
  type PublicContractErrorCode,
} from '@/lib/external-contracts/publicContractModel'
import { ExternalTenantContextError } from '@/lib/integrations/tenantContext'

type ErrorRecord = {
  code?: unknown
  message?: unknown
  details?: unknown
  hint?: unknown
  path?: unknown
}

type PublicContractFailureCode =
  | PublicContractErrorCode
  | 'TENANT_NOT_FOUND'
  | 'EXTERNAL_TENANT_REFERENCE_MISSING'
  | 'TENANT_NOT_OPERATIONALLY_READY'
  | 'PUBLICATION_GRAPH_INCOMPLETE'
  | 'PUBLIC_CONTRACT_FEED_INCONSISTENT'
  | 'PUBLIC_CONTRACT_SCHEMA_OUTDATED'
  | 'PUBLIC_CONTRACTS_TEMPORARILY_UNAVAILABLE'

export type PublicApiErrorClassification = {
  status: number
  code: PublicContractFailureCode
  message: string
  databaseCode: string | null
  path: string | null
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
      path: null,
    }
  }

  if (error instanceof PublicContractSerializationError) {
    const infrastructureFailure = new Set<PublicContractErrorCode>([
      PUBLIC_CONTRACT_ERROR_CODES.contractVersionMismatch,
      PUBLIC_CONTRACT_ERROR_CODES.openApiChecksumMismatch,
    ]).has(error.code)
    return {
      status: infrastructureFailure ? 503 : 409,
      code: error.code,
      message: infrastructureFailure
        ? 'Public contracts-kontraktets version eller schemaevidens är inkonsekvent.'
        : 'Publiceringssnapshoten är ofullständig eller inkonsekvent och exponeras inte.',
      databaseCode: null,
      path: error.path,
    }
  }

  const record = errorRecord(error)
  const errorPath = typeof record.path === 'string' ? record.path : null
  if (record.code === 'PUBLIC_CONTRACT_FEED_INCONSISTENT') {
    return {
      status: 503,
      code: 'PUBLIC_CONTRACT_FEED_INCONSISTENT',
      message:
        'Det kanoniska avtalsflödet är tillfälligt inkonsekvent. Ingen partiell lista returneras.',
      databaseCode: null,
      path: errorPath,
    }
  }
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
      path: errorPath,
    }
  }

  for (const code of Object.values(PUBLIC_CONTRACT_ERROR_CODES)) {
    if (technical.includes(code)) {
      return {
        status:
          code === PUBLIC_CONTRACT_ERROR_CODES.contractVersionMismatch ||
          code === PUBLIC_CONTRACT_ERROR_CODES.openApiChecksumMismatch
            ? 503
            : 409,
        code,
        message: 'Publiceringssnapshoten är ofullständig eller inkonsekvent och exponeras inte.',
        databaseCode,
        path: errorPath,
      }
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
      path: errorPath,
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
      path: errorPath,
    }
  }

  return {
    status: 500,
    code: 'PUBLIC_CONTRACTS_TEMPORARILY_UNAVAILABLE',
    message: 'Publicerade avtal kunde inte hämtas.',
    databaseCode,
    path: errorPath,
  }
}
