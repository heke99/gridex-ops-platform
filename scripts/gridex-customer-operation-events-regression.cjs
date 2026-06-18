/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const eventWriter = read('lib/customers/customerOperationEvents.ts')
const migration = read('supabase/migrations/20260618193000_customer_operation_events_timeline.sql')
const automation = read('lib/customer-operations/automation.ts')
const eventsPage = read('app/admin/events/page.tsx')
const navigation = read('lib/admin/navigation.ts')
const customerActions = read('app/admin/customers/[id]/actions.ts')
const workQueue = read('app/admin/work-queue/page.tsx')

assert(!/\.from\(['"]customer_events['"]\)/.test(eventWriter), 'Operational events must not write to customer_events.')
assert(/from\(['"]customer_operation_events['"]\)/.test(eventWriter), 'Operational events must write to customer_operation_events.')
assert(/create table if not exists public\.customer_operation_events/.test(migration), 'Migration must create customer_operation_events.')
assert(/operation_id uuid/.test(migration), 'Migration must introduce operation_id correlation.')
assert(/gridex_list_customer_operation_events/.test(migration), 'Migration must expose the tenant event feed RPC.')
assert(/operationId/.test(automation) && /linkOperationResources/.test(automation), 'Automation must propagate operation_id to linked resources.')
assert(/listCustomerOperationTimeline/.test(eventsPage) && /eventGroup: params\.group/.test(eventsPage), 'Events page must use the filtered timeline read model.')
assert(/href: '\/admin\/events'/.test(navigation), 'Admin navigation must expose the events page.')
assert(/CustomerOperationActionState/.test(customerActions) && /status: "started"/.test(customerActions), 'Customer actions must return structured UI states.')
assert(/loadOperationEventActions/.test(workQueue) && /loadOperationJobActions/.test(workQueue), 'Work queue must read automation events and jobs.')

console.log('gridex customer operation events regression: passed')
