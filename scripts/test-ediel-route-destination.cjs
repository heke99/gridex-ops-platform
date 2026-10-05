const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const routeContract = fs.readFileSync('lib/ediel/outbox/routeContract.ts', 'utf8')
const sendOutbox = fs.readFileSync('lib/ediel/outbox/sendOutboxItem.ts', 'utf8')

test('route contract requires configured SMTP destination', () => {
  assert.match(routeContract, /route_receiver_email_missing/)
  assert.match(routeContract, /message_receiver_email_missing/)
  assert.match(routeContract, /route_receiver_email_mismatch/)
})

test('route fingerprint binds normalized SMTP destination', () => {
  assert.match(routeContract, /smtp:\$\{encodeURIComponent\(receiverEmail\.toLowerCase\(\)\)\}/)
  assert.match(routeContract, /smtp_destination/)
})

test('outbox snapshot persists reviewed SMTP destination', () => {
  assert.match(sendOutbox, /receiver_email: routeContract\.receiverEmail/)
})
