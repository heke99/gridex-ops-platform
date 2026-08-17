import { safeReadIteration } from './read-helpers.js'

export const options = {
  scenarios: {
    platform_spike: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '15s', target: 5 },
        { duration: '15s', target: 50 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000', 'p(99)<4000'],
    checks: ['rate>0.99'],
  },
  userAgent: 'Gridex-E2E-k6-spike/1.0',
}

export default function () {
  safeReadIteration('platform spike safe reads')
}
