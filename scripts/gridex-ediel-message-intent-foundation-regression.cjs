#!/usr/bin/env node
// Batch 1 regression: EdielMessageIntent foundation.
// Verifies the mandatory intent pipeline is in front of outbound rendering:
// - intent table + intent_id links exist in migration
// - intent engine + render gateway exist with idempotency + validation gate
// - customer-operation modules create intents and never render EDIFACT directly
const fs = require('fs')
const path = require('path')
const root = process.cwd()
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8') }
function assert(ok, msg) { if (!ok) { console.error(`\u2717 ${msg}`); process.exitCode = 1 } else console.log(`\u2713 ${msg}`) }

const migration = read('supabase/migrations/20260625110000_ediel_message_intents_foundation.sql')
const types = read('lib/ediel/intent/types.ts')
const engine = read('lib/ediel/intent/intentEngine.ts')
const gateway = read('lib/ediel/intent/renderGateway.ts')
const outbox = read('lib/ediel/outbox/createOutboxItem.ts')
const db = read('lib/ediel/db.ts')
const shared = read('lib/ediel/flows/shared.ts')
const dispatch = read('lib/customer-operations/facilityLookupEdifactDispatch.ts')
const renderer = read('lib/ediel/intent/renderers/facilityLookupZ01.ts')

// Migration
assert(migration.includes('create table if not exists public.ediel_message_intents'), 'migration creates ediel_message_intents idempotently')
assert(migration.includes('ediel_message_intents_idempotency_uidx') && migration.includes('(company_id, environment, idempotency_key)'), 'migration adds unique idempotency index')
assert(/alter table if exists public\.ediel_messages\s+add column if not exists intent_id uuid/.test(migration), 'migration adds nullable intent_id to ediel_messages')
assert(/alter table if exists public\.ediel_outbox\s+add column if not exists intent_id uuid/.test(migration), 'migration adds nullable intent_id to ediel_outbox')
assert(migration.includes('enable row level security') && migration.includes('gridex_can_read_company') && migration.includes('gridex_can_write_company'), 'intent table has tenant-safe RLS')
assert(!/drop table/i.test(migration), 'migration contains no DROP TABLE (non-destructive)')

// Type
assert(types.includes('export type EdielMessageIntent'), 'EdielMessageIntent type exists')
assert(types.includes("validationStatus") && types.includes('renderStatus') && types.includes('outboxStatus'), 'intent type carries lifecycle statuses')

// Engine
assert(engine.includes('export async function createEdielMessageIntent'), 'intent engine exposes createEdielMessageIntent')
assert(engine.includes('export function evaluateIntentValidation'), 'intent engine exposes pure validation gate')
assert(engine.includes('export async function validateIntentBeforeRender'), 'intent engine exposes validateIntentBeforeRender')
assert(engine.includes("onConflict: 'company_id,environment,idempotency_key'"), 'intent engine upserts idempotently on company+env+idempotency_key')
assert(engine.includes('required_intent_metadata_missing'), 'intent engine validates required metadata')

// Gateway is the sanctioned render path and gates on a validated intent
assert(gateway.includes('renderAndQueueFacilityLookupZ01'), 'render gateway exposes facility lookup entrypoint')
assert(gateway.includes('loadValidatedIntent') && gateway.includes('evaluateIntentValidation'), 'render gateway requires a validated intent before render')
assert(gateway.includes('intentId: params.intentId') && gateway.includes('queuePreparedEdielMessage'), 'render gateway stamps intent_id when queuing outbox')

// intent_id threaded into message + outbox
assert(db.includes('intent_id: input.intentId ?? null'), 'ediel_messages insert persists intent_id')
assert(outbox.includes('intent_id: input.intentId ?? input.message.intent_id ?? null'), 'ediel_outbox row persists intent_id')
assert(shared.includes('intentId?: string | null') && shared.includes('intentId: params.intentId ?? outboxMessage.intent_id ?? null'), 'queuePreparedEdielMessage threads intent_id to outbox')

// Customer operation must NOT render EDIFACT directly
assert(!dispatch.includes('renderProdat26A'), 'facilityLookupEdifactDispatch does not import/call renderProdat26A directly')
assert(!dispatch.includes('buildEdifactEnvelope'), 'facilityLookupEdifactDispatch does not import/call buildEdifactEnvelope directly')
assert(dispatch.includes('createEdielMessageIntent') && dispatch.includes('renderAndQueueFacilityLookupZ01'), 'facilityLookupEdifactDispatch creates intent and calls the render gateway')

// The sanctioned renderer is where rendering happens
assert(renderer.includes('renderProdat26A') && renderer.includes('buildEdifactEnvelope'), 'sanctioned facility renderer owns EDIFACT rendering')

if (process.exitCode) process.exit(process.exitCode)
console.log('\nBatch 1 EdielMessageIntent foundation regression passed.')
