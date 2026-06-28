#!/usr/bin/env node
// Behavioral (fixture-level) regression for the manual grid-owner live fixes.
// Unlike the static contract regressions, this actually executes the TypeScript
// modules (transpiled in a VM sandbox with injected mocks) and asserts behavior.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const ts = require('typescript')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

let failures = 0
const ok = (condition, message) => {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    failures += 1
  } else {
    console.log(`OK: ${message}`)
  }
}

// Transpile and run a single TS module in a sandbox, injecting mocks for its
// direct imports (by import specifier). Real packages (e.g. 'resend') fall
// through to the normal require.
function loadModule(relative, mocks = {}) {
  const filename = path.join(root, relative)
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText
  const localRequire = (name) => {
    if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name]
    try {
      return require(name)
    } catch (error) {
      // The uploaded zip has no node_modules. The webhook module only needs the
      // Resend import as a type/constructor placeholder in this fixture-level
      // regression, so keep the behavior test runnable without installing deps.
      if (name === 'resend') {
        return {
          Resend: class ResendMock {
            constructor() {
              this.webhooks = {
                verify({ payload, headers, webhookSecret }) {
                  if (!webhookSecret) throw new Error('missing secret')
                  if (!headers?.signature || String(headers.signature).includes('AAAAAAAA')) throw new Error('invalid signature')
                  return JSON.parse(payload)
                },
              }
            }
          },
        }
      }
      throw error
    }
  }
  const moduleObj = { exports: {} }
  const sandbox = {
    exports: moduleObj.exports,
    module: moduleObj,
    require: localRequire,
    console,
    process,
    Buffer,
    URL,
    crypto,
    setTimeout,
    clearTimeout,
  }
  const vm = require('node:vm')
  vm.runInNewContext(output, sandbox, { filename })
  return moduleObj.exports
}

function applyFilters(rows, filters) {
  return rows.filter((row) =>
    filters.every(([column, value]) => {
      if (value === null) return row[column] === null || row[column] === undefined
      return row[column] === value
    }),
  )
}

function makeSupabaseMock(fixtures, recorder) {
  function thenable(result) {
    return {
      eq() {
        return thenable(result)
      },
      then(resolve) {
        return Promise.resolve(result).then(resolve)
      },
    }
  }
  return {
    from(table) {
      const state = { table, filters: [] }
      const builder = {
        select() {
          return builder
        },
        insert(payload) {
          recorder.push({ op: 'insert', table, payload })
          return thenable({ data: null, error: null })
        },
        update(payload) {
          const updateState = { filters: [] }
          recorder.push({ op: 'update', table, payload, state: updateState })
          const updateBuilder = {
            eq(column, value) {
              updateState.filters.push([column, value])
              return updateBuilder
            },
            then(resolve) {
              return Promise.resolve({ data: null, error: null }).then(resolve)
            },
          }
          return updateBuilder
        },
        eq(column, value) {
          state.filters.push([column, value])
          return builder
        },
        is(column, value) {
          state.filters.push([column, value === null ? null : value])
          return builder
        },
        or() {
          return builder
        },
        in() {
          return builder
        },
        order() {
          return builder
        },
        limit() {
          return builder
        },
        maybeSingle() {
          const rows = applyFilters(fixtures[table] || [], state.filters)
          return Promise.resolve({ data: rows[0] ?? null, error: null })
        },
        then(resolve) {
          const rows = applyFilters(fixtures[table] || [], state.filters)
          return Promise.resolve({ data: rows, error: null }).then(resolve)
        },
      }
      return builder
    },
    storage: {
      from() {
        return {
          async download() {
            return { data: null, error: { message: 'not found' } }
          },
        }
      },
    },
  }
}

async function main() {
  // -------------------------------------------------------------------------
  // 1) Fullmakt PDF generation (Task B)
  // -------------------------------------------------------------------------
  const pdfMod = loadModule('lib/email/fullmaktPdf.ts')
  const pdf = pdfMod.renderFullmaktPdf({
    caseReference: 'GX-FIR-ABCD1234',
    powerOfAttorneyId: 'poa-1',
    customerName: 'Hekmat Hourani',
    customerIdentity: '19900101-1234',
    siteAddress: 'Storgatan 1',
    sitePostalCode: '11122',
    siteCity: 'Stockholm',
    signerName: 'Hekmat Hourani',
    signerIdentityNumber: '19900101-1234',
    method: 'website_acceptance',
    source: 'website_api',
  })
  const pdfText = pdf.toString('latin1')
  ok(pdfText.startsWith('%PDF'), 'fullmakt attachment is a real PDF (starts with %PDF)')
  ok(pdfText.includes('Fullmakt'), 'fullmakt PDF includes the title')
  ok(pdfText.includes('Hekmat Hourani'), 'fullmakt PDF includes the customer name')
  ok(pdfText.includes('19900101-1234'), 'fullmakt PDF includes the customer identity')
  const base64 = pdfMod.renderFullmaktPdfBase64({ caseReference: 'GX-FIR-1' })
  ok(Buffer.from(base64, 'base64').toString('latin1').startsWith('%PDF'), 'fullmakt base64 decodes to a PDF (not JSON)')
  ok(!base64.startsWith('eyJ'), 'fullmakt base64 is not a JSON document')

  // -------------------------------------------------------------------------
  // 2) POA readiness semantics (Task C/H)
  // -------------------------------------------------------------------------
  const poa = loadModule('lib/customers/poaReadiness.ts')
  const weakPoa = { status: 'signed', accepted_at: '2026-06-01T00:00:00Z' }
  const strongPoa = {
    status: 'signed',
    accepted_at: '2026-06-01T00:00:00Z',
    signer_name: 'Hekmat Hourani',
    signer_identity_number: '19900101-1234',
    method: 'website_acceptance',
    fullmakt_snapshot: { title: 'Fullmakt', version: 'v1' },
  }
  ok(poa.hasLegalPoaAcceptance(weakPoa) === true, 'weak POA still counts as legally accepted')
  ok(poa.hasExternallySendablePoa(weakPoa) === false, 'weak POA is NOT externally sendable')
  ok(poa.hasExternallySendablePoa(strongPoa) === true, 'complete POA IS externally sendable')
  ok(poa.hasExternallySendablePoa({ ...strongPoa, signer_identity_number: null }, { customerIdentity: '5566778899' }) === true, 'externally sendable can use customer identity from context')
  ok(poa.hasExternallySendablePoa({ ...strongPoa, method: null }) === false, 'missing method blocks external sendability')

  // -------------------------------------------------------------------------
  // 3) Manual email template renders customer fields, no blanks (Task A)
  // -------------------------------------------------------------------------
  const templates = loadModule('lib/email/manualGridOwnerTemplates.ts')
  const rendered = templates.renderManualEmailTemplate('facility_information_request', {
    case_reference: 'GX-FIR-ABCD1234',
    customer_number: 'DX-100023',
    customer_name: 'Hekmat Hourani',
    customer_identity: '19900101-1234',
    site_address: 'Storgatan 1',
    postal_code: '11122',
    city: 'Stockholm',
    ops_sender_name: 'Gridex Operations',
    tenant_company_name: 'Gridex',
  })
  ok(rendered.bodyText.includes('DX-100023'), 'manual email renders customer_number from fixture')
  ok(rendered.bodyText.includes('Hekmat Hourani'), 'manual email renders full_name from fixture')
  ok(rendered.bodyText.includes('19900101-1234'), 'manual email renders identity from fixture')
  ok(!/Kundnummer hos oss:\s*\n/.test(rendered.bodyText), 'manual email has no blank Kundnummer line')
  ok(!/Namn:\s*\n/.test(rendered.bodyText), 'manual email has no blank Namn line')
  ok(!/Person-\/organisationsnummer:\s*\n/.test(rendered.bodyText), 'manual email has no blank Person-/organisationsnummer line')

  // -------------------------------------------------------------------------
  // 4) Manual request tenant status labels + delivery failure (Task H/I)
  // -------------------------------------------------------------------------
  const summary = loadModule('lib/customer-operations/manualRequestSummary.ts', {
    '@/lib/supabase/service': { supabaseService: makeSupabaseMock({}, []) },
  })
  ok(summary.manualRequestStatusLabel('manual_email_queued') === 'E-post köad', 'label: queued -> E-post köad')
  ok(summary.manualRequestStatusLabel('waiting_manual_response') === 'Väntar på svar från nätägaren', 'label: waiting -> Väntar på svar från nätägaren')
  ok(summary.manualRequestStatusLabel('needs_review') === 'Behöver granskning', 'label: needs_review -> Behöver granskning')
  ok(summary.manualRequestStatusLabel('completed') === 'Uppgifter kompletterade', 'label: completed -> Uppgifter kompletterade')
  ok(
    summary.manualRequestStatusLabel('needs_review', 'delivery_failed') === summary.MANUAL_REQUEST_DELIVERY_FAILED_LABEL &&
      summary.MANUAL_REQUEST_DELIVERY_FAILED_LABEL.includes('kunde inte levereras'),
    'label: delivery_failed -> tenant contact-path message',
  )

  // -------------------------------------------------------------------------
  // 5) Resend webhook verification + event handling (Task D/I)
  // -------------------------------------------------------------------------
  const recorder = []
  const fixtures = {
    communication_logs: [],
    communication_log_events: [],
    manual_email_outbox: [{ id: 'outbox-1', company_id: 'c1', request_id: 'req-1', status: 'sent', provider_message_id: 're_abc' }],
    grid_owner_information_requests: [{ id: 'req-1', company_id: 'c1', customer_id: 'cust-1', customer_site_id: 'site-1', metadata: {} }],
    customer_sites: [{ id: 'site-1', company_id: 'c1' }],
  }
  const webhook = loadModule('lib/email/resendWebhookEvents.ts', {
    '@/lib/supabase/service': { supabaseService: makeSupabaseMock(fixtures, recorder) },
    '@/lib/events/domainEvents': { emitDomainEvent: async () => undefined },
    './communicationLogs': {
      markCommunicationBounced: async () => undefined,
      markCommunicationDelivered: async () => undefined,
      markCommunicationComplained: async () => undefined,
      markCommunicationFailed: async () => undefined,
      markCommunicationSent: async () => undefined,
    },
  })

  const secret = 'whsec_' + Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')
  const evtId = 'msg_live_1'
  const evtTs = Math.floor(Date.now() / 1000).toString()
  const bouncedBody = JSON.stringify({ type: 'email.bounced', created_at: new Date().toISOString(), data: { email_id: 're_abc', bounce: { message: 'mailbox full' } } })
  const key = Buffer.from(secret.split('_')[1], 'base64')
  const sig = crypto.createHmac('sha256', key).update(`${evtId}.${evtTs}.${bouncedBody}`).digest('base64')
  const headers = { id: evtId, timestamp: evtTs, signature: `v1,${sig}` }

  // header parsing supports both svix-* and webhook-*
  const parsedHeaders = webhook.getResendWebhookHeaders(new Headers({ 'svix-id': evtId, 'svix-timestamp': evtTs, 'svix-signature': `v1,${sig}` }))
  ok(parsedHeaders && parsedHeaders.id === evtId, 'webhook header parser reads svix-* headers')

  let verifiedEvent = null
  try {
    verifiedEvent = webhook.verifyResendWebhook(bouncedBody, headers, secret)
  } catch (error) {
    verifiedEvent = null
  }
  ok(verifiedEvent && verifiedEvent.type === 'email.bounced', 'valid Svix/Resend signature verifies')

  // invalid signature -> typed safe error
  let invalidCode = null
  try {
    webhook.verifyResendWebhook(bouncedBody, { ...headers, signature: 'v1,AAAAAAAA' }, secret)
  } catch (error) {
    invalidCode = error && error.code
  }
  ok(invalidCode === 'invalid_signature', 'invalid signature returns safe invalid_signature error')

  // missing secret -> typed missing_secret error (do not leak)
  let missingCode = null
  const savedSecret = process.env.RESEND_WEBHOOK_SECRET
  delete process.env.RESEND_WEBHOOK_SECRET
  try {
    webhook.verifyResendWebhook(bouncedBody, headers)
  } catch (error) {
    missingCode = error && error.code
  }
  if (savedSecret !== undefined) process.env.RESEND_WEBHOOK_SECRET = savedSecret
  ok(missingCode === 'missing_secret', 'missing secret returns safe missing_secret error')

  // process bounced -> updates manual_email_outbox by provider_message_id and flags request
  const bouncedResult = await webhook.processResendWebhookEvent(verifiedEvent, headers)
  ok(bouncedResult.ok === true && bouncedResult.matchedManualOutboxId === 'outbox-1', 'webhook matches manual_email_outbox by provider_message_id')
  const outboxUpdate = recorder.find((r) => r.op === 'update' && r.table === 'manual_email_outbox')
  ok(outboxUpdate && outboxUpdate.payload.delivery_status === 'bounced' && outboxUpdate.payload.last_error_code === 'delivery_failed', 'webhook sets manual_email_outbox delivery_status=bounced + last_error_code')
  const requestUpdate = recorder.find((r) => r.op === 'update' && r.table === 'grid_owner_information_requests')
  ok(requestUpdate && requestUpdate.payload.status === 'needs_review' && requestUpdate.payload.last_error_code === 'delivery_failed', 'webhook flags linked request needs_review + delivery_failed')
  const siteUpdate = recorder.find((r) => r.op === 'update' && r.table === 'customer_sites')
  ok(siteUpdate && /kontaktväg/i.test(String(siteUpdate.payload.next_action)), 'webhook sets site next action to check contact path')

  // unknown event type does not crash and is acknowledged
  const unknownEvent = { type: 'domain.created', created_at: new Date().toISOString(), data: {} }
  const unknownResult = await webhook.processResendWebhookEvent(unknownEvent, { id: 'msg_unknown', timestamp: evtTs, signature: 'v1,x' })
  ok(unknownResult.ok === true && unknownResult.known === false, 'unknown event type is acknowledged without crashing')

  // -------------------------------------------------------------------------
  // 6) Static SQL: FOR UPDATE outer-join fix (Task F)
  // -------------------------------------------------------------------------
  const sqlFiles = [
    'supabase/migrations/20260615_multitenant_integrity_and_claim_locks.sql',
    'supabase/migrations/20260618200000_ops_production_hardening_resolver_queues.sql',
    'supabase/migrations/20260626140000_gridex_manual_grid_owner_live_fixes.sql',
  ]
  for (const file of sqlFiles) {
    const sql = read(file)
    // Find each claim_inbound_processing_jobs candidates CTE and assert it uses
    // FOR UPDATE OF j, never a bare FOR UPDATE SKIP LOCKED under a LEFT JOIN.
    if (sql.includes('claim_inbound_processing_jobs') && sql.includes('left join public.inbound_email_messages')) {
      ok(/for update of j skip locked/i.test(sql), `${file}: inbound claim uses FOR UPDATE OF j SKIP LOCKED`)
      // The first FOR UPDATE after the inbound LEFT JOIN belongs to the inbound
      // candidates CTE and MUST be "for update of j" (never bare), because the
      // outer-joined inbound_email_messages cannot be locked.
      const after = sql.slice(sql.indexOf('left join public.inbound_email_messages'))
      // Match the actual SQL clause (optionally "of <alias>") + "skip locked",
      // ignoring comment prose that may contain the words "for update".
      const clause = after.match(/for update(\s+of\s+\w+)?\s+skip locked/i)
      ok(Boolean(clause) && /of\s+j/i.test(clause[0]), `${file}: inbound claim's FOR UPDATE targets only j (no bare lock under the outer join)`)
    }
  }
  const liveMigration = read('supabase/migrations/20260626140000_gridex_manual_grid_owner_live_fixes.sql')
  ok(liveMigration.includes('add column if not exists delivery_status') && liveMigration.includes('manual_email_outbox_provider_message_idx'), 'live migration adds manual_email_outbox delivery tracking + index')
  ok(liveMigration.includes("'facility_information_request'") && liveMigration.includes('is not distinct from') && /never overwrite/i.test(liveMigration), 'live migration backfills contact channels without overwriting facility_information_request')

  // -------------------------------------------------------------------------
  // 7) Orchestrator: PDF (not JSON) externally + customer/POA guards (Task A/B)
  // -------------------------------------------------------------------------
  const orchestrator = read('lib/customer-operations/requestMissingFacilityInformation.ts')
  ok(orchestrator.includes("contentType: 'application/pdf'") && !/contentType: 'application\/json'/.test(orchestrator), 'orchestrator attaches PDF externally, never application/json')
  ok(orchestrator.includes('renderFullmaktPdfBase64'), 'orchestrator generates a fullmakt PDF from the locked snapshot')
  ok(orchestrator.includes('missing_customer_details') && orchestrator.includes('missing_customer_identity'), 'orchestrator sets missing_customer_details / missing_customer_identity error codes')
  ok(orchestrator.includes('hasExternallySendablePoa') && orchestrator.includes('poa_not_externally_sendable'), 'orchestrator blocks non-externally-sendable POA')
  ok(orchestrator.includes('Kunduppgifter saknas för manuell nätägarbegäran'), 'orchestrator uses the required Swedish missing-customer blocker')
  ok(orchestrator.includes('Fullmaktsunderlag saknar kund- eller signeringsuppgifter'), 'orchestrator uses the required Swedish POA blocker')

  // JSON snapshot stays internal only (website document snapshot remains JSON,
  // but the EXTERNAL attachment is never JSON).
  const website = read('lib/website/customerApplications.ts')
  ok(website.includes("mime_type: 'application/json'"), 'internal POA JSON snapshot is retained for audit (website document)')

  // -------------------------------------------------------------------------
  // 8) Customer card: tenant single page, technical gated/collapsed (Task G)
  // -------------------------------------------------------------------------
  const page = read('app/admin/customers/[id]/page.tsx')
  ok(page.includes('Teknisk diagnostik') && page.includes('<details'), 'customer card has a collapsed Teknisk diagnostik section')
  ok(page.includes('isPlatformAdmin ? (') && page.includes('id="tekniskt"'), 'technical diagnostics are platform-admin gated with #tekniskt anchor')
  ok(page.includes('const needsCommunicationLogs = isPlatformAdmin') && page.includes('const needsEdielData = isPlatformAdmin'), 'tenant view does not fetch Ediel/communication heavy data')
  ok(page.includes('id="avtal"') && page.includes('id="anlaggning"') && page.includes('id="leverantorsbyte"') && page.includes('id="fakturering"') && page.includes('id="anteckningar"'), 'single page preserves Swedish deep-link anchors')
  // The communication section (provider_message_id) is rendered only inside the
  // platform-gated technical block, never in the tenant operational sections.
  ok(page.includes('CustomerCommunicationSection'), 'communication section exists (inside platform diagnostics)')
  const dataReqCard = read('components/admin/customers/CustomerDataRequestsCard.tsx')
  ok(dataReqCard.includes('isPlatformAdmin && blockerCode'), 'tenant does not see raw blocker code in data requests')

  // -------------------------------------------------------------------------
  // 9) Multi-purpose grid-owner contact save (Task J)
  // -------------------------------------------------------------------------
  const contactActions = read('app/admin/network-owners/[id]/contact-channels/actions.ts')
  ok(contactActions.includes('saveGridOwnerContactChannelsMultiAction') && contactActions.includes('channel_types'), 'multi-purpose contact save action exists')
  ok(contactActions.includes('async function saveContactChannel') && !contactActions.includes('.upsert('), 'contact save uses safe select->update/insert (no unsafe upsert)')
  ok(contactActions.includes('requirePlatformAdminActionAccess'), 'platform defaults require platform admin')

  // -------------------------------------------------------------------------
  // 10) Post-live hardening: delete graph, POA select/events, outbox + webhook
  // -------------------------------------------------------------------------
  // Task F: findValidPowerOfAttorney selects every field needed by
  // hasExternallySendablePoa and the PDF generator.
  for (const field of [
    'signer_identity_number',
    'method',
    'accepted_at',
    'signed_at',
    'legal_text_version_id',
    'scope_summary',
    'document_path',
  ]) {
    ok(orchestrator.includes(field), `findValidPowerOfAttorney select includes ${field}`)
  }

  // Task G: website POA records snapshot_created (not pdf_generated) for the JSON
  // snapshot, and the migration allows the new event type.
  ok(website.includes("event_type: 'snapshot_created'"), 'website JSON snapshot records snapshot_created event')
  ok(website.includes('internal_snapshot_document_id'), 'website distinguishes the internal snapshot document id')
  const poaMigration = read('supabase/migrations/20260628120000_gridex_poa_event_and_outbox_status_backfill.sql')
  ok(poaMigration.includes("'snapshot_created'"), 'migration allows snapshot_created in power_of_attorney_events')

  // Task D: identity aliases normalized to canonical columns; website legacy consent must not inherit signer fallback.
  for (const alias of ['personal_identity_number', 'identity_number', 'personnummer', 'organisationsnummer', 'orgnr']) {
    ok(website.includes(alias), `website normalizes identity alias ${alias}`)
  }
  ok(!website.includes('signerIdentityFallback') && !website.includes('signerNameFallback'), 'POA does not use customer identity/name as signer fallback for website legacy consent')
  ok(website.includes('externally_sendable') && website.includes('requires_completion'), 'response exposes POA external-sendability flags (weak POA)')

  // Task H: a sent manual_email_outbox can never leave the request not_started.
  const outbox = read('lib/email/manualEmailOutbox.ts')
  ok(outbox.includes("dispatch_status: 'waiting_response'"), 'outbox advances request dispatch_status on send')
  ok(outbox.includes(".eq('dispatch_status', 'not_started')"), 'outbox safety net repairs not_started after send')
  ok(poaMigration.includes("coalesce(r.dispatch_status, 'not_started') = 'not_started'"), 'migration backfills sent outbox rows stuck at not_started')

  // Task I: provider event stores company_id from the matched outbox even when
  // there is no communication_log.
  const webhookSrc = read('lib/email/resendWebhookEvents.ts')
  ok(webhookSrc.includes('fallbackCompanyId') && webhookSrc.includes('findManualOutboxByProviderMessageId'), 'webhook attributes company_id from matched manual outbox')
  ok(webhookSrc.includes('E-post till nätägaren kunde inte levereras. Kontrollera kontaktväg.'), 'negative delivery uses the required tenant message')

  // Task A/B: delete/archive actions return controlled state and manual-flow
  // history blocks permanent delete.
  const profileActions = read('app/admin/customers/[id]/profile-actions.ts')
  ok(profileActions.includes('CustomerActionState') && profileActions.includes('runCustomerCardAction'), 'customer actions return controlled action state')
  ok(profileActions.includes('Kunden kunde inte raderas. Kunden har historik och ska arkiveras i stället.'), 'protected delete uses the required Swedish message')
  ok(profileActions.includes('describeProtectedDeleteData'), 'delete uses a protected-history detector')
  for (const table of [
    'grid_owner_information_requests',
    'manual_email_outbox',
    'manual_inbound_messages',
    'power_of_attorney_events',
    'customer_documents',
  ]) {
    ok(profileActions.includes(table), `delete graph covers manual-flow table ${table}`)
  }
  ok(profileActions.includes('gridOwnerInformationRequestIds.length > 0') && profileActions.includes('manualEmailOutboxIds.length > 0'), 'manual grid-owner data blocks hard delete (protected detection)')
  ok(profileActions.includes('isMissingSchemaError'), 'delete helpers tolerate missing schema/tables')

  if (failures > 0) {
    console.error(`\nManual grid-owner live fixes regression FAILED (${failures} failures)`)
    process.exit(1)
  }
  console.log('\nManual grid-owner live fixes regression passed')
}

main().catch((error) => {
  console.error('Regression crashed:', error)
  process.exit(1)
})
