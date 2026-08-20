import http from 'k6/http'
import { check, group, sleep } from 'k6'
import { Rate, Trend } from 'k6/metrics'

const baseUrl = String(__ENV.GRIDEX_E2E_BASE_URL || '').replace(/\/$/, '')
if (!baseUrl) throw new Error('GRIDEX_E2E_BASE_URL is required.')

const bearer = String(__ENV.GRIDEX_E2E_K6_BEARER_TOKEN || '').trim()
if (!bearer) {
  throw new Error('GRIDEX_E2E_K6_BEARER_TOKEN is required for the contract feed profile.')
}

const route = String(
  __ENV.GRIDEX_E2E_K6_PUBLIC_CONTRACT_ROUTE ||
    '/api/v1/website/public-contracts?customer_type=business',
).trim()
if (!route.startsWith('/')) {
  throw new Error('GRIDEX_E2E_K6_PUBLIC_CONTRACT_ROUTE must be relative.')
}

const fullFeedDuration = new Trend('contract_feed_full_duration', true)
const notModifiedDuration = new Trend(
  'contract_feed_not_modified_duration',
  true,
)
const conditionalMiss = new Rate('contract_feed_conditional_miss')

export const options = {
  scenarios: {
    public_contract_cache: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '20s', target: 5 },
        { duration: '40s', target: 15 },
        { duration: '1m', target: 25 },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.005'],
    checks: ['rate>0.995'],
    contract_feed_full_duration: ['p(95)<1500', 'p(99)<3000'],
    contract_feed_not_modified_duration: ['p(95)<750', 'p(99)<1500'],
    contract_feed_conditional_miss: ['rate<0.005'],
  },
  userAgent: 'Gridex-E2E-k6-public-contract-cache/1.0',
}

export default function () {
  group('public contract feed conditional read', () => {
    const authorization = { Authorization: `Bearer ${bearer}` }
    const fullResponse = http.get(`${baseUrl}${route}`, {
      headers: authorization,
      tags: { route, phase: 'full_feed' },
    })
    fullFeedDuration.add(fullResponse.timings.duration)

    const etag = fullResponse.headers.ETag || fullResponse.headers.Etag
    const fullFeedOk = check(fullResponse, {
      'contract feed returns 200': (response) => response.status === 200,
      'contract feed returns an ETag': () => Boolean(etag),
    })
    if (!fullFeedOk || !etag) {
      conditionalMiss.add(true)
      return
    }

    const conditionalResponse = http.get(`${baseUrl}${route}`, {
      headers: {
        ...authorization,
        'If-None-Match': etag,
      },
      tags: { route, phase: 'conditional_304' },
    })
    notModifiedDuration.add(conditionalResponse.timings.duration)
    const isNotModified = check(conditionalResponse, {
      'matching ETag returns 304': (response) => response.status === 304,
      '304 response has an empty body': (response) => response.body.length === 0,
    })
    conditionalMiss.add(!isNotModified)
  })

  sleep(Number(__ENV.GRIDEX_E2E_K6_SLEEP_SECONDS || '0.25'))
}
