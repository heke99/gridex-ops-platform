/* eslint-disable @typescript-eslint/no-require-imports */
// Regression: the tenant customer card shows the simplified Swedish business
// timeline (wired buildTenantCustomerCardView) while superadmin keeps the full
// technical step chain; status cards never imply completeness without a
// metering point; tenant registries hide test/dirty customers by default.
const fs = require('fs')

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

const failures = []
function mustInclude(file, needle, why) {
  if (!read(file).includes(needle)) failures.push(`Missing "${needle}" in ${file} (${why})`)
}

const card = 'components/admin/customers/CustomerBusinessActionsCard.tsx'
const tenantView = 'lib/customer-operations/customerCardTenantView.ts'
const registry = 'lib/customer-operations/customerActionRegistry.ts'
const customersLib = 'lib/customers/getCustomers.ts'
const customersPage = 'app/admin/customers/page.tsx'

// Tenant timeline wired: tenants get the six-step business view, superadmin
// keeps the technical chain. Both read the same workflow/snapshot source.
mustInclude(card, 'buildTenantCustomerCardView', 'simplified tenant view is wired into the card')
mustInclude(card, 'const timelineSteps: CustomerWorkflowStep[] = isPlatformAdmin', 'timeline branches on role')
mustInclude(card, 'steps={timelineSteps}', 'timeline renders role-appropriate steps')

// Tenant view model carries Swedish explanations and truthful facility states.
mustInclude(tenantView, 'explanation: string', 'tenant steps carry business explanations')
mustInclude(tenantView, 'Vi väntar på svar från nätägaren.', 'waiting state only when dispatch actually sent')
mustInclude(tenantView, 'Leverantörsbyte kan inte starta förrän anläggningsuppgifter finns.', 'switch gating explained in Swedish')

// Status card truth: facility "Klar" requires metering point too.
mustInclude(registry, 'const facilityComplete = hasFacility && snapshot.hasMeteringPoint', 'facility completeness includes metering point')
mustInclude(registry, "hasFacility\n          ? 'Mätpunkt saknas'", 'partial facility state labelled truthfully')

// Tenant registry hides test customers by default; platform can opt in.
mustInclude(customersLib, 'excludeTestData?: boolean', 'test data exclusion option exists')
mustInclude(customersLib, "flag !== 'test_customers'", 'explicit test filter still shows them')
mustInclude(customersPage, 'excludeTestData: !tenantScope.isPlatformAdmin', 'tenant list excludes test rows by default')

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('gridex-tenant-ui-simplified-status-regression: all checks passed')
