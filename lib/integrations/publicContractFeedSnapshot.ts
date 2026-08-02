import { createHash } from 'node:crypto'

export type VerifiedPublicContractFeedSnapshot = {
  tenantReference: string
  contractSchemaVersion: string
  contracts: Record<string, unknown>[]
  etag: string | null
  fingerprintSha256: string
  publicationRevision: number
  verifiedAt: string
  feedState: 'contracts_present' | 'canonical_empty'
  emptyFeedAuthorization: {
    authorized: true
    reason:
      | 'no_canonical_publications'
      | 'canonical_unpublished_or_archived'
      | 'publication_validity_ended'
      | 'canonical_no_visible_contracts'
    publicationRevision: number
    canonicalSource: 'canonical_public_contract_delivery_readiness_v'
    affectedOfferReferences: string[]
    blockers: string[]
  } | null
}

export type PublicContractFeedFailure = {
  occurredAt: string
  code: string
  message: string
  httpStatus: number | null
  requestId: string | null
  correlationId: string | null
}

export interface PublicContractFeedSnapshotStore {
  load(): Promise<VerifiedPublicContractFeedSnapshot | null>
  save(snapshot: VerifiedPublicContractFeedSnapshot): Promise<void>
  recordFailure(failure: PublicContractFeedFailure): Promise<void>
}

export type PublicContractFeedRefreshResult = {
  snapshot: VerifiedPublicContractFeedSnapshot
  source: 'fresh' | 'not_modified' | 'last_known_good'
  degraded: boolean
  failure: PublicContractFeedFailure | null
}

export class PublicContractFeedRefreshError extends Error {
  readonly code: string
  readonly httpStatus: number | null

  constructor(code: string, message: string, httpStatus: number | null = null) {
    super(message)
    this.name = 'PublicContractFeedRefreshError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(source)
      .sort()
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, canonicalize(source[key])]),
  )
}

function fingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')
}

function validateSuccessfulFeed(input: {
  payload: unknown
  expectedTenantReference: string
  expectedSchemaVersion: string
  etag: string | null
  now: string
}): VerifiedPublicContractFeedSnapshot {
  const payload = object(input.payload)
  const meta = object(payload?.meta)
  if (!payload || !meta || !Array.isArray(payload.data)) {
    throw new PublicContractFeedRefreshError(
      'PUBLIC_CONTRACT_RESPONSE_INVALID',
      'The public-contract response does not match the canonical envelope.',
    )
  }
  const tenantReference = text(meta.tenant_reference)
  if (tenantReference !== input.expectedTenantReference) {
    throw new PublicContractFeedRefreshError(
      'PUBLIC_CONTRACT_TENANT_MISMATCH',
      'The public-contract response belongs to another tenant.',
    )
  }
  const contractSchemaVersion = text(meta.contract_schema_version)
  if (contractSchemaVersion !== input.expectedSchemaVersion) {
    throw new PublicContractFeedRefreshError(
      'PUBLIC_CONTRACT_SCHEMA_MISMATCH',
      'The public-contract response uses an unexpected schema version.',
    )
  }
  const count = Number(meta.count)
  if (!Number.isInteger(count) || count !== payload.data.length) {
    throw new PublicContractFeedRefreshError(
      'PUBLIC_CONTRACT_COUNT_MISMATCH',
      'The public-contract response count is inconsistent.',
    )
  }
  const contracts = payload.data.map((item, index) => {
    const contract = object(item)
    if (!contract || !text(contract.offer_reference)) {
      throw new PublicContractFeedRefreshError(
        'PUBLIC_CONTRACT_SCHEMA_INVALID',
        `Contract at index ${index} is missing offer_reference.`,
      )
    }
    return contract
  })
  const references = contracts.map((contract) => text(contract.offer_reference) as string)
  if (new Set(references).size !== references.length) {
    throw new PublicContractFeedRefreshError(
      'PUBLIC_CONTRACT_DUPLICATE_REFERENCE',
      'The public-contract response contains duplicate offer references.',
    )
  }

  const feedState = meta.feed_state
  const authorization = object(meta.empty_feed_authorization)
  let emptyFeedAuthorization: VerifiedPublicContractFeedSnapshot['emptyFeedAuthorization'] = null
  if (contracts.length === 0) {
    if (
      feedState !== 'canonical_empty' ||
      authorization?.authorized !== true ||
      ![
        'no_canonical_publications',
        'canonical_unpublished_or_archived',
        'publication_validity_ended',
        'canonical_no_visible_contracts',
      ].includes(String(authorization.reason)) ||
      authorization.canonical_source !== 'canonical_public_contract_delivery_readiness_v' ||
      !Array.isArray(authorization.affected_offer_references) ||
      !Array.isArray(authorization.blockers) ||
      !Number.isInteger(Number(authorization.publication_revision))
    ) {
      throw new PublicContractFeedRefreshError(
        'UNVERIFIED_EMPTY_PUBLIC_CONTRACT_FEED',
        'An empty response may not replace the verified snapshot without canonical authorization.',
      )
    }
    emptyFeedAuthorization = {
      authorized: true,
      reason: String(authorization.reason) as NonNullable<
        VerifiedPublicContractFeedSnapshot['emptyFeedAuthorization']
      >['reason'],
      publicationRevision: Number(authorization.publication_revision),
      canonicalSource: 'canonical_public_contract_delivery_readiness_v',
      affectedOfferReferences: authorization.affected_offer_references
        .map(text)
        .filter((value): value is string => Boolean(value)),
      blockers: authorization.blockers
        .map(text)
        .filter((value): value is string => Boolean(value)),
    }
  } else if (feedState !== 'contracts_present' || authorization !== null) {
    throw new PublicContractFeedRefreshError(
      'PUBLIC_CONTRACT_FEED_STATE_INVALID',
      'The feed-state metadata is inconsistent with the returned contracts.',
    )
  }

  const publicationRevision = Number(meta.publication_revision)
  if (!Number.isInteger(publicationRevision) || publicationRevision < 0) {
    throw new PublicContractFeedRefreshError(
      'PUBLIC_CONTRACT_REVISION_INVALID',
      'The publication revision is invalid.',
    )
  }

  return {
    tenantReference,
    contractSchemaVersion,
    contracts,
    etag: input.etag,
    fingerprintSha256: fingerprint({
      tenant_reference: tenantReference,
      contract_schema_version: contractSchemaVersion,
      contracts,
      feed_state: feedState,
      empty_feed_authorization: emptyFeedAuthorization,
    }),
    publicationRevision,
    verifiedAt: input.now,
    feedState: feedState as 'contracts_present' | 'canonical_empty',
    emptyFeedAuthorization,
  }
}

function failureFrom(error: unknown, response?: Response | null): PublicContractFeedFailure {
  const refreshError =
    error instanceof PublicContractFeedRefreshError ? error : null
  return {
    occurredAt: new Date().toISOString(),
    code: refreshError?.code ?? 'PUBLIC_CONTRACT_REFRESH_FAILED',
    message: error instanceof Error ? error.message : String(error),
    httpStatus: refreshError?.httpStatus ?? response?.status ?? null,
    requestId: response?.headers.get('x-request-id') ?? null,
    correlationId: response?.headers.get('x-correlation-id') ?? null,
  }
}

/**
 * Server-side tenant integration helper. It never overwrites a verified
 * snapshot after transport, HTTP, JSON, schema or mapping failures. The store
 * must be durable (database/object storage), not process memory.
 */
export async function refreshPublicContractFeed(input: {
  endpoint: string
  apiKey: string
  expectedTenantReference: string
  expectedSchemaVersion: string
  store: PublicContractFeedSnapshotStore
  fetchImpl?: typeof fetch
  now?: () => Date
  timeoutMs?: number
}): Promise<PublicContractFeedRefreshResult> {
  const existing = await input.store.load()
  const fetchImpl = input.fetchImpl ?? fetch
  let response: Response | null = null
  const timeoutMs = Math.max(1_000, Math.min(input.timeoutMs ?? 15_000, 120_000))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    response = await fetchImpl(input.endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        Accept: 'application/json',
        ...(existing?.etag ? { 'If-None-Match': existing.etag } : {}),
      },
      cache: 'no-store',
      signal: controller.signal,
    })
    if (response.status === 304) {
      if (!existing) {
        throw new PublicContractFeedRefreshError(
          'PUBLIC_CONTRACT_304_WITHOUT_SNAPSHOT',
          'The server returned 304 but no verified snapshot exists.',
          304,
        )
      }
      return {
        snapshot: existing,
        source: 'not_modified',
        degraded: false,
        failure: null,
      }
    }
    if (!response.ok) {
      throw new PublicContractFeedRefreshError(
        'PUBLIC_CONTRACT_HTTP_FAILURE',
        `Public-contract request failed with HTTP ${response.status}.`,
        response.status,
      )
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new PublicContractFeedRefreshError(
        'PUBLIC_CONTRACT_JSON_INVALID',
        'The public-contract response is not valid JSON.',
        response.status,
      )
    }
    const snapshot = validateSuccessfulFeed({
      payload,
      expectedTenantReference: input.expectedTenantReference,
      expectedSchemaVersion: input.expectedSchemaVersion,
      etag: response.headers.get('etag'),
      now: (input.now?.() ?? new Date()).toISOString(),
    })
    await input.store.save(snapshot)
    return {
      snapshot,
      source: 'fresh',
      degraded: false,
      failure: null,
    }
  } catch (error) {
    const normalizedError =
      controller.signal.aborted && !(error instanceof PublicContractFeedRefreshError)
        ? new PublicContractFeedRefreshError(
            'PUBLIC_CONTRACT_TIMEOUT',
            `Public-contract request exceeded ${timeoutMs} ms.`,
          )
        : error
    const failure = failureFrom(normalizedError, response)
    await input.store.recordFailure(failure).catch(() => undefined)
    if (existing) {
      return {
        snapshot: existing,
        source: 'last_known_good',
        degraded: true,
        failure,
      }
    }
    throw normalizedError
  } finally {
    clearTimeout(timeout)
  }
}
