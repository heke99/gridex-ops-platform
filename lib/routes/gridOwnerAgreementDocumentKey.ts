// Matches the existing upload's UUID/platform/owner folders and safeFileName.
// Never pass URL-normalized or encoded object identities to the Storage client.
export function isGridOwnerAgreementBucket(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value) && value !== '.' && value !== '..'
}

export function parseGridOwnerAgreementDocumentKey(
  value: string | null,
  agreementBucket: string,
): { bucket: string; path: string } | null {
  if (!value) return null
  const separator = value.indexOf(':')
  const bucket = separator > 0 ? value.slice(0, separator) : agreementBucket
  const path = separator > 0 ? value.slice(separator + 1) : value
  if (!isGridOwnerAgreementBucket(bucket)) return null
  const segments = path.split('/')
  if (segments.some(segment => !/^[A-Za-z0-9._-]+$/.test(segment) || segment === '.' || segment === '..')) return null
  return { bucket, path }
}
