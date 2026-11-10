import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const fixture = JSON.parse(await readFile(process.argv[2], 'utf8'))
const { customers, unlinked, secrets } = fixture
assert.equal(customers.length, 2)
const resources = ['contracts', 'sites', 'invoices']
const origin = 'http://127.0.0.1:3100/api/mobile/customer'
const results = []
async function read(path, token) {
  const response = await fetch(origin + path, {
    headers: token ? { authorization: 'Bearer ' + token } : {},
    redirect: 'error', signal: AbortSignal.timeout(60000),
  })
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  const text = await response.text()
  assert.ok(secrets.every(secret => !text.includes(secret)), 'response must not contain credentials')
  return { status: response.status, body: JSON.parse(text) }
}
function denied(response, statuses) {
  assert.ok(statuses.includes(response.status), 'unexpected denial status: ' + response.status)
  assert.deepEqual(Object.keys(response.body), ['error'])
  const text = JSON.stringify(response.body)
  for (const customer of customers) {
    for (const value of [...Object.values(customer.references), customer.number]) assert.ok(!text.includes(value), 'denial leaked customer data')
  }
}
if (process.argv.includes('--outage')) {
  for (const customer of customers) for (const resource of resources) denied(await read('/' + resource, customer.accessToken), [503])
  console.log('PASS controlled OPS outage: sanitized 503 and private/no-store for both customers')
} else {
  assert.notEqual(customers[0].accessToken, customers[1].accessToken)
  for (const resource of resources) {
    const expected = customers.map(customer => customer.references[resource])
    assert.ok(expected.every(ref => typeof ref === 'string' && ref.length > 0))
    assert.notEqual(...expected)
    // A -> B -> A catches both response-cache and singleton identity reuse.
    for (const index of [0, 1, 0]) {
      const customer = customers[index]
      const { status, body } = await read('/' + resource, customer.accessToken)
      assert.equal(status, 200, resource + ': customer ' + customer.label)
      assert.deepEqual(body.data[resource].map(row => row.reference), [expected[index]])
      results.push({ scenario: customer.label + ':' + resource, status: 'PASS' })
    }
  }
  for (const [index, customer] of customers.entries()) {
    const own = await read('/invoices/' + encodeURIComponent(customer.references.invoices), customer.accessToken)
    assert.equal(own.status, 200)
    assert.equal(own.body.data.invoiceDetail[0].reference, customer.references.invoices)
    assert.equal(own.body.data.invoiceDetail[0].amount, customer.label === 'A' ? 111 : 222)
    denied(await read('/invoices/' + encodeURIComponent(customers[1-index].references.invoices), customer.accessToken), [403, 404])
    for (const resource of resources) denied(await read('/' + resource + '?customerId=' + customers[1-index].number, customer.accessToken), [400])
    results.push({ scenario: customer.label + ':own-and-foreign-invoice', status: 'PASS' })
  }
  for (const path of [...resources.map(r => '/' + r), '/invoices/' + customers[0].references.invoices]) {
    denied(await read(path, unlinked.accessToken), [403, 404, 503])
    denied(await read(path), [401])
    denied(await read(path, 'invalid-session-token-1234567890'), [401])
  }
  results.push({ scenario: 'unlinked-invalid-missing-session-and-override', status: 'PASS' })
  if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify({ opsCommit: process.env.GITHUB_SHA ?? null, webCommit: process.env.GRIDEX_WEB_COMMIT ?? null, results }, null, 2))
  console.log('PASS both authenticated customers: exact own OPS records, foreign invoice denial, unlinked/invalid/missing session and override rejection')
}
