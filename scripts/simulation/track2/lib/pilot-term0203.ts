// Source-only pilot client. Catalog trust is caller-provided and rechecked by
// normal application scope/archive/review. Synthetic issuer != legal acceptance.
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import nodemailer from 'nodemailer'
import { psqlRows } from './db'
import { sim } from './env'
import type { PilotTestAuthority } from './fixture'
import { callServerAction, type ServerActionResult } from './server-action'
import type { AppSession } from './session'
import type { SignedContractFixture } from './term-fixture'
import { appLinesOre, readContractTerms, type PreviewData } from './term-billing'
import { oracleAllModes, sekNumberToOre, stockholmMonthBoundsUtc } from './term-oracle'

type Row = Record<string, unknown>
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const lit = (value: string) => `'${value.replaceAll("'", "''")}'`
const object = (value: unknown): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('pilot_response_object_required')
  return value as Row
}
const id = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw Error('pilot_response_id_required')
  return value
}

/** Pilot-input relation, not a newly invented application signing rule. */
export function validatePilotHistoricalSigning(input: { signedDate: string; offerValidFrom: string; startsAt: string }) {
  if ([input.signedDate, input.offerValidFrom, input.startsAt].some(value => !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
    || input.offerValidFrom > input.signedDate || input.signedDate > input.startsAt) throw Error('pilot_historical_signing_invalid')
}

export type PilotIssuer = {
  issuerCode: string; keyId: string; representationId: string; receiptSigningKeyHex: string
  sourceReference: string; sourceVersion: string; legalDecisionReference: string
}
/** Produces only the declared test issuer's signature. The app validates its
 * registered representation, authority, source, scope and independent review. */
export function signPilotGround(input: { scope: Row; issuer: PilotIssuer; sourceHash: string }) {
  const { issuer } = input
  if (!/^[a-f0-9]{64,}$/.test(issuer.receiptSigningKeyHex) || issuer.receiptSigningKeyHex.length % 2) throw Error('pilot_issuer_key_invalid')
  const payload = Buffer.from(JSON.stringify({ format: 'ediel_regulated_supply_ground_receipt_v1',
    issuerCode: issuer.issuerCode, receiptId: randomUUID(), companyId: input.scope.companyId,
    environment: 'test', scope: input.scope, sourceHash: input.sourceHash,
    sourceReference: issuer.sourceReference, sourceVersion: issuer.sourceVersion,
    legalDecisionReference: issuer.legalDecisionReference, issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  }))
  return { keyId: issuer.keyId, representationId: issuer.representationId, payloadBase64: payload.toString('base64'),
    signatureHex: createHmac('sha256', Buffer.from(issuer.receiptSigningKeyHex, 'hex')).update(payload).digest('hex') }
}

export type PilotMailbox = {
  schema: 'gridex-t2-pilot-mailbox-service-v1'; state: 'SERVICE_READY'
  environmentId: string; sourceCommit: string; assignmentSha256: string; resourceReceiptSha256: string
  mailboxAddress: string; tlsCaPath: string; nodeExtraCaPath: string
  smtp: { host: string; port: number; secure: true; user: string; password: string }
  imap: { host: string; port: number; secure: true; user: string; password: string }
}
export type PilotInput = {
  contract: SignedContractFixture; session: AppSession; reviewer: AppSession; platform: AppSession
  mailbox: PilotMailbox; billingMonth: string; bilateralAgreementId: string; startAt: string
  issuer: PilotIssuer; groundPdf: Buffer; groundDeclaration: 'SYNTHETIC_NOT_EXTERNAL_LEGAL_ACCEPTANCE'
  /** Original wire templates supplied by the qualified fixture producer. Only
   * these exact tokens are substituted; app validators qualify the actual wire. */
  z04: string; e66: string[]; expectedIntervals: Array<{ start: string; end: string; kwh: '0' }>
}
type Action = Parameters<typeof callServerAction>[1]
export type PilotPorts = {
  http(session: AppSession, route: string, body: unknown): Promise<{ status: number; body: unknown }>
  action(session: AppSession, input: Action): Promise<ServerActionResult>
  read(sql: string): Row[]
  deliver(input: { mailbox: PilotMailbox; raw: string; internetMessageId: string }): Promise<void>
}
const actualPorts: PilotPorts = {
  http: async (session, route, body) => {
    const response = await session.fetch(route, { method: 'POST', headers: { 'content-type': 'application/json', ...(route.startsWith('/api/internal/inbound-mail/cron?') ? { authorization: `Bearer ${sim.cronSecret}`, 'x-gridex-internal-debug': 'true' } : {}) }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  },
  action: callServerAction,
  read: psqlRows,
  deliver: async ({ mailbox, raw, internetMessageId }) => {
    const transport = nodemailer.createTransport({ ...mailbox.smtp,
      auth: { user: mailbox.smtp.user, pass: mailbox.smtp.password },
      tls: { rejectUnauthorized: true, ca: readFileSync(mailbox.tlsCaPath) } })
    try {
      const result = await transport.sendMail({ envelope: { from: mailbox.mailboxAddress, to: [mailbox.mailboxAddress] },
        raw: Buffer.from(`From: ${mailbox.mailboxAddress}\r\nTo: ${mailbox.mailboxAddress}\r\nMessage-ID: ${internetMessageId}\r\nDate: ${new Date().toUTCString()}\r\nMIME-Version: 1.0\r\nContent-Type: application/edifact\r\n\r\n${raw}`) })
      if (result.rejected.length || !result.accepted.includes(mailbox.mailboxAddress)) throw Error('pilot_smtp_delivery_unconfirmed')
    } finally { transport.close() }
  },
}

/** Same main-source network archive/review contract as the native helper, with
 * owned scoped ports instead of that helper's fixed 54321/54322 endpoints. */
export async function qualifyPilotNetworkSource(input: {
  companyId: string; session: AppSession; reviewer: AppSession; authority: PilotTestAuthority
  catalog: { networkActorId: string; networkKeyId: string; networkRepresentationId: string }
  pdf: Buffer; reference: string; version: string; validFrom: string; validUntil: string
  clause: { locator: string; quote: string }
}, ports: PilotPorts = actualPorts) {
  if (input.session.userId === input.reviewer.userId || ![input.session, input.reviewer].every(s => s.actorProof?.intent === 'authorized'
    && s.actorProof.companyId === input.companyId && s.actorProof.selectedCompanyVerified)) throw Error('pilot_network_independent_actors_required')
  const base = { environment: 'test', networkActorId: input.catalog.networkActorId, validFrom: input.validFrom, validUntil: input.validUntil,
    source: { bytesBase64: input.pdf.toString('base64'), mimeType: 'application/pdf', reference: input.reference, version: input.version } }
  const claims = ports.read(`SELECT gridex_network_registry_sources.claims_v1(${lit(input.companyId)},${lit(JSON.stringify(base))}::jsonb) AS claims`)
  if (claims.length !== 1 || !claims[0].claims) throw Error('pilot_network_claims_unqualified')
  const sourceHash = hash(input.pdf), payload = Buffer.from(JSON.stringify({ format: 'ediel_network_registry_receipt_v1',
    receiptId: randomUUID(), claims: claims[0].claims, sourceHash, sourceReference: input.reference, sourceVersion: input.version,
    registryVersion: input.authority.networkRegistryVersion, clause: input.clause,
    issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300_000).toISOString() }))
  const submission = { ...base, issuerReceipt: { keyId: input.catalog.networkKeyId, representationId: input.catalog.networkRepresentationId,
    payloadBase64: payload.toString('base64'), signatureHex: createHmac('sha256', Buffer.from(input.authority.networkKeyHex, 'hex')).update(payload).digest('hex') } }
  const archive = await ports.http(input.session, '/api/ediel/network-registry-sources', submission)
  const artifact = object(archive.body)
  if (archive.status !== 201 || artifact.status !== 'archived' || artifact.sourceHash !== sourceHash
    || !/^[a-f0-9]{64}$/.test(String(artifact.claimsHash))) throw Error('pilot_network_archive_unconfirmed')
  const artifactId = id(artifact.artifactId)
  const review = await ports.http(input.reviewer, `/api/ediel/network-registry-sources/${artifactId}/review`, {
    sourceHash, claimsHash: artifact.claimsHash, decision: 'approve', clause: input.clause,
    reason: 'Explicit synthetic registry verifier configuration; NOT external competence/legal acceptance',
  })
  const result = object(review.body)
  if (review.status !== 200 || result.status !== 'authorized' || result.artifactId !== artifactId) throw Error('pilot_network_review_unconfirmed')
  return { artifactId, registryVersionId: id(result.registryVersionId), sourceHash, claimsHash: artifact.claimsHash,
    legalAcceptance: 'NOT_PROVEN_SYNTHETIC_ISSUER' as const }
}

function requireAction(result: ServerActionResult, redirect?: string) {
  if (result.httpStatus !== 200 || result.threw || result.errorRows.length || (redirect ? !result.redirect?.startsWith(redirect) : result.redirect !== null)) throw Error('pilot_action_unconfirmed_no_retry')
}

/** Executes real app routes and SMTP by default. Finite ports are only for
 * component tests; returned evidence never claims whole/native PASS. */
export async function runPreparedTerm0203Pilot(input: PilotInput, ports: PilotPorts = actualPorts) {
  const { contract: c, session, reviewer, platform, mailbox } = input
  if (input.groundDeclaration !== 'SYNTHETIC_NOT_EXTERNAL_LEGAL_ACCEPTANCE' || reviewer.userId === session.userId
    || ![session, reviewer].every(s => s.actorProof?.intent === 'authorized' && s.actorProof.companyId === c.companyId
      && s.actorProof.selectedCompanyVerified) || session.userId !== c.tenant.admin.userId) throw Error('pilot_independent_scoped_actors_required')
  if (mailbox.schema !== 'gridex-t2-pilot-mailbox-service-v1' || mailbox.state !== 'SERVICE_READY'
    || mailbox.smtp.secure !== true || mailbox.imap.secure !== true || !mailbox.mailboxAddress.endsWith('@t2.sim.invalid')
    || mailbox.assignmentSha256 !== session.actorProof!.assignmentSha256 || mailbox.sourceCommit !== session.actorProof!.sourceCommit
    || mailbox.environmentId !== session.actorProof!.environmentId) throw Error('pilot_mailbox_binding_required')
  const bounds = stockholmMonthBoundsUtc(input.billingMonth)
  const intervals = input.expectedIntervals
  if (!/^\d{4}-\d{2}$/.test(input.billingMonth) || !intervals.length || intervals.some((v, i) => v.kwh !== '0'
    || Date.parse(v.end) - Date.parse(v.start) !== 3_600_000 || i > 0 && Date.parse(intervals[i - 1].end) !== Date.parse(v.start))
    || Date.parse(intervals[0].start) !== bounds.startMs || Date.parse(intervals.at(-1)!.end) !== bounds.endMs) throw Error('pilot_zero_full_month_required')
  const post = async (actor: AppSession, route: string, body: unknown) => {
    let response
    try { response = await ports.http(actor, route, body) } catch { throw Error('pilot_http_transport_uncertain_no_retry') }
    if (response.status !== 200 && response.status !== 201) throw Error(`pilot_app_refused:${route}:${response.status}`)
    return object(response.body)
  }
  const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f }
  const mailboxName = `TERM02.03-${c.tenant.runId}`
  requireAction(await ports.action(platform, { route: '/admin/inbound-mail', filename: 'app/admin/inbound-mail/actions.ts',
    exportedName: 'saveSharedMailboxProfileAction', worker: 'app/admin/inbound-mail/page', args: [form({
      environment: 'test', mailbox_name: mailboxName, email_address: mailbox.mailboxAddress,
      imap_host: mailbox.imap.host, imap_port: String(mailbox.imap.port), imap_secure: 'on', username: mailbox.imap.user,
      secret_reference: 'env:SIM_PILOT_MAILBOX_PASSWORD', imap_folder: 'INBOX', smtp_host: mailbox.smtp.host,
      smtp_port: String(mailbox.smtp.port), smtp_secure: 'on', smtp_from: mailbox.mailboxAddress,
      smtp_username: mailbox.smtp.user, smtp_secret_reference: 'env:SIM_PILOT_MAILBOX_PASSWORD',
    })] }))
  const boxes = ports.read(`SELECT id,email_address,imap_host,imap_port,username,secret_reference,metadata FROM public.ediel_mailboxes WHERE company_id IS NULL AND environment='test' AND is_active AND mailbox_name=${lit(mailboxName)}`)
  if (boxes.length !== 1 || boxes[0].email_address !== mailbox.mailboxAddress || boxes[0].imap_host !== mailbox.imap.host
    || Number(boxes[0].imap_port) !== mailbox.imap.port || boxes[0].username !== mailbox.imap.user
    || boxes[0].secret_reference !== 'env:SIM_PILOT_MAILBOX_PASSWORD' || object(boxes[0].metadata).imap_secure !== true) throw Error('pilot_app_mailbox_readback_failed')
  const mailboxId = id(boxes[0].id)
  // An ordinary cron poll performs the real app's TLS/auth connection test.
  // Cron credentials are intentionally owned by the caller, never exported.
  const poll = async () => {
    const result = await post(platform, `/api/internal/inbound-mail/cron?environment=test&mailbox_id=${mailboxId}&force=1`, {})
    const observed = object(result.result), debug = object(observed.debug)
    if (result.ok !== true || observed.mailboxesChecked !== 1 || Number(observed.failedJobs) !== 0
      || debug.configurationError || !Array.isArray(debug.errorsByMailbox) || debug.errorsByMailbox.some(v => object(v).errors && (object(v).errors as unknown[]).length)
      || !Array.isArray(debug.autoProcessErrors) || debug.autoProcessErrors.length) throw Error('pilot_imap_poll_unconfirmed')
  }
  await poll()
  const selector = { environment: 'test', kind: 'assigned_supply', contractId: c.contractId,
    meteringPointId: c.meteringPointId, identityAgency: '9', bilateralAgreementId: input.bilateralAgreementId, startAt: input.startAt }
  const scope = await post(session, '/api/ediel/regulated-supply-sources/scope', selector)
  const actualScope = object(scope.scope)
  if (scope.status !== 'scoped' || actualScope.companyId !== c.companyId || actualScope.contractId !== c.contractId
    || actualScope.meteringPointId !== c.meteringPointId || !/^[a-f0-9]{64}$/.test(String(scope.scopeHash))) throw Error('pilot_regulated_scope_unqualified')
  const sourceHash = hash(input.groundPdf)
  const archived = await post(session, '/api/ediel/regulated-supply-sources', { ...selector,
    source: { bytesBase64: input.groundPdf.toString('base64'), mimeType: 'application/pdf', reference: input.issuer.sourceReference, version: input.issuer.sourceVersion },
    issuerReceipt: signPilotGround({ scope: actualScope, issuer: input.issuer, sourceHash }) })
  if (archived.status !== 'archived' || archived.companyId !== c.companyId || archived.sourceHash !== sourceHash || archived.scopeHash !== scope.scopeHash) throw Error('pilot_ground_archive_unconfirmed')
  const artifactId = id(archived.artifactId)
  const reviewed = await post(reviewer, `/api/ediel/regulated-supply-sources/${artifactId}/review`, {
    sourceHash, scopeHash: scope.scopeHash, decision: 'approve', reason: 'Declared synthetic fixture issuer/registry; mechanism qualification only, NOT external legal acceptance',
  })
  if (reviewed.status !== 'authorized' || reviewed.companyId !== c.companyId || reviewed.artifactId !== artifactId
    || reviewed.sourceHash !== sourceHash || reviewed.scopeHash !== scope.scopeHash) throw Error('pilot_independent_ground_review_unconfirmed')
  const tokens: Record<string, string> = { CUSTOMER_IDENTITY: String(actualScope.customerIdentity), GRID_AREA_CODE: String(actualScope.gridArea), GSRN: c.gsrn, CUSTOMER_ID: c.customerId, CONTRACT_ID: c.contractId,
    DSO_EDIEL_ID: c.tenant.edielReceiver, SUPPLIER_EDIEL_ID: c.tenant.edielSender }
  const receive = async (template: string, code: 'Z04' | 'E66') => {
    const raw = template.replace(/\{\{([A-Z_]+)\}\}/g, (_match, key: string) => {
      if (!tokens[key]) throw Error('pilot_unknown_wire_token'); return tokens[key]
    })
    if (!raw.includes(c.gsrn) || !raw.includes(code) || raw.includes('{{')) throw Error('pilot_original_scope_invalid')
    const internetMessageId = `<${randomUUID()}@t2.sim.invalid>`
    try { await ports.deliver({ mailbox, raw, internetMessageId }) } catch { throw Error('pilot_smtp_transport_uncertain_no_retry') }
    await poll()
    const originals = ports.read(`SELECT m.id,m.company_id,m.message_code,m.raw_payload,m.inbound_email_message_id,mail.processing_status AS mail_processing_status FROM public.ediel_messages m JOIN public.inbound_email_messages mail ON mail.id=m.inbound_email_message_id WHERE m.company_id=${lit(c.companyId)} AND mail.internet_message_id=${lit(internetMessageId)}`)
    if (originals.length !== 1 || originals[0].company_id !== c.companyId || originals[0].message_code !== code
      || originals[0].raw_payload !== raw || !originals[0].inbound_email_message_id) throw Error('pilot_received_original_unconfirmed')
    if (originals[0].mail_processing_status === 'manual_review') {
      requireAction(await ports.action(platform, { route: '/admin/inbound-mail', filename: 'app/admin/inbound-mail/actions.ts', exportedName: 'reprocessInboundEmailAction', worker: 'app/admin/inbound-mail/page', args: [form({ id: id(originals[0].inbound_email_message_id) })] }))
    }
    return id(originals[0].id)
  }
  const supplyMessageId = await receive(input.z04, 'Z04')
  const supplies = ports.read(`SELECT p.id,gridex_received_sources.billing_supply_basis_v1(p.company_id,p.id,${lit(intervals[0].start)}::timestamptz,${lit(intervals.at(-1)!.end)}::timestamptz) AS basis FROM public.customer_supply_periods p WHERE p.company_id=${lit(c.companyId)} AND p.customer_id=${lit(c.customerId)} AND p.metering_point_id=${lit(c.meteringPointId)} AND p.source_message_id=${lit(supplyMessageId)}`)
  if (supplies.length !== 1 || object(supplies[0].basis).qualified !== true) throw Error('pilot_ordinary_supply_unqualified')
  const supplyPeriodId = id(supplies[0].id), meteringMessageIds: string[] = []
  for (const raw of input.e66) meteringMessageIds.push(await receive(raw, 'E66'))
  const values = ports.read(`SELECT id,period_start,period_end,quantity_kwh::text AS kwh,source_message_id,supply_period_id,billing_status,billing_gate_status FROM public.normalized_metering_values WHERE company_id=${lit(c.companyId)} AND metering_point_id=${lit(c.meteringPointId)} AND revision_status='current' ORDER BY period_start,id`)
  if (values.length !== intervals.length || values.some((v, i) => !meteringMessageIds.includes(String(v.source_message_id))
    || v.supply_period_id !== supplyPeriodId || Number(v.kwh) !== 0 || v.billing_status !== 'billable' || v.billing_gate_status !== 'eligible'
    || Date.parse(String(v.period_start)) !== Date.parse(intervals[i].start) || Date.parse(String(v.period_end)) !== Date.parse(intervals[i].end))) throw Error('pilot_received_zero_intervals_unqualified')
  await post(session, '/api/internal/billing/generate-underlay', { billing_month: input.billingMonth })
  const underlays = ports.read(`SELECT id,status,readiness_status FROM public.billing_underlays WHERE company_id=${lit(c.companyId)} AND customer_id=${lit(c.customerId)} AND underlay_year=${Number(input.billingMonth.slice(0, 4))} AND underlay_month=${Number(input.billingMonth.slice(5))}`)
  if (underlays.length !== 1 || underlays[0].status !== 'validated' || underlays[0].readiness_status !== 'ready') throw Error('pilot_underlay_not_ready')
  const underlayId = id(underlays[0].id)
  const bindings = ports.read(`SELECT b.underlay_id,b.source_basis_hash,encode(sha256(convert_to(b.source_basis::text,'UTF8')),'hex') AS actual_hash,b.exact_total_kwh::text AS exact_total_kwh,b.finalized_at,u.supply_period_id,
    (gridex_received_sources.billing_supply_basis_v1(b.company_id,u.supply_period_id,(b.source_basis->>'start')::timestamptz,(b.source_basis->>'end')::timestamptz)=b.source_basis->'supply') AS supply_current
    FROM gridex_billing_source.underlay_bindings b JOIN public.billing_underlays u ON u.id=b.underlay_id AND u.company_id=b.company_id
    WHERE b.company_id=${lit(c.companyId)} AND b.underlay_id=${lit(underlayId)}`)
  if (bindings.length !== 1 || bindings[0].underlay_id !== underlayId || !/^[a-f0-9]{64}$/.test(String(bindings[0].source_basis_hash))
    || bindings[0].source_basis_hash !== bindings[0].actual_hash || !bindings[0].finalized_at || Number(bindings[0].exact_total_kwh) !== 0
    || bindings[0].supply_period_id !== supplyPeriodId || bindings[0].supply_current !== true) throw Error('pilot_finalized_underlay_source_mismatch')
  // The actual main read gate rechecks source-copy availability, exact finalized
  // total/hash and current supply. A refusal propagates; no replacement basis.
  ports.read(`SELECT gridex_billing_source.require_underlay_v1(${lit(c.companyId)},${lit(underlayId)})`)
  const preview = object((await post(session, '/api/internal/pricing/preview', { billing_underlay_id: underlayId, persist: true })).data) as unknown as PreviewData
  if (preview.status !== 'success' || !preview.pricingRunId || preview.errors.length) throw Error('pilot_persisted_pricing_unconfirmed')
  const terms = { ...readContractTerms(c), invoiceFeeSek: c.sources.contractRow.invoice_fee_sek == null ? null : String(c.sources.contractRow.invoice_fee_sek) }
  // Every signed flat fee must be represented; never drop invoice_fee_sek=19
  // merely because the component snapshot omitted it.
  if (Number(terms.monthlyFeeSek) !== 39 || Number(c.sources.contractRow.monthly_fee_sek) !== 39
    || Number(terms.invoiceFeeSek) !== Number(c.sources.contractRow.invoice_fee_sek)) throw Error('pilot_signed_fee_snapshot_gap')
  for (const key of ['start_fee_sek', 'admin_fee_sek', 'green_fee_value', 'discount_value']) {
    if (Number(c.sources.contractRow[key] ?? 0) !== 0) throw Error('pilot_additional_signed_component_requires_oracle')
  }
  const oracle = oracleAllModes({ intervals: intervals.map(() => ({ kwh: '0', price: '0' })), terms })
  if (new Set(Object.values(oracle).map(v => `${v.totalExVatOre}/${v.totalVatOre}/${v.totalIncVatOre}`)).size !== 1) throw Error('pilot_rounding_policy_needed')
  const expected = oracle.half_away, actualLines = appLinesOre(preview)
  const expectedNonzero = expected.lines.filter(v => v.exVatOre !== BigInt(0) || v.vatOre !== BigInt(0))
  if (actualLines.filter(v => v.exVatOre !== BigInt(0) || v.vatOre !== BigInt(0)).length !== expectedNonzero.length) throw Error('pilot_unexpected_pricing_line')
  for (const line of expectedNonzero) {
    const found = actualLines.filter(v => v.kind === line.code)
    if (found.length !== 1 || found[0].exVatOre !== line.exVatOre || found[0].vatOre !== line.vatOre) throw Error('pilot_pricing_line_mismatch')
  }
  if (sekNumberToOre(preview.totalExVat) !== expected.totalExVatOre || sekNumberToOre(preview.vatAmount) !== expected.totalVatOre
    || sekNumberToOre(preview.totalIncVat) !== expected.totalIncVatOre) throw Error('pilot_pricing_total_mismatch')
  await post(session, '/api/internal/pricing/lock-preview', { pricing_run_id: preview.pricingRunId })
  // Nordfin/test is selectable for local draft preparation on actual main.
  // No ClientId, dispatch enablement, approval, export file or send is requested.
  const catalog = ports.read("SELECT provider,selectable FROM public.invoice_provider_catalog WHERE provider='nordfin'")
  if (catalog.length !== 1 || catalog[0].provider !== 'nordfin' || catalog[0].selectable !== true) throw Error('pilot_nordfin_test_not_selectable')
  requireAction(await ports.action(session, { route: '/admin/billing/integrations', filename: 'app/admin/billing/integrations/actions.ts',
    exportedName: 'selectInvoiceProviderAction', worker: 'app/admin/billing/integrations/page',
    args: [form({ provider: 'nordfin', environment: 'test' })] }), '/admin/billing/integrations?provider=selected')
  const providers = ports.read(`SELECT invoice_export_target_system,billing_provider_environment,invoice_export_enabled FROM public.companies WHERE id=${lit(c.companyId)}`)
  if (providers.length !== 1 || providers[0].invoice_export_target_system !== 'nordfin' || providers[0].billing_provider_environment !== 'test' || providers[0].invoice_export_enabled !== false) throw Error('pilot_nordfin_draft_selection_unconfirmed')
  const draft = await post(session, '/api/internal/invoice-exports/create', { companyId: c.companyId, billing_month: input.billingMonth })
  const prepared = object(draft.data)
  if (draft.mode !== 'prepare_only' || draft.approval_required !== true || prepared.created !== 1 || prepared.failed !== 0 || prepared.blocked !== 0) throw Error('pilot_invoice_draft_unconfirmed')
  const runs = ports.read(`SELECT id,status,locked_at,total_ex_vat,vat_amount,total_inc_vat FROM public.pricing_runs WHERE company_id=${lit(c.companyId)} AND id=${lit(preview.pricingRunId)} AND billing_underlay_id=${lit(underlayId)}`)
  const storedLines = ports.read(`SELECT line_type,amount_ex_vat,vat_amount,amount_inc_vat,metadata FROM public.pricing_preview_lines WHERE company_id=${lit(c.companyId)} AND pricing_run_id=${lit(preview.pricingRunId)} ORDER BY sort_order,id`)
  const invoices = ports.read(`SELECT id,status,invoice_export_item_id,amount_ex_vat,vat_amount,amount_inc_vat,calculation_snapshot,calculation_snapshot_sha256 FROM public.customer_invoices WHERE company_id=${lit(c.companyId)} AND customer_id=${lit(c.customerId)} AND billing_underlay_id=${lit(underlayId)}`)
  const totalsMatch = (r: Row, ex: string, vat: string, inc: string) => sekNumberToOre(Number(r[ex])) === expected.totalExVatOre && sekNumberToOre(Number(r[vat])) === expected.totalVatOre && sekNumberToOre(Number(r[inc])) === expected.totalIncVatOre
  if (runs.length !== 1 || runs[0].status !== 'locked' || !runs[0].locked_at || !totalsMatch(runs[0], 'total_ex_vat', 'vat_amount', 'total_inc_vat')) throw Error('pilot_stored_locked_pricing_mismatch')
  if (invoices.length !== 1 || invoices[0].status !== 'draft' || !totalsMatch(invoices[0], 'amount_ex_vat', 'vat_amount', 'amount_inc_vat')
    || !/^[a-f0-9]{64}$/.test(String(invoices[0].calculation_snapshot_sha256))) throw Error('pilot_stored_invoice_mismatch')
  const exports = ports.read(`SELECT item.id,item.provider,item.environment,item.status,item.attempt_count,item.sent_at,item.export_file_id,item.provider_invoice_id,run.status AS run_status,item.metadata#>>'{approval,status}' AS approval_status FROM public.invoice_export_items item JOIN public.invoice_export_runs run ON run.id=item.export_run_id AND run.company_id=item.company_id WHERE item.company_id=${lit(c.companyId)} AND item.billing_underlay_id=${lit(underlayId)} AND item.pricing_run_id=${lit(preview.pricingRunId)} AND item.customer_contract_id=${lit(c.contractId)}`)
  const attempts = ports.read(`SELECT count(*)::integer AS count FROM public.invoice_export_attempts WHERE company_id=${lit(c.companyId)}`)
  if (exports.length !== 1 || exports[0].id !== invoices[0].invoice_export_item_id || exports[0].provider !== 'nordfin' || exports[0].environment !== 'test'
    || exports[0].status !== 'pending' || exports[0].run_status !== 'draft' || exports[0].approval_status !== 'pending_review' || Number(exports[0].attempt_count) !== 0
    || exports[0].sent_at != null || exports[0].export_file_id != null || exports[0].provider_invoice_id != null || attempts.length !== 1 || attempts[0].count !== 0) throw Error('pilot_invoice_not_unsent_pending_review')
  const calculation = object(invoices[0].calculation_snapshot)
  if (calculation.customer_contract_id !== c.contractId || calculation.billing_underlay_id !== underlayId
    || calculation.pricing_run_id !== preview.pricingRunId || !Array.isArray(calculation.pricing_lines) || !calculation.pricing_lines.length) throw Error('pilot_stored_invoice_lines_missing')
  const assertStoredLines = (rows: Row[], invoice: boolean) => {
    const nonzero = rows.filter(v => Number(v[invoice ? 'amountSekExVat' : 'amount_ex_vat']) !== 0 || Number(v[invoice ? 'vatAmount' : 'vat_amount']) !== 0)
    if (nonzero.length !== expectedNonzero.length) throw Error('pilot_stored_fee_lines_mismatch')
    for (const expectedLine of expectedNonzero) {
      const found = nonzero.filter(v => object(v.metadata).component_code === expectedLine.code)
      if (found.length !== 1 || sekNumberToOre(Number(found[0][invoice ? 'amountSekExVat' : 'amount_ex_vat'])) !== expectedLine.exVatOre
        || sekNumberToOre(Number(found[0][invoice ? 'vatAmount' : 'vat_amount'])) !== expectedLine.vatOre) throw Error('pilot_stored_fee_lines_mismatch')
    }
  }
  assertStoredLines(storedLines, false)
  assertStoredLines(calculation.pricing_lines as Row[], true)
  return { scenarioId: 'TERM02.03', state: 'APP_PATH_AND_STORED_EFFECTS_OBSERVED_NOT_WHOLE_ACCEPTANCE' as const,
    invoiceId: id(invoices[0].id), companyId: c.companyId, contractId: c.contractId, artifactId, supplyMessageId, supplyPeriodId, meteringMessageIds,
    underlayId, underlaySourceBasisSha256: bindings[0].source_basis_hash, pricingRunId: preview.pricingRunId, monthlyLineOre: '3900', monthlyVatOre: '975', provider: 'nordfin', providerEnvironment: 'test', providerTransmission: 'NOT_REQUESTED_DRAFT_ONLY',
    expectedInvoiceExVatOre: expected.totalExVatOre.toString(), expectedInvoiceVatOre: expected.totalVatOre.toString(),
    expectedInvoiceIncVatOre: expected.totalIncVatOre.toString(), legalAcceptance: 'NOT_PROVEN_SYNTHETIC_ISSUER' as const }
}
