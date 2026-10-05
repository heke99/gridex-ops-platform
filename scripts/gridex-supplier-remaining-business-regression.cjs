#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

const ts = require('typescript')
const sourcePrinter = ts.createPrinter({ removeComments: true })
function sourceTree(source) { return ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) }
function sourceCode(node) { return node ? sourcePrinter.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile()).replace(/\s+/g, ' ').trim() : '' }
function statements(node) { return node?.statements ? Array.from(node.statements) : [] }
function statementCode(node) { return statements(node).map(sourceCode).join('\n') }
function namedBody(tree, name) {
  const matches = statements(tree).filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  return matches.length === 1 ? matches[0].body : undefined
}
function directIf(body, condition) {
  const matches = statements(body).filter(node => ts.isIfStatement(node) && sourceCode(node.expression) === condition)
  return matches.length === 1 ? matches[0] : undefined
}

const root = process.cwd()
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8') }
function ok(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exit(1)
  }
  console.log(`OK: ${message}`)
}

const businessProcesses = read('lib/customer-operations/businessProcesses.ts')
const businessActions = read('lib/customer-operations/customerBusinessActions.ts')
const inboundState = read('lib/ediel/flows/inboundBusinessStateMachine.ts')
const inboundStateLegacy = read('lib/ediel/flows/inboundBusinessStateMachineLegacy.ts')
const supplyMarketTransition = read('lib/ediel/flows/supplyMarketTransition.ts')
const inboundAckProcessing = read('lib/ediel/flows/inboundAckProcessing.ts')
const committedInboundAck = read('lib/ediel/ack/committedInboundAck.ts')
const prodatLifecycle = read('lib/ediel/stateMachines/prodatLifecycle.ts')
const inboundProcessing = read('lib/ediel/flows/inboundProcessing.ts')
const customerCard = read('components/admin/customers/CustomerBusinessActionsCard.tsx')
const switchCreate = read('app/admin/customers/[id]/switch-create-actions.ts')
const migration = read('supabase/migrations/20260624130000_gridex_supplier_remaining_business_state_machine.sql')
const packageJson = JSON.parse(read('package.json'))

ok(/grid_owner_information_request/.test(businessProcesses), 'business process exists for grid owner information request')
ok(/supplier_switch_cancellation/.test(businessProcesses), 'business process exists for cancellation/withdrawal')
ok(/customer_move_out/.test(businessProcesses), 'business process exists for customer move-out')
ok(/disconnection_case/.test(businessProcesses), 'business process exists for disconnection case foundation')
ok(/metering_values_ingestion/.test(businessProcesses), 'business process exists for automatic metering ingestion')
ok(/monthly_billing_underlay/.test(businessProcesses), 'business process exists for automatic billing underlays')
ok(/billing_partner_export/.test(businessProcesses), 'business process exists for billing partner export')
ok(/isBackgroundAutomation:\s*true/.test(businessProcesses), 'background billing/metering processes are marked as automation')

ok(/buildCustomerBusinessActionPlan/.test(businessActions), 'customer business action plan helper exists')
ok(/tenantBusinessActionStatusLabel/.test(businessActions), 'tenant status labels exist for action plan')
ok(/const primaryAction = actions\.find/.test(customerCard), 'customer card renders one primary business action')
ok(/Tekniska detaljer och felsökning/.test(customerCard), 'technical details remain behind platform-admin section')
ok(!/Leverantörsbyte kan inte startas eftersom nätägare, PRODAT-route/.test(switchCreate), 'tenant-facing supplier switch route error is no longer raw technical copy')
ok(/nätägarens tekniska väg/.test(switchCreate), 'supplier switch route blocker uses plain Swedish tenant copy')

ok(/applyInboundBusinessStateMachine/.test(inboundState), 'active inbound business state facade exists')
ok(/resolveCanonicalEdielPolicy/.test(inboundState) && /resolveUtiltsInboundBusinessOutcome/.test(inboundState), 'UTILTS inbound outcome is resolved through canonical policy')
ok(/metering_values_received/.test(inboundState), 'canonical UTILTS E66 outcome maps actual values to metering values received')
ok(/record_grid_contract_response/.test(prodatLifecycle) && /grid_owner_information_received/.test(prodatLifecycle), 'canonical PRODAT lifecycle maps grid-owner information responses to received state')
ok(/confirm_supplier_change/.test(prodatLifecycle) && /supplier_switch_accepted/.test(prodatLifecycle), 'canonical PRODAT lifecycle maps supplier-switch confirmation to accepted state')
ok(/end_existing_supply/.test(prodatLifecycle) && /supply_terminated/.test(prodatLifecycle), 'canonical PRODAT lifecycle maps Z05 termination semantics to ended supply')
ok(/business_rejection/.test(inboundStateLegacy), 'negative APERAK maps to business rejection in characterized ACK state handling')
ok(/technical_rejection/.test(inboundStateLegacy), 'negative CONTRL maps to technical rejection in characterized ACK state handling')
// These are bounded static checks of actual named function statements. They do
// not execute production effects or replace retained native source proof.
const legacyTree = sourceTree(inboundStateLegacy)
const supplyBusiness = namedBody(legacyTree, 'applyInboundBusinessStateMachine')
const acceptedSupply = directIf(supplyBusiness, "outcome === 'supplier_switch_accepted'")
const acceptedSupplyEffect = statementCode(acceptedSupply?.thenStatement)
const heldSupply = directIf(acceptedSupply?.thenStatement, '!sourceResult.applied')
const heldSupplyEffect = statementCode(heldSupply?.thenStatement)
const appliedSupplyEffect = statementCode(heldSupply?.elseStatement)
const nativeSupplyEffect = statementCode(namedBody(sourceTree(supplyMarketTransition), 'applySupplyMarketSource'))
ok(
  /^import\s*\{\s*applySupplyMarketSource\s*\}\s*from\s*'\.\/supplyMarketTransition';$/m.test(statementCode(legacyTree))
    && /^const sourceResult = sourceSupplyResult \?\? await applySupplyMarketSource\(\{ actorUserId: input\.actorUserId, message: input\.message \}\);$/m.test(acceptedSupplyEffect)
    && /^outcome = 'manual_review_required';\nreviewRequired = true;$/m.test(heldSupplyEffect)
    && /^updated\.push\('supplier_switch_requests', 'customer_supply_periods'\);$/m.test(appliedSupplyEffect)
    && /^for \(const scope of sourceResult\.commits\) await publishSourceSwitchCommit\(input\.onSourceSwitchCommitted, \{ message: \{ \.\.\.input\.message, customer_id: scope\.customerId, metering_point_id: scope\.meteringPointId, site_id: scope\.siteId \}, switchRequestId: scope\.switchRequestId, supplyPeriodId: scope\.supplyPeriodId,? \}\);$/m.test(appliedSupplyEffect)
    && /^const \{ data, error \} = await rpc\(\)\('ediel_apply_supply_source_v1', \{ p_company_id: input\.message\.company_id, p_source_message_id: input\.message\.id, p_actor_user_id: input\.actorUserId \}\);\nif \(error\) throw error;\nconst result = data && typeof data === 'object' && !Array\.isArray\(data\) \? data as Record<string, unknown> : \{\};$/m.test(nativeSupplyEffect)
    && /^const commits: SupplyCommitScope\[\] = \[\];\nif \(result\.commits != null\) \{ if \(!Array\.isArray\(result\.commits\)\) throw new Error\('normal_supply_commit_scope_invalid'\); for \(const value of result\.commits\) \{ if \(!value \|\| typeof value !== 'object' \|\| \['switchRequestId', 'supplyPeriodId', 'customerId', 'meteringPointId', 'siteId'\]\.some\(key => typeof value\[key\] !== 'string' \|\| !value\[key\]\)\) throw new Error\('normal_supply_commit_scope_invalid'\); commits\.push\(value as SupplyCommitScope\); \} \}$/m.test(nativeSupplyEffect)
    && /^const applied = result\.applied === true;$/m.test(nativeSupplyEffect)
    && /^return \{ applied, reason: typeof result\.reason === 'string' \? result\.reason : null, idempotent: result\.idempotent === true, periods, commits, partition, effectReceiptIds, fullyApplied, reviewRequired: partition !== null && !fullyApplied \};$/m.test(nativeSupplyEffect),
  'characterized PRODAT side effects create or update supply periods',
)
ok(/customer_supply_periods/.test(inboundStateLegacy), 'characterized PRODAT side effects write supply period foundation')
const inboundTree = sourceTree(inboundProcessing)
const ackCaller = directIf(namedBody(inboundTree, 'processInboundEdielMessage'), 'runtimeMessage.message_family === "CONTRL" || runtimeMessage.message_family === "APERAK" || runtimeMessage.message_family === "UTILTS_ERR"')
const ackTree = sourceTree(inboundAckProcessing)
const ackEffect = statementCode(namedBody(ackTree, 'processInboundAckMessage'))
const patchAckEffect = statementCode(namedBody(ackTree, 'patchSourceMessageFromAck'))
const committedAckEffect = statementCode(namedBody(sourceTree(committedInboundAck), 'readCommittedInboundAck'))
const ackBusinessCalls = [
  ['outboundRequest', 'syncOutboundRequestFromInboundAck', 'actorUserId, sourceMessage, ackMessage, outcome, finalAckReached: sourcePatch.finalAckReached, failureReason: sourcePatch.failureReason'],
  ['switchResult', 'syncSwitchFromInboundAck', 'actorUserId, sourceMessage, ackMessage, outboundRequest, outcome, finalAckReached: sourcePatch.finalAckReached, failureReason: sourcePatch.failureReason'],
  ['gridOwnerDataRequest', 'syncGridOwnerDataRequestFromInboundAck', 'actorUserId, sourceMessage, ackMessage, outboundRequest, outcome, finalAckReached: sourcePatch.finalAckReached, failureReason: sourcePatch.failureReason'],
  ['customerCase', 'syncCustomerCaseCancellationAck', 'actorUserId, sourceMessage: sourcePatch.updated, ackMessage, outcome, finalAckReached: sourcePatch.finalAckReached'],
]
ok(
  /^import\s*\{\s*processInboundAckMessage\s*\}\s*from\s*"@\/lib\/ediel\/flows\/inboundAckProcessing";$/m.test(statementCode(inboundTree))
    && /^await processInboundAckMessage\(\{ actorUserId, message: runtimeMessage \}\);$/m.test(statementCode(ackCaller?.thenStatement))
    && /\nreturn runtimeMessage;$/.test(statementCode(ackCaller?.thenStatement))
    && /^import\s*\{\s*readCommittedInboundAck\s*\}\s*from\s*'@\/lib\/ediel\/ack\/committedInboundAck';$/m.test(statementCode(ackTree))
    && /^const committed = await readCommittedInboundAck\(\{ actorUserId, message: ackMessage \}\);\nif \(committed\) \{ if \(committed\.kind === 'legacy_diagnostic'\) return \{ ackMessage, sourceMessage: null, outcome: committed\.outcome, finalAckReached: null, wholeSourceRejected: null, sourceAccepted: null, summaryUnavailable: true, outboundRequestId: null, switchRequestId: null, gridOwnerDataRequestId: null \}; const receipt = committed\.result, source = receipt\.sourceMessage; return \{ ackMessage, sourceMessage: source, outcome: receipt\.outcome, finalAckReached: receipt\.finalAckReached, wholeSourceRejected: receipt\.wholeSourceRejected, sourceAccepted: receipt\.sourceAccepted, outboundRequestId: source\.outbound_request_id, switchRequestId: source\.switch_request_id, gridOwnerDataRequestId: source\.grid_owner_data_request_id \}; \}\nconst outcome = inferInboundAckOutcome\(ackMessage\);\nconst sourceMessage = await findSourceMessageForInboundAck\(ackMessage\);$/m.test(ackEffect)
    && /^const sourcePatch = await patchSourceMessageFromAck\(\{ actorUserId, sourceMessage, ackMessage, outcome,? \}\);$/m.test(ackEffect)
    && /^const allowBusinessTransition = sourcePatch\.wholeSourceRejected \|\| sourcePatch\.sourceAccepted;$/m.test(ackEffect)
    && ackBusinessCalls.every(([variable, name, args]) => {
      const escapedArgs = args.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp(`^const ${variable} = allowBusinessTransition \\? await ${name}\\(\\{ ${escapedArgs},? \\}\\) : null;$`, 'm').test(ackEffect)
    })
    && /^const \{ data, error \} = await supabaseService\.rpc\('gridex_apply_inbound_ack_source_v1', \{ p_company_id: params\.sourceMessage\.company_id, p_environment: params\.sourceMessage\.environment, p_ack_message_id: params\.ackMessage\.id, p_source_message_id: params\.sourceMessage\.id, p_actor_user_id: params\.actorUserId,? \}\);\nif \(error\) throw error;\nconst result = data as \{[^\n]*\} \| null;\nif \(!result \|\| result\.version !== 1 \|\| !result\.sourceMessage \|\| result\.sourceMessage\.id !== params\.sourceMessage\.id \|\| result\.sourceMessage\.company_id !== params\.sourceMessage\.company_id \|\| result\.outcome !== params\.outcome \|\| typeof result\.finalAckReached !== 'boolean' \|\| typeof result\.wholeSourceRejected !== 'boolean' \|\| typeof result\.sourceAccepted !== 'boolean'\) throw new Error\('ack_atomic_source_receipt_invalid'\);\nreturn \{ updated: result\.sourceMessage, finalAckReached: result\.finalAckReached, wholeSourceRejected: result\.wholeSourceRejected, sourceAccepted: result\.sourceAccepted, failureReason: typeof result\.failureReason === 'string' \? result\.failureReason : null \};$/.test(patchAckEffect)
    && /^const \{ data, error \} = await supabaseService\.rpc\('gridex_read_committed_inbound_ack_v2', \{ p_company_id: message\.company_id \?\? null, p_environment: message\.environment, p_ack_message_id: message\.id, p_actor_user_id: input\.actorUserId, p_ack_payload_hash: evidenceHash\(message\.raw_payload\) \}\);\nif \(error\) throw error;\nif \(data === null\) return null;\nif \(!isEvidenceRecord\(data\)[^\n]*data\.ackMessageId !== message\.id[^\n]*data\.companyId !== message\.company_id[^\n]*data\.environment !== message\.environment[^\n]*data\.ackPayloadHash !== evidenceHash\(message\.raw_payload\)[^\n]*!isEvidenceUuid\(data\.sourceMessageId\)\) throw new Error\('ack_committed_read_invalid'\);$/m.test(committedAckEffect)
    && /^const summary = data\.kind === 'exact_receipt' \? data\.result : data;$/m.test(committedAckEffect)
    && /^if \(data\.kind === 'legacy_diagnostic' && data\.summaryUnavailable === true\) return Object\.freeze\(data\) as CommittedInboundAck;$/m.test(committedAckEffect)
    && /^if \(data\.kind !== 'exact_receipt'[^\n]*summary\.sourceMessage\.id !== data\.sourceMessageId[^\n]*summary\.sourceMessage\.company_id !== data\.companyId[^\n]*summary\.sourceMessage\.environment !== message\.environment[^\n]*summary\.sourceMessage\.direction !== 'outbound'[^\n]*summary\.finalAckReached, summary\.wholeSourceRejected, summary\.sourceAccepted, summary\.idempotent\]\.every\(item => typeof item === 'boolean'\)[^\n]*\) throw new Error\('ack_committed_read_invalid'\);\nreturn Object\.freeze\(data\) as CommittedInboundAck;$/m.test(committedAckEffect),
  'ack processing delegates qualified source outcomes before business transitions',
)
ok(/source: "utilts_processing"/.test(inboundProcessing), 'UTILTS processing calls inbound business state machine')
ok(/prodat_with_strong_switch_match/.test(inboundProcessing), 'PRODAT processing calls state machine with strong switch match')
ok(/prodat_without_strong_switch_match/.test(inboundProcessing), 'PRODAT processing calls state machine without strong switch match for Z02/manual review')

ok(/customer_supply_periods/.test(migration), 'migration hardens customer supply periods')
ok(/billing_match_status/.test(migration), 'migration adds billing match status columns for metering values')
ok(/idempotency_key/.test(migration), 'migration adds billing export run idempotency key')
ok(/technical_details_visible_to_tenant boolean not null default false/.test(migration), 'migration blocks tenant visibility for technical case details by default')
ok(/ux_billing_automation_runs_one_running_per_company_period/.test(migration), 'migration adds running month idempotency guard')

ok(packageJson.scripts['gridex:supplier-remaining-business-regression'], 'remaining business regression script is registered')
ok(packageJson.scripts['gridex:supplier-business-full-regression'], 'full supplier business regression chain is registered')

console.log('Gridex supplier remaining business regression passed')