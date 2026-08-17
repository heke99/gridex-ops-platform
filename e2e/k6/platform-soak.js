import { safeReadIteration } from './read-helpers.js'

const duration = __ENV.GRIDEX_E2E_K6_SOAK_DURATION || '15m'
const vus = Math.max(1, Number.parseInt(__ENV.GRIDEX_E2E_K6_SOAK_VUS || '10', 10) || 10)

export const options = {
  scenarios: {
    platform_soak: {
      executor: 'constant-vus',
      vus,
      duration,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.005'],
    http_req_duration: ['p(95)<1500', 'p(99)<3000'],
    checks: ['rate>0.995'],
  },
  userAgent: 'Gridex-E2E-k6-soak/1.0',
}

export default function () {
  safeReadIteration('platform soak safe reads')
}
