import http from 'k6/http'
import { check, group, sleep } from 'k6'

const baseUrl = String(__ENV.GRIDEX_E2E_BASE_URL || '').replace(/\/$/, '')
if (!baseUrl) {
  throw new Error('GRIDEX_E2E_BASE_URL is required for the k6 staging smoke test.')
}

const vus = Math.max(1, Number.parseInt(__ENV.GRIDEX_E2E_K6_VUS || '5', 10) || 5)
const duration = __ENV.GRIDEX_E2E_K6_DURATION || '30s'

export const options = {
  scenarios: {
    public_read_smoke: {
      executor: 'constant-vus',
      vus,
      duration,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500', 'p(99)<3000'],
    checks: ['rate>0.99'],
  },
  userAgent: 'Gridex-E2E-k6/1.0',
}

const publicRoutes = ['/', '/login', '/developers/customer-portal-api']

export default function () {
  group('public application reads', () => {
    for (const route of publicRoutes) {
      const response = http.get(`${baseUrl}${route}`, {
        tags: { route },
      })
      check(response, {
        [`${route} returns 2xx/3xx`]: (res) => res.status >= 200 && res.status < 400,
      })
    }
  })

  sleep(1)
}
