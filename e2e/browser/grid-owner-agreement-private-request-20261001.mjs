/**
 * Playwright request failures include URLs, headers and response context.
 * Keep the operation failing without retaining or inspecting private errors.
 * @template T
 * @param {() => Promise<T>} operation
 * @returns {Promise<T>}
 */
export async function agreementPrivateRequest(operation) {
  try {
    return await operation()
  } catch {
    throw new Error('agreement_runtime_private_request_failed')
  }
}
