/**
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} url
 * @param {Parameters<import('@playwright/test').APIRequestContext['get']>[1]} [options]
 */
export async function eventV2SafeGet(request, url, options) {
  try {
    return await request.get(url, options)
  } catch {
    // Playwright transport errors retain all request headers in their call log.
    // Never attach the original message, stack, properties or cause to evidence.
    throw new Error('event_v2_http_transport_failed')
  }
}
