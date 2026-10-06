const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { createRequire } = require('node:module')
const root = '/workspace/gridex-combined-source-capture'
const req = createRequire(path.join(root, 'package.json'))
const ts = req('typescript')
const sha = value => createHash('sha256').update(value).digest('hex')
const helperPath = 'scripts/helpers/utiltsConsumptionParties.ts'
const helper = fs.readFileSync(path.join(root, helperPath), 'utf8')
const candidate = helper.replace("import { assertEdielSmtpReadiness } from '@/lib/ediel/mailReadiness'", "import { edielSmtpConfig } from '@/lib/ediel/mailReadiness'")
  .replace('lit(assertEdielSmtpReadiness().from)', "lit(edielSmtpConfig().from || 'synthetic-utilts-retry@example.invalid')")
if (candidate === helper || (helper.match(/assertEdielSmtpReadiness/g) || []).length !== 2) throw new Error('unexpected_helper_source')
const readinessSource = fs.readFileSync(path.join(root, 'lib/ediel/mailReadiness.ts'), 'utf8')
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
const real = { exports: {} }
new Function('module', 'exports', 'require', transpile(readinessSource))(real, real.exports, req)
function exactHelper(source) {
  const ast = ts.createSourceFile(helperPath, source, ts.ScriptTarget.Latest, true)
  const nodes = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'receiveUtiltsRetry')
  if (nodes.length !== 1) throw new Error('non_unique_helper_function')
  const exports = {}
  new Function('exports', 'randomUUID', 'assertEdielSmtpReadiness', 'edielSmtpConfig', transpile(nodes[0].getText(ast)))(exports, randomUUID, real.exports.assertEdielSmtpReadiness, real.exports.edielSmtpConfig)
  return exports.receiveUtiltsRetry
}
const prior = exactHelper(helper), corrected = exactHelper(candidate)
for (const key of Object.keys(process.env)) {
  if (key.startsWith('EDIEL_SMTP_') || ['EDIEL_EMAIL_PROVIDER', 'EDIEL_SHARED_MAILBOX_ADDRESS', 'EDIEL_APP_DKIM_ENABLED', 'EMAIL_PROVIDER'].includes(key)) delete process.env[key]
}
const input = { companyId: randomUUID(), actorUserId: randomUUID(), raw: 'synthetic-retained-original', parsed: { rawPayload: 'synthetic-retained-original', messageFamily: 'UTILTS', messageCode: 'S01' } }
const literal = value => value === null ? 'NULL' : "'" + String(value).replaceAll("'", "''") + "'"
function invoke(fn) {
  const calls = []
  try { return { result: fn(sql => calls.push(sql), literal, input), calls } }
  catch (error) { return { error: error.message, calls } }
}
const oldNoSmtp = invoke(prior)
if (!oldNoSmtp.error?.startsWith('Ediel SMTP saknar miljövariabler:') || oldNoSmtp.calls.length) throw new Error('original_failure_not_reproduced')
const newNoSmtp = invoke(corrected)
if (newNoSmtp.error || newNoSmtp.calls.length !== 1 || !newNoSmtp.calls[0].includes("'synthetic-utilts-retry@example.invalid'")) throw new Error('receiving_without_smtp_failed')
if (!newNoSmtp.result.inboundEmailMessageId || !newNoSmtp.result.parseResultId) throw new Error('missing_receive_identities')
let productionStillRejects = false
try { real.exports.assertEdielSmtpReadiness() } catch (error) { productionStillRejects = error.message.startsWith('Ediel SMTP saknar miljövariabler:') }
if (!productionStillRejects) throw new Error('production_missing_credentials_not_rejected')
process.env.EDIEL_SMTP_FROM = '  configured-inbound@example.invalid  '
const newConfiguredReceive = invoke(corrected)
if (newConfiguredReceive.error || !newConfiguredReceive.calls[0].includes("'configured-inbound@example.invalid'")) throw new Error('configured_trimmed_sender_not_preserved')
const configuredWithoutPassword = invoke(prior)
if (!configuredWithoutPassword.error?.includes('EDIEL_SMTP_PASS') || configuredWithoutPassword.calls.length) throw new Error('old_send_password_dependency_not_reproduced')
for (const [key, value] of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid', EDIEL_APP_DKIM_ENABLED:'false', EMAIL_PROVIDER:'resend', EDIEL_SMTP_FROM:'synthetic@example.invalid', EDIEL_SMTP_USER:'synthetic@example.invalid', EDIEL_SMTP_PASS:'synthetic-only', EDIEL_EMAIL_PROVIDER:'strato'})) process.env[key] = value
const oldTr05 = invoke(prior), newTr05 = invoke(corrected)
if (oldTr05.error || newTr05.error || !oldTr05.calls[0].includes("'synthetic@example.invalid'") || !newTr05.calls[0].includes("'synthetic@example.invalid'")) throw new Error('configured_TR05_sender_changed')
const result = {
  scope: 'Actual original SMTP config module and exact receiveUtiltsRetry function body, dependency-isolated local SQL spy only; no DB/native/CI or case-approval claim',
  recorded_at_utc: new Date().toISOString(), parent: '2864fd53320e97f6d466746ea986d72f6de358b0',
  node: process.version, helper_path: helperPath, original_sha256: sha(helper), candidate_sha256: sha(candidate), production_readiness_sha256: sha(readinessSource),
  original_no_SMTP: { throws_before_SQL: true, exception: oldNoSmtp.error, SQL_calls: 0 },
  corrected_no_SMTP: { real_helper_returns_two_reception_identities: true, SQL_calls: 1, synthetic_inbound_mailbox_address: true },
  configured_inbound_sender_trimmed_and_preserved_without_send_password: true,
  original_configured_FROM_still_requires_send_password_before_SQL: true,
  configured_TR05_original_and_candidate_sender_identical: true,
  unchanged_actual_production_readiness_still_rejects_missing_send_credentials: true,
  exact_candidate_two_replacements: true, verdict: 'PASS_BOUNDED_RECEIVING_CONFIG_REGRESSION_ONLY'
}
fs.writeFileSync('/workspace/agent-review-checkpoints/pr614-2864-receive-helper-smtp-config-diagnostic.json', JSON.stringify(result, null, 2) + '\n')
process.stdout.write(JSON.stringify(result) + '\n')
