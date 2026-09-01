const fs = require('node:fs')
const path = require('node:path')
const { readSourceModule } = require('./lib/read-source-module.cjs')
const root = process.cwd()

// TypeScript source checks operate on the complete logical module (public
// facade plus characterized .part-* implementations). This keeps the release
// gate stable across safe source splits without weakening the invariant.
const read = (file) => {
  const source = /\.(ts|tsx)$/.test(file)
    ? readSourceModule(file, root)
    : fs.readFileSync(path.join(root, file), 'utf8')
  return /\.(ts|tsx)$/.test(file) ? source.replace(/"/g, "'") : source
}
const failures = []
const requireText = (file, token) => {
  if (!read(file).includes(token)) failures.push(`${file}:missing:${token}`)
}
const forbidText = (file, token) => {
  if (read(file).includes(token)) failures.push(`${file}:forbidden:${token}`)
}

// The kernel consumes the canonical rule pack through the registry-backed
// validator. Outbound traffic fails closed unless the registry supplies the
// exact rule-pack evidence snapshot persisted with the message.
requireText('lib/ediel/core/kernel.ts', 'validateRulebookMessageWithRegistry')
requireText('lib/ediel/core/kernel.ts', 'outbound_ediel_canonical_policy_evidence_missing')
requireText('lib/ediel/core/kernel.ts', 'rulePackSnapshot')
requireText('lib/ediel/rulebook/canonicalRulePackRegistry.ts', 'resolve_canonical_ediel_rule_pack')
requireText('supabase/migrations/20260713100000_ediel_completion_and_platform_contract.sql', 'canonical_ediel_rule_pack_required')
requireText('supabase/migrations/20260713100000_ediel_completion_and_platform_contract.sql', 'ediel_message_profiles')
requireText('lib/ediel/productionReadiness.ts', 'external_certification_and_pilot_missing')
requireText('lib/ediel/certificationEvidence.ts', 'LIVE_TENANT_INTEGRITY')
requireText('lib/ediel/certificationEvidence.ts', 'RESTORE_REPLAY')
requireText('lib/ediel/outbox/sendOutboxItem.ts', ".eq('company_id', params.companyId)")
requireText('lib/email/resendWebhookEvents.ts', ".eq('company_id', companyId)")
forbidText('lib/ediel/core/kernel.ts', "environment: params.environment ?? 'test'")
forbidText('lib/ediel/decisionEngine.ts', "from '@/lib/ediel/testing")
forbidText('lib/ediel/aiList.ts', "applicationReference: 'GRIDEX'")
if (fs.existsSync(path.join(root, 'lib/ediel/ackDecision.ts'))) failures.push('legacy ackDecision.ts still exists')

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('Ediel completion regression passed.')
