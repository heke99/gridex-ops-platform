import http from 'k6/http'
import { check, group, sleep } from 'k6'

export const baseUrl = String(__ENV.GRIDEX_E2E_BASE_URL || '').replace(/\/$/, '')
if (!baseUrl) throw new Error('GRIDEX_E2E_BASE_URL is required.')

const configuredRoutes = String(__ENV.GRIDEX_E2E_K6_READ_ROUTES || '').split(',').map((value) => value.trim()).filter(Boolean)
export const readRoutes = configuredRoutes.length > 0
  ? configuredRoutes
  : ['/', '/login', '/developers/customer-portal-api']

const bearer = String(__ENV.GRIDEX_E2E_K6_BEARER_TOKEN || '').trim()
const headers = bearer ? { Authorization: `Bearer ${bearer}` } : {}

export function safeReadIteration(label = 'safe application reads') {
  group(label, () => {
    for (const route of readRoutes) {
      if (!route.startsWith('/')) throw new Error(`k6 safe read route must be relative: ${route}`)
      const response = http.get(`${baseUrl}${route}`, {
        headers,
        tags: { route },
        redirects: 5,
      })
      check(response, {
        [`${route} returns non-error HTTP`]: (res) => res.status >= 200 && res.status < 400,
      })
    }
  })
  sleep(Number(__ENV.GRIDEX_E2E_K6_SLEEP_SECONDS || '0.25'))
}
