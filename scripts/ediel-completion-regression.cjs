const fs = require('node:fs')
const path = require('node:path')
const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const failures = []
const requireText = (file, token) => {
  if (!read(file).includes(token)) failures.push(`${file}:missing:${token}`)
}
const forbidText = (file, token) => {
  if (read(file).includes(token)) failures.push(`${file}:forbidden:${token}`)
}

requireText('lib/ediel/core/kernel.ts', 'resolveCanonicalRulePack')
requireText('lib/ediel/core/kernel.ts', 'canonicalRulePackId')
requireText('lib/ediel/rulebook/canonicalRulePackRegistry.ts', 'resolve_canonical_ediel_rule_pack')
requireText('supabase/migrations/20260713100000_ediel_completion_and_platform_contract.sql', 'canonical_ediel_rule_pack_required')
requireText('supabase/migrations/20260713100000_ediel_completion_and_platform_contract.sql', 'ediel_message_profiles')
requireText('lib/ediel/productionReadiness.ts', 'external_certification_and_pilot_missing')
requireText('lib/ediel/certificationEvidence.ts', 'LIVE_TENANT_INTEGRITY')
requireText('lib/ediel/certificationEvidence.ts', 'RESTORE_REPLAY')
requireText('lib/ediel/outbox/sendOutboxItem.ts', ".eq('company_id', params.companyId)")
requireText('lib/email/resendWebhookEvents.ts', ".eq('company_id', row.company_id)")
forbidText('lib/ediel/core/kernel.ts', "environment: params.environment ?? 'test'")
forbidText('lib/ediel/decisionEngine.ts', "from '@/lib/ediel/testing")
forbidText('lib/ediel/aiList.ts', "applicationReference: 'GRIDEX'")
if (fs.existsSync(path.join(root, 'lib/ediel/ackDecision.ts'))) failures.push('legacy ackDecision.ts still exists')

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('Ediel completion regression passed.')
