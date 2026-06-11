#!/usr/bin/env node
const fs = require('node:fs')

function read(file) {
  return fs.readFileSync(file, 'utf8')
}
function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exitCode = 1
  } else {
    console.log(`OK: ${message}`)
  }
}

const intakeForm = read('components/admin/customers/CustomerIntakeForm.tsx')
const intakeActions = read('app/admin/customers/actions.ts')
const actorPage = read('app/admin/ediel/actors/page.tsx')
const actorActions = read('app/admin/ediel/actors/actions.ts')
const masterdataDb = read('lib/masterdata/db.ts')

assert(!intakeForm.includes('+ Lägg till ny nätägare'), 'tenant customer intake no longer offers add-new grid owner')
assert(!intakeForm.includes('+ Lägg till ny leverantör'), 'tenant customer intake no longer offers add-new supplier')
assert(!intakeForm.includes('newGridOwnerName'), 'grid owner free-text creation fields removed from intake UI')
assert(!intakeForm.includes('newCurrentSupplierName'), 'supplier free-text creation fields removed from intake UI')
assert(intakeForm.includes('Nätägare hanteras som verifierad masterdata'), 'intake explains verified grid-owner masterdata')
assert(intakeForm.includes('Leverantörer skapas inte från kundintaget'), 'intake explains supplier masterdata lock')
assert(intakeForm.includes('name="gridInvoiceFile"'), 'intake supports grid invoice upload as suggested data')

assert(!/\.from\("grid_owners"\)[\s\S]{0,600}\.insert\(/.test(intakeActions), 'customer intake action does not insert grid_owners')
assert(!/\.from\("electricity_suppliers"\)[\s\S]{0,600}\.insert\(/.test(intakeActions), 'customer intake action does not insert electricity_suppliers')
assert(intakeActions.includes('verified_for_customer_flow') && intakeActions.includes('actor_registry_status'), 'backend requires verified actor masterdata for intake selections')
assert(intakeActions.includes('grid_invoice_uploaded_suggested_data'), 'grid invoice creates data-quality issue as suggested data')
assert(intakeActions.includes('verificationLevel: "suggested"'), 'grid invoice is explicitly suggested, not verified')

assert(actorPage.includes('actorImportFile'), 'superadmin actor UI has XML/CSV upload')
assert(actorPage.includes('Importdiff och verifiering'), 'superadmin actor UI has importdiff/approval section')
assert(actorPage.includes('Verifiera för kundflöde'), 'superadmin actor UI can verify actor for customer flow')
assert(actorActions.includes('importPlatformActorsAction'), 'server action supports actor import')
assert(actorActions.includes('parseCompaniesXml'), 'server action parses companies.xml')
assert(actorActions.includes('parseActorCsv'), 'server action parses actor CSV')
assert(actorActions.includes('auto_send_allowed: false'), 'actor route verification does not enable autosend')
assert(actorActions.includes('syncVerifiedActorToCustomerMasterdata'), 'verified platform actor syncs to customer masterdata')

assert(!masterdataDb.includes('return verifiedRows.length > 0 ? verifiedRows : rows.filter'), 'customer-flow masterdata list has no unsafe active-row fallback')
assert(masterdataDb.includes('return verifiedRows;'), 'customer-flow masterdata returns only verified rows')

if (process.exitCode) process.exit(process.exitCode)
console.log('Actor registry + intake hardening regression passed')
