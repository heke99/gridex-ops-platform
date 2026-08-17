import { safeReadIteration } from './read-helpers.js'

export const options = {
  scenarios: {
    platform_load: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 5 },
        { duration: '1m', target: 15 },
        { duration: '2m', target: 25 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.005'],
    http_req_duration: ['p(95)<1500', 'p(99)<3000'],
    checks: ['rate>0.995'],
  },
  userAgent: 'Gridex-E2E-k6-load/1.0',
}

export default function () {
  safeReadIteration('platform load safe reads')
}
