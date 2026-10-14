export type ProjectionMeta = {
  definitionVersion: string
  asOf: string
  sourceVersion: string | null
  buildVersion: string | null
  freshness: 'current' | 'stale' | 'unknown'
}

export type ReadResult<T> =
  | { kind: 'ready'; data: T; coverage: 'complete'; meta: ProjectionMeta }
  | { kind: 'partial'; data: T; coverage: 'partial'; reasonCodes: string[]; meta: ProjectionMeta }
  | { kind: 'unavailable'; errorCode: string; traceId: string }

export class InvalidReadModelResponseError extends Error {
  constructor() {
    super('READ_MODEL_INVALID_RESPONSE')
    this.name = 'InvalidReadModelResponseError'
  }
}

/** Call only after authority has been checked; this models data availability, not access. */
export async function readResult<T>(
  load: () => Promise<T>,
  options: { definitionVersion: string; errorCode: string },
): Promise<ReadResult<T>> {
  try {
    const data = await load()
    return {
      kind: 'ready', data, coverage: 'complete',
      meta: {
        definitionVersion: options.definitionVersion,
        asOf: new Date().toISOString(),
        sourceVersion: null,
        buildVersion: null,
        freshness: 'unknown',
      },
    }
  } catch (error) {
    const failure = {
      kind: 'unavailable' as const,
      errorCode: error instanceof InvalidReadModelResponseError ? 'READ_MODEL_INVALID_RESPONSE' : options.errorCode,
      traceId: crypto.randomUUID(),
    }
    // Neither transport messages nor database details are safe public diagnostics.
    console.warn('[read-model:unavailable]', { definitionVersion: options.definitionVersion, ...failure })
    return failure
  }
}
