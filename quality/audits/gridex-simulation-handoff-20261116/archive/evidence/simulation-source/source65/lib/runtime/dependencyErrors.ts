export type DependencyErrorCode = 'dependency_unavailable' | 'dependency_timeout' | 'dependency_bad_gateway'

export class DependencyError extends Error {
  readonly code: DependencyErrorCode
  readonly status = 503
  readonly retryable = true

  constructor(code: DependencyErrorCode, message = 'En extern tjänst är tillfälligt otillgänglig.') {
    super(message)
    this.name = 'DependencyError'
    this.code = code
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message} ${(error as NodeJS.ErrnoException).code ?? ''}`
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>
    return `${String(value.code ?? '')} ${String(value.message ?? '')} ${String(value.status ?? '')}`
  }
  return String(error ?? '')
}

export function classifyDependencyError(error: unknown): DependencyError | null {
  if (error instanceof DependencyError) return error
  const text = errorText(error)
  if (/522|ETIMEDOUT|timed?\s*out|AbortError/i.test(text)) return new DependencyError('dependency_timeout')
  if (/502|504|bad gateway|gateway timeout/i.test(text)) return new DependencyError('dependency_bad_gateway')
  if (/503|ECONNRESET|connection reset|fetch failed|network|unexpected.*html|content[- ]type/i.test(text)) {
    return new DependencyError('dependency_unavailable')
  }
  return null
}

export function assertJsonResponse(response: Pick<Response, 'ok' | 'status' | 'headers'>): void {
  if (!response.ok) {
    const code = response.status === 502 || response.status === 504
      ? 'dependency_bad_gateway'
      : response.status === 522
        ? 'dependency_timeout'
        : 'dependency_unavailable'
    throw new DependencyError(code)
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('application/json') && !contentType.includes('+json')) {
    throw new DependencyError('dependency_unavailable')
  }
}
