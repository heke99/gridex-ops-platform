'use strict'
/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { test } = require('node:test')
const { readSourceFamily } = require('./lib/read-source-family.cjs')

const root = path.resolve(__dirname, '..')
const childPath = path.join(__dirname, 'gridex-customer-application-continuation-regression.cjs')
const requireChild = createRequire(childPath)
const assertion = 'Ediel business outcomes enqueue lifecycle notifications behind the canonical inbound facade'
const files = {
  facade: 'lib/ediel/flows/inboundBusinessStateMachine.ts',
  legacy: 'lib/ediel/flows/inboundBusinessStateMachineLegacy.ts',
  adapter: 'lib/ediel/flows/inboundSwitchLifecycleAtomic.ts',
  schema: 'supabase/schema.sql',
  inbound: 'supabase/migrations/20261001000738_inbound_switch_lifecycle_required_intent_atomic.sql',
  lifecycle: 'supabase/migrations/20260930230204_customer_operation_lifecycle_intent_atomic.sql',
  worker: 'lib/customer-operations/automation.ts',
}

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, `mutation must match one actual source region: ${before}`)
  return source.replace(before, after)
}

// Execute the actual child gate. Only its read-only filesystem/process boundary
// is controlled; no application, DB, Auth, provider, SQL or native owner runs.
function runChild(changes = {}) {
  const source = fs.readFileSync(childPath, 'utf8')
  const overrides = new Map(Object.entries(changes).map(([key, value]) => [files[key], value]))
  const output = [], errors = []
  let status = 0
  const exit = { code: 0 }
  const controlledFs = {
    ...fs,
    readFileSync(file, encoding) {
      const relative = path.relative(root, file)
      if (overrides.has(relative)) return encoding ? overrides.get(relative) : Buffer.from(overrides.get(relative))
      return fs.readFileSync(file, encoding)
    },
  }
  const controlledRequire = (name) => name === 'fs' ? controlledFs
    : name === './lib/read-source-family.cjs' ? {
      readSourceFamily: (base, file) => overrides.has(file) ? overrides.get(file) : readSourceFamily(base, file),
    } : requireChild(name)
  try {
    new vm.Script(source, { filename: childPath }).runInNewContext({
      require: controlledRequire,
      process: { cwd: () => root, exit: (code) => { exit.code = code; throw exit } },
      console: { log: (message) => output.push(message), error: (message) => errors.push(message) },
    })
  } catch (error) {
    if (error !== exit) throw error
    status = exit.code
  }
  return { status, output, errors }
}

const actual = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, readSourceFamily(root, file)]))
const mutations = [
  ['facade import cannot point at another owner', 'facade', "from './inboundBusinessStateMachineLegacy'", "from './unrelatedOwner'"],
  ['facade must await the characterized owner', 'facade', 'const legacy = await applyLegacyInboundBusinessStateMachine(input)', 'const legacy = applyLegacyInboundBusinessStateMachine(input)'],
  ['characterized owner must import the real atomic adapter', 'legacy', "from './inboundSwitchLifecycleAtomic'", "from './unrelatedAtomicAdapter'"],
  ['characterized owner must await the atomic receipt', 'legacy', 'const receipt = await applyInboundSwitchLifecycleAtomically({', 'const receipt = applyInboundSwitchLifecycleAtomically({'],
  ['characterized owner must return the matched receipt', 'legacy', 'return receipt', 'return unrelatedReceipt'],
  ['accepted business outcome must reach the atomic owner', 'legacy', "if (outcome === 'supplier_switch_accepted'\n    || ((outcome === 'business_rejection'", "if (false\n    || ((outcome === 'business_rejection'"],
  ['an inverted atomic business branch cannot pass source qualification', 'legacy', "if (outcome === 'supplier_switch_accepted'\n    || ((outcome === 'business_rejection' || outcome === 'technical_rejection')\n      && await hasStoredInboundSupplierSwitchSource(input.message.id))) {", "if (!(outcome === 'supplier_switch_accepted'\n    || ((outcome === 'business_rejection' || outcome === 'technical_rejection')\n      && await hasStoredInboundSupplierSwitchSource(input.message.id)))) {"],
  ['atomic owner must receive the persisted input source ID', 'legacy', 'sourceMessageId: input.message.id,\n      actorUserId: input.actorUserId,', 'sourceMessageId: unrelatedSourceId,\n      actorUserId: input.actorUserId,'],
  ['atomic owner must receive the current actor', 'legacy', 'sourceMessageId: input.message.id,\n      actorUserId: input.actorUserId,', 'sourceMessageId: input.message.id,\n      actorUserId: unrelatedActor,'],
  ['adapter must call the canonical public RPC', 'adapter', "supabaseService.rpc('gridex_apply_inbound_switch_lifecycle_v1'", "supabaseService.rpc('unrelated_rpc'"],
  ['adapter must await the public RPC', 'adapter', "await supabaseService.rpc('gridex_apply_inbound_switch_lifecycle_v1'", "supabaseService.rpc('gridex_apply_inbound_switch_lifecycle_v1'"],
  ['public RPC must receive the same persisted source ID', 'adapter', 'p_source_message_id: input.sourceMessageId,', 'p_source_message_id: unrelatedSourceId,'],
  ['public RPC must receive the same current actor', 'adapter', 'p_actor_user_id: input.actorUserId,', 'p_actor_user_id: unrelatedActor,'],
  ['adapter must propagate a failed RPC', 'adapter', 'if (error) throw error\n  const result = Array.isArray(data)', 'if (error) return null\n  const result = Array.isArray(data)'],
  ['actual schema must bind the public RPC to its private owner', 'schema', 'select private.gridex_apply_inbound_switch_lifecycle_v1(p_source_message_id,p_actor_user_id);', 'select private.unrelated_inbound_owner(p_source_message_id,p_actor_user_id);'],
  ['inbound owner must call the required lifecycle owner', 'inbound', 'v_lifecycle:=private.gridex_record_customer_operation_event_v1(jsonb_build_object(', 'v_lifecycle:=private.unrelated_event_owner(jsonb_build_object('],
  ['ignored technical outcome must not receive a business notification', 'inbound', "if v_outcome<>'ignored' then\n  v_lifecycle:=", "if v_outcome='ignored' then\n  v_lifecycle:="],
  ['inbound owner must bind the derived notification template', 'inbound', "'notification_template',v_template", "'notification_template',null"],
  ['inbound owner cannot turn a required intent fault into ignored success', 'inbound', 'return v_result;\nend;', "return v_result;\nexception when others then return jsonb_build_object('outcome','ignored');\nend;"],
  ['accepted switch must map to its confirmation', 'inbound', "then 'switch.confirmed' else 'switch.action_required'", "then 'switch.started' else 'switch.action_required'"],
  ['rejected switch must map to action required', 'inbound', "then 'switch.confirmed' else 'switch.action_required'", "then 'switch.confirmed' else 'switch.started'"],
  ['lifecycle owner must independently derive accepted mapping', 'lifecycle', "when 'supplier_switch.accepted' then 'switch.confirmed'", "when 'supplier_switch.accepted' then 'switch.started'"],
  ['lifecycle owner must independently derive rejected mapping', 'lifecycle', "when 'supplier_switch.rejected' then 'switch.action_required'", "when 'supplier_switch.rejected' then 'switch.started'"],
  ['required intent must use the durable notification job type', 'lifecycle', "v_point,'dispatch_lifecycle_notification','queued',40,v_notification_key", "v_point,'unrelated_job','queued',40,v_notification_key"],
  ['required intent must be queued', 'lifecycle', "v_point,'dispatch_lifecycle_notification','queued',40,v_notification_key", "v_point,'dispatch_lifecycle_notification','failed',40,v_notification_key"],
  ['returned receipt must contain the stored notification job ID', 'lifecycle', "'notificationJobId',v_job_id", "'notificationJobId',null"],
  ['a commented-out insert cannot masquerade as required persistence', 'lifecycle', "insert into public.customer_operation_jobs(company_id,customer_id,customer_site_id,metering_point_id,job_type,status,priority,\n      idempotency_key,payload,request_snapshot,run_after)\n      values(v_company,v_customer,v_site,v_point,'dispatch_lifecycle_notification','queued',40,v_notification_key,\n        v_intent_payload,v_payload,clock_timestamp()) returning id into v_job_id;", "/* insert into public.customer_operation_jobs(company_id,customer_id,customer_site_id,metering_point_id,job_type,status,priority,\n      idempotency_key,payload,request_snapshot,run_after)\n      values(v_company,v_customer,v_site,v_point,'dispatch_lifecycle_notification','queued',40,v_notification_key,\n        v_intent_payload,v_payload,clock_timestamp()) returning id into v_job_id; */"],
  ['a required intent exception cannot be swallowed', 'lifecycle', "'eventKey',v_template,'replayed',v_replayed);\nend;", "'eventKey',v_template,'replayed',v_replayed);\nexception when others then return null;\nend;"],
  ['a fresh required notification job cannot be made optional', 'lifecycle', "insert into public.customer_operation_jobs(company_id,customer_id,customer_site_id,metering_point_id,job_type,status,priority,\n      idempotency_key,payload,request_snapshot,run_after)\n      values(v_company,v_customer,v_site,v_point,'dispatch_lifecycle_notification','queued',40,v_notification_key,\n        v_intent_payload,v_payload,clock_timestamp()) returning id into v_job_id;", "if false then insert into public.customer_operation_jobs(company_id,customer_id,customer_site_id,metering_point_id,job_type,status,priority,\n      idempotency_key,payload,request_snapshot,run_after)\n      values(v_company,v_customer,v_site,v_point,'dispatch_lifecycle_notification','queued',40,v_notification_key,\n        v_intent_payload,v_payload,clock_timestamp()) returning id into v_job_id; end if;"],
  ['worker must dispatch the canonical notification job case', 'worker', "case 'dispatch_lifecycle_notification': {", "case 'unrelated_notification': {"],
  ['worker must await its notification dispatcher', 'worker', 'const dispatched = await notifyCustomerForLifecycleEvent({', 'const dispatched = notifyCustomerForLifecycleEvent({'],
  ['worker must import the canonical notification dispatcher', 'worker', "await import('@/lib/customer-notifications/notificationOrchestrator')", "await import('@/lib/unrelatedNotificationDispatcher')"],
  ['worker must dispatch within the stored job company', 'worker', 'companyId: job.company_id,\n        customerId: job.customer_id,\n        eventType,', 'companyId: unrelatedCompany,\n        customerId: job.customer_id,\n        eventType,'],
]

test('the actual current canonical SQL-owned chain satisfies the unchanged business assertion', () => {
  const result = runChild()
  assert.equal(result.status, 0, result.errors.join('\n'))
  assert.ok(result.output.includes(`OK: ${assertion}`))
})

test('formatting and comments preserve the actual dependency chain', () => {
  const result = runChild({
    adapter: replaceOnce(actual.adapter, "supabaseService.rpc('gridex_apply_inbound_switch_lifecycle_v1'", 'supabaseService.rpc(/* formatting */ "gridex_apply_inbound_switch_lifecycle_v1"'),
    inbound: replaceOnce(actual.inbound, 'v_lifecycle:=private.gridex_record_customer_operation_event_v1(', 'v_lifecycle := /* formatting */ private.gridex_record_customer_operation_event_v1('),
  })
  assert.equal(result.status, 0, result.errors.join('\n'))
  assert.ok(result.output.includes(`OK: ${assertion}`))
})

for (const [name, key, before, after] of mutations) {
  test(name, () => {
    const changes = { [key]: replaceOnce(actual[key], before, after) }
    // The obsolete direct enqueue name in a comment must not rescue any broken
    // actual dependency; the historical substring predicate accepted this bait.
    changes.legacy = (changes.legacy ?? actual.legacy) + '\n// enqueueCustomerLifecycleNotification\n'
    const result = runChild(changes)
    assert.equal(result.status, 1)
    assert.ok(result.errors.includes(`FAIL: ${assertion}`), result.errors.join('\n'))
  })
}
