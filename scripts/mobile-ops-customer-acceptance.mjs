import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const customers = JSON.parse(await readFile(process.argv[2], 'utf8'))
assert.equal(customers.length, 2)
const resources = ['contracts', 'sites', 'invoices']
const origin = 'http://127.0.0.1:3100/api/mobile/customer'

async function read(path, token) {
  const response = await fetch(origin + path, {
    headers: { authorization: 'Bearer ' + token },
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  })
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  return { status: response.status, body: await response.json() }
}

assert.notEqual(customers[0].accessToken, customers[1].accessToken)
for (const resource of resources) {
  const expected = customers.map(customer => customer.references[resource])
  assert.ok(expected.every(ref => typeof ref === 'string' && ref.length > 0))
  assert.notEqual(...expected)
  for (const [index, customer] of customers.entries()) {
    const { status, body } = await read('/' + resource, customer.accessToken)
    assert.equal(status, 200, resource + ': customer ' + (index + 1))
    assert.deepEqual(body.data[resource].map(row => row.reference), [expected[index]])
  }
}
for (const [index, customer] of customers.entries()) {
  const ownPath = '/invoices/' + encodeURIComponent(customer.references.invoices)
  assert.equal((await read(ownPath, customer.accessToken)).status, 200)
  const other = customers[1 - index].references.invoices
  const denied = await read('/invoices/' + encodeURIComponent(other), customer.accessToken)
  assert.ok([403, 404].includes(denied.status), 'foreign invoice must be denied')
  assert.ok(!('data' in denied.body))
}
console.log('Both authenticated customers received only their own OPS records')
