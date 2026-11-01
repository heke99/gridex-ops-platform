// Explicit pilot entry point. Missing qualified private inputs fail closed.
// This scenario never allocates services or writes trust/supply/metering SQL.
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { bootstrapPilotTestTrust, createAdminFixture, type PilotTestAuthority } from '../lib/fixture'
import { createSignedContract, createTermTenant, tenantSession } from '../lib/term-fixture'
import { loginSession, loginPlatformConfigurationSession } from '../lib/session'
import { runPreparedTerm0203Pilot, qualifyPilotNetworkSource, validatePilotHistoricalSigning, writeTerm0203BusinessEvidence, type PilotMailbox } from '../lib/pilot-term0203'
import { stockholmMonthBoundsUtc } from '../lib/term-oracle'

type Specification = {
  declaration: 'SYNTHETIC_NOT_EXTERNAL_LEGAL_ACCEPTANCE'; billingMonth: string; signedDate: string; offerValidFrom: string
  startsAt: string; startAt: string; signedPdfBase64: string; groundPdfBase64: string
  authority: Omit<PilotTestAuthority, 'specificationSha256'>; groundVersion: string; groundDecisionReference: string
  network: { pdfBase64: string; reference: string; version: string; validFrom: string; validUntil: string; clause: { locator: string; quote: string } }
  z04: string; e66: string[]
}
type Packet = {
  schema: 'gridex-t2-term0203-materials-v1'; assignmentSha256: string; sourceCommit: string; environmentId: string
  specification: Specification
}
const sha = (raw: string | Buffer) => createHash('sha256').update(raw).digest('hex')
function privateJson<T>(raw: Buffer): T {
  try { return JSON.parse(raw.toString()) as T } catch { throw Error('pilot_private_json_invalid') }
}
function privateBytes(filename: string, limit = 8 * 1024 * 1024): Buffer {
  if (!path.isAbsolute(filename) || fs.realpathSync(filename) !== filename) throw Error('pilot_private_path_invalid')
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const info = fs.fstatSync(fd)
    if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o600 || info.size > limit) throw Error('pilot_input_not_private')
    return fs.readFileSync(fd)
  } finally { fs.closeSync(fd) }
}

it('TERM02.03 ordinary historical supply/E66 → stored pricing and review draft', async () => {
  if (process.env.SIM_REQUIRE_ACTOR_RECEIPT !== '1' || !process.env.SIM_RUNTIME_ASSIGNMENT_FILE
    || !process.env.SIM_TERM0203_MATERIALS_FILE || !process.env.SIM_HOME || !process.env.RUN_DIR) throw Error('pilot_qualified_runtime_and_materials_required')
  // Existing resource owner's verifier: source/assignment/currentattempt, actual
  // Docker birth/image/TLS/auth/ports and exact private descriptor hashes.
  execFileSync('python3', [path.join(process.env.RUN_DIR, 'scripts/simulation/track2/hosted/imap-mailbox.py'), 'verify', '--runtime-operation', 'run'], { stdio: ['ignore', 'pipe', 'pipe'] })
  const assignmentRaw = privateBytes(process.env.SIM_RUNTIME_ASSIGNMENT_FILE, 65536)
  const assignment = privateJson<{ sourceCommit: string; sourceTree: string; environmentId: string; github: { runId: number; runAttempt: number }; pilotTerm0203?: { materialSpecificationSha256: string; businessEvidenceRecipientCertificateSHA256: string } }>(assignmentRaw)
  const materialsRaw = privateBytes(process.env.SIM_TERM0203_MATERIALS_FILE)
  const packet = privateJson<Packet>(materialsRaw)
  const profile = privateJson<{ bootstrapRecipientCertificate: string; bootstrapRecipientCertificateSHA256: string }>(fs.readFileSync(path.join(process.env.RUN_DIR, 'scripts/simulation/track2/hosted/profile.requirements.json')))
  const recipientCertificateSha256 = sha(profile.bootstrapRecipientCertificate)
  if (recipientCertificateSha256 !== profile.bootstrapRecipientCertificateSHA256
    || recipientCertificateSha256 !== assignment.pilotTerm0203?.businessEvidenceRecipientCertificateSHA256) throw Error('pilot_business_recipient_binding_mismatch')
  const mailbox = privateJson<PilotMailbox>(privateBytes(path.join(process.env.SIM_HOME, 'pilot-mailbox/descriptor.json')))
  if (packet.schema !== 'gridex-t2-term0203-materials-v1' || packet.assignmentSha256 !== sha(assignmentRaw)
    || packet.sourceCommit !== assignment.sourceCommit || packet.environmentId !== assignment.environmentId
    || sha(JSON.stringify(packet.specification)) !== assignment.pilotTerm0203?.materialSpecificationSha256) throw Error('pilot_materials_assignment_mismatch')
  const spec = packet.specification
  validatePilotHistoricalSigning(spec)
  if (spec.declaration !== 'SYNTHETIC_NOT_EXTERNAL_LEGAL_ACCEPTANCE' || spec.startsAt !== `${spec.billingMonth}-01`
    || !spec.e66.length || !spec.groundPdfBase64 || !spec.signedPdfBase64) throw Error('pilot_material_specification_invalid')
  // Obtain the numeric running term-job identity through the authenticated
  // source-bound Python owner; environment labels cannot authorize this binding.
  const job = privateJson<{ jobId: number; job: string }>(execFileSync('python3', [path.join(process.env.RUN_DIR, 'scripts/simulation/track2/hosted/business-evidence.py'), '--job-context'], { stdio: ['ignore', 'pipe', 'pipe'] }))
  const sourceCommit = execFileSync('git', ['-C', process.env.RUN_DIR, 'rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
  const sourceTree = execFileSync('git', ['-C', process.env.RUN_DIR, 'rev-parse', 'HEAD^{tree}'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
  if (job.job !== 'term' || !Number.isSafeInteger(job.jobId) || job.jobId <= 0 || sourceCommit !== assignment.sourceCommit || sourceTree !== assignment.sourceTree
    || process.env.GITHUB_JOB !== 'term' || process.env.GITHUB_SHA !== sourceCommit || !Number.isSafeInteger(assignment.github.runId) || assignment.github.runId <= 0
    || !Number.isSafeInteger(assignment.github.runAttempt) || assignment.github.runAttempt <= 0
    || String(assignment.github.runId) !== process.env.GITHUB_RUN_ID || String(assignment.github.runAttempt) !== process.env.GITHUB_RUN_ATTEMPT) throw Error('pilot_business_execution_binding_mismatch')
  const tenant = await createTermTenant({ permissionKeys: ['communication.read', 'communication.write', 'communication.send', 'metering.read', 'metering.write', 'pricing.write', 'billing_underlay.read', 'billing_underlay.export'] })
  const reviewActor = await createAdminFixture({ existingCompanyId: tenant.companyId, permissionKeys: ['communication.read', 'communication.write', 'customers.write', 'contracts.read', 'contracts.write', 'metering.read', 'metering.write', 'ediel.network_registry.review', 'ediel.regulated_supply.review'] })
  const session = await tenantSession(tenant)
  const reviewer = await loginSession(reviewActor.email, reviewActor.password, { companyId: tenant.companyId })
  const platformActor = await createAdminFixture({ existingCompanyId: tenant.companyId, purpose: 'PLATFORM_CONFIGURATION', permissionKeys: ['communication.read', 'communication.write'] })
  const platform = await loginPlatformConfigurationSession(platformActor.email, platformActor.password)
  const authority = { ...spec.authority, specificationSha256: sha(JSON.stringify(spec)) }
  const catalog = bootstrapPilotTestTrust({ companyId: tenant.companyId, actorUserId: tenant.admin.userId, receiver: tenant.edielReceiver, authority })
  const receiptDirectory = path.join(process.env.SIM_HOME, 'pilot-bootstrap')
  fs.mkdirSync(receiptDirectory, { recursive: true, mode: 0o700 })
  const receiptInfo = fs.statSync(receiptDirectory)
  if (fs.realpathSync(receiptDirectory) !== receiptDirectory || receiptInfo.uid !== process.getuid?.() || (receiptInfo.mode & 0o777) !== 0o700) throw Error('pilot_bootstrap_directory_not_private')
  fs.writeFileSync(path.join(receiptDirectory, `${randomUUID()}.json`), JSON.stringify({ ...catalog, assignmentSha256: sha(assignmentRaw), sourceCommit: assignment.sourceCommit, environmentId: assignment.environmentId }), { mode: 0o600, flag: 'wx' })
  const networkSource = await qualifyPilotNetworkSource({ companyId: tenant.companyId, session, reviewer, authority, catalog, ...spec.network, pdf: Buffer.from(spec.network.pdfBase64, 'base64') })
  const contract = await createSignedContract(tenant, { startsAt: spec.startsAt, signedAt: spec.signedDate,
    contractType: 'variable_hourly', bindingMonths: 0, noticeMonths: 1, monthlyFeeSek: 39, priceArea: 'SE3' }, {
    uploadedAgreement: { file: new File([Buffer.from(spec.signedPdfBase64, 'base64')], 'declared-synthetic-signed-contract.pdf', { type: 'application/pdf' }),
      signedDate: spec.signedDate, offerValidFrom: spec.offerValidFrom },
  })
  const bounds = stockholmMonthBoundsUtc(spec.billingMonth), expectedIntervals: Array<{ start: string; end: string; kwh: '0' }> = []
  for (let at = bounds.startMs; at < bounds.endMs; at += 3_600_000) expectedIntervals.push({ start: new Date(at).toISOString(), end: new Date(at + 3_600_000).toISOString(), kwh: '0' })
  const evidence = await runPreparedTerm0203Pilot({ contract, session, reviewer, platform, mailbox,
    billingMonth: spec.billingMonth, bilateralAgreementId: catalog.agreementId, startAt: spec.startAt,
    issuer: { issuerCode: authority.regulatedIssuerCode, keyId: catalog.regulatedKeyId, representationId: catalog.regulatedRepresentationId, receiptSigningKeyHex: authority.regulatedKeyHex, sourceReference: authority.regulatedReference, sourceVersion: spec.groundVersion, legalDecisionReference: spec.groundDecisionReference }, groundPdf: Buffer.from(spec.groundPdfBase64, 'base64'), groundDeclaration: spec.declaration,
    z04: spec.z04, e66: spec.e66, expectedIntervals })
  expect(evidence.monthlyLineOre).toBe('3900')
  expect(evidence.monthlyVatOre).toBe('975')
  expect(evidence.legalAcceptance).toBe('NOT_PROVEN_SYNTHETIC_ISSUER')
  writeTerm0203BusinessEvidence(process.env.SIM_HOME, { sourceCommit, sourceTree, githubRunId: assignment.github.runId, githubRunAttempt: assignment.github.runAttempt,
    githubJobId: job.jobId, githubJob: 'term', assignmentSha256: sha(assignmentRaw), materialsSha256: sha(materialsRaw), materialSpecificationSha256: sha(JSON.stringify(spec)),
    environmentId: assignment.environmentId, billingMonth: spec.billingMonth, recipientCertificateSha256 }, networkSource, evidence,
    { submittedByUserId: session.userId, reviewedByUserId: reviewer.userId })
  // One private record of observed effects; synthetic trust never grants whole acceptance.
}, 240_000)
