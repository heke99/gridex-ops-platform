#!/usr/bin/env node
const fs = require('node:fs')

const failures = []
let checks = 0

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function check(value, message) {
  checks += 1
  if (!value) failures.push(message)
}

const monthlyRoute = read('app/api/cron/billing/monthly/route.ts')
const monthlyAutomation = read('lib/billing/monthlyAutomation.ts')
const invoiceExport = read('lib/integrations/billing/invoiceExportCore.ts')
const settlementCron = read('app/api/cron/pricing/spot-settlement/route.ts')
const lockedPricingMigration = read('supabase/migrations/20260820113132_invoice_export_locked_pricing_guard.sql')

check(!monthlyRoute.includes("?? 'billing_partner'"), 'Billing-cron får inte skriva över tenantens canonical provider med billing_partner.')
check(!monthlyAutomation.includes("?? 'capway_aptic'"), 'Billing-runtime får inte hitta på en provider när tenantkonfiguration saknas.')
check(!monthlyAutomation.includes('if (underlayResult.needsReview > 0)'), 'Blockerade kunder får inte stoppa export av övriga exportklara kunder.')
check(
  invoiceExport.includes(".eq('status', 'locked')") && !invoiceExport.includes(".in('status', ['success', 'locked'])"),
  'Invoice export måste kräva exakt locked pricing run.',
)
check(
  settlementCron.includes('lockSpotSettlementMonth') && !settlementCron.includes('settlement_locked: false'),
  'Settlement-cron måste låsa verifierade månadssummeringar före billing.',
)
check(
  lockedPricingMigration.includes("pr.status = 'locked'") &&
    lockedPricingMigration.includes('invoice_export_requires_locked_pricing_run') &&
    lockedPricingMigration.includes('security invoker'),
  'Databasen måste avvisa invoice-export som inte pekar på tenantens låsta pricing run.',
)

if (failures.length > 0) {
  console.error(`Production masterplan P0 regression failed (${failures.length}/${checks}):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Production masterplan P0 regression passed (${checks} controls).`)
