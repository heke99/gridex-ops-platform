/** Only the receipt reader's explicit link verdicts establish an unusable link. */
export function isRejectedSignatureLink(error: unknown): boolean {
  if (error instanceof Error && error.message === 'online_signature_token_invalid') return true
  if (!error || typeof error !== 'object') return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  return (code === 'P0002' && message === 'signature_link_not_found')
    || (code === '55000' && (message === 'signature_link_expired' || message === 'signature_link_revoked'))
}
