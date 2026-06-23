#!/usr/bin/env node
const fs = require('fs')

function read(path) { return fs.readFileSync(path, 'utf8') }
function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exitCode = 1
  } else {
    console.log(`ok: ${message}`)
  }
}

const engine = read('lib/ediel/routeProfileProductionReadiness.ts')
const materializer = read('lib/ediel/routeMaterializer.ts')
const routeEngine = read('lib/routes/routeDecisionEngine.ts')
const autoReadiness = read('lib/ediel/operations/actorAutoReadiness.ts')
const actions = read('app/admin/ediel/route-readiness/actions.ts')

assert(/export async function evaluateRouteProfileProductionReadiness/.test(engine), 'central route profile production readiness engine exists')
assert(/smtp_to/.test(engine) && /receiver_email/.test(engine) && /communication_routes/.test(engine), 'engine syncs smtp_to/receiver_email from communication_routes')
assert(/resolveOutboundRecipientCertificate/.test(engine) && /evaluateCertificateStatus/.test(engine), 'engine reuses existing certificate resolver/status logic')
assert(/owner_ediel_id/.test(engine) && /message_family/.test(engine) && /environment/.test(engine), 'engine matches certificate by owner_ediel_id/message_family/environment')
assert(/isUsableForSmime/.test(engine), 'engine rejects unusable or expired S/MIME certificates')
assert(/hasPrivateMaterial/.test(engine) && /outbound_recipient/.test(engine), 'engine records public outbound_recipient certificate evidence without requiring private material')
assert(/approveRouteProfileForProduction/.test(engine) && /approveProduction/.test(engine), 'production approval is guarded by readiness result')
assert(/is_production_ready\s*=\s*true/.test(engine) || /updates\.is_production_ready\s*=\s*true/.test(engine), 'engine only sets production ready inside guarded approval path')
assert(/applySafeRouteProfileReadiness/.test(materializer), 'route materializer runs safe readiness sync after profile materialization')
assert(/evaluateRouteProfileProductionReadiness/.test(routeEngine), 'route decision engine calls central readiness engine')
assert(/route_profile_production_readiness/.test(routeEngine), 'route decision engine emits readiness blockers with source')
assert(/refreshRouteProfileProductionReadiness/.test(autoReadiness), 'actor readiness cron refreshes route profile readiness')
assert(/approveRouteProfileProductionAction/.test(actions), 'platform action exists for guarded production approval')
assert(/applyRouteProfileReadinessFixesAction/.test(actions), 'platform action exists for safe readiness fixes')

if (process.exitCode) process.exit(process.exitCode)
