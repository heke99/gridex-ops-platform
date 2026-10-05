// SC012's single database. Definitions are selected byte-for-byte from the
// current schema. This is a finite source/auth/provider fixture, not native
// replay, protected custody, trigger coverage or authentic issuer evidence.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
const hash = value => createHash('sha256').update(value).digest('hex')
const functions = [
  'gridex_received_sources.wire_tokens_bounded_v1',
  'gridex_received_sources.closure_wire_tokens_v2',
  'gridex_received_sources.permission_date_v1',
  'gridex_received_sources.permission_time_v1',
  'gridex_received_sources.permission_wire_v1',
  'gridex_received_sources.permission_partition_wire_v1',
  'gridex_received_sources.supply_wire_v1',
  'gridex_received_sources.normal_switch_wire_v1',
  'gridex_received_sources.supply_wire_for_scope_v1',
  'gridex_received_sources.validate_prodat_application_v1',
  'gridex_received_sources.validate_prodat_application_v2',
  'gridex_received_sources.require_prodat_application_objects_v1',
  'gridex_received_sources.prodat_application_object_accepted_v1',
  'gridex_received_sources.require_supply_scope_admission_v1',
  'gridex_received_sources.sent_source_is_current_v1',
  'gridex_received_sources.production_contract_hash_v1',
  'gridex_received_sources.apply_permission_group_v1',
  'public.ediel_apply_permission_source_v1',
  'gridex_received_sources.normal_switch_scope_effect_v1',
  'gridex_ediel_ack_replay.lock_current_graph_v2',
  'gridex_regulated_supply.lock_graph_v1',
  'gridex_bilateral_prodat.lock_graph_v1',
  'gridex_bilateral_prodat.lock_source_receipts_v1',
  'gridex_bilateral_prodat.lock_closure_v1',
  'gridex_bilateral_prodat.lock_supply_v1',
  'gridex_supply_rescission.lock_v1',
  'gridex_supply_rescission.lock_original_v1',
  'gridex_supply_rescission.has_end_selector_v1',
  'gridex_bilateral_prodat.apply_supply_before_h_v1',
  'gridex_bilateral_prodat.apply_supply_before_h_end_v1',
  'gridex_bilateral_prodat.apply_supply_before_closure_v1',
  'gridex_supply_rescission.apply_supply_before_rescission_v1',
  'public.ediel_apply_supply_source_v1',
]

function definition(name) {
  const start = schema.indexOf(`CREATE FUNCTION ${name}(`)
  if (start < 0) throw Error(`Missing current function ${name}`)
  const marker = /\bAS (\$[\w]*\$)/.exec(schema.slice(start))
  if (!marker) throw Error(`Missing SQL body ${name}`)
  const end = schema.indexOf(`${marker[1]};`, start + marker.index + marker[0].length)
  if (end < 0) throw Error(`Unclosed current function ${name}`)
  return schema.slice(start, end + marker[1].length + 1)
}

export async function createDualRoleDatabase() {
  const db = new PGlite()
  try {
    const bodies = functions.map(definition)
    // These tables are the selected effects/facets plus the real current
    // wrapper lock universe. No foreign keys or INSERT triggers are installed;
    // source admission is declared below and never inferred from this replay.
    const tables = new Set([
      'public.customers', 'public.customer_sites', 'public.metering_points',
      'public.customer_contracts', 'public.supplier_switch_requests',
      'public.customer_supply_periods', 'public.ediel_messages',
      'gridex_received_sources.validation_assessments',
      'gridex_received_sources.prodat_application_facets',
      'gridex_received_sources.prodat_response_facets',
      'gridex_received_sources.prodat_source_function_facets',
      'gridex_received_sources.permission_partition_receipts',
      'gridex_received_sources.permission_effect_receipts',
      'gridex_received_sources.supply_object_partitions',
      'gridex_received_sources.supply_object_effect_receipts',
      'gridex_received_sources.supply_source_transitions',
      'gridex_received_sources.normal_switch_confirmations',
    ])
    for (const body of bodies) {
      for (const match of body.matchAll(/(?:public|gridex_[\w]+)\.[\w]+/g)) {
        if (schema.includes(`CREATE TABLE ${match[0]} (`)) tables.add(match[0])
      }
    }
    const viewStart = schema.indexOf('CREATE VIEW gridex_received_sources.permission_effect_transitions_v1 AS\n')
    const viewEnd = schema.indexOf(';', viewStart)
    if (viewStart < 0 || viewEnd < viewStart) throw Error('Missing current permission effect view')
    const namespaces = new Set(['auth', 'gridex_ediel_inbound_context', 'gridex_ediel_source_rules', 'gridex_ediel_transport'])
    for (const name of [...tables, ...functions]) namespaces.add(name.split('.')[0])
    await db.exec('CREATE ROLE service_role; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);')
    for (const name of namespaces) if (!['public', 'auth'].includes(name)) await db.exec(`CREATE SCHEMA ${name};`)
    const tableText = [...tables].map(name => { const start = schema.indexOf(`CREATE TABLE ${name} (`); return schema.slice(start, schema.indexOf('\n);', start) + 3) }).join('\n')
    for (const match of schema.matchAll(/CREATE TYPE ([\w.]+) AS ENUM \([\s\S]*?\n\);/g)) if (tableText.includes(match[1])) {
      await db.exec(`CREATE SCHEMA IF NOT EXISTS ${match[1].split('.')[0]};`)
      await db.exec(match[0])
    }
    const tableDefaults = new Set()
    for (const name of tables) {
      const start = schema.indexOf(`CREATE TABLE ${name} (`), end = schema.indexOf('\n);', start)
      for (const match of schema.slice(start, end).matchAll(/(?:public|gridex_[\w]+)\.[\w]+(?=\()/g)) if (schema.includes(`CREATE FUNCTION ${match[0]}(`)) tableDefaults.add(match[0])
    }
    for (const name of tableDefaults) {
      await db.exec(`CREATE SCHEMA IF NOT EXISTS ${name.split('.')[0]};`)
      if (name === 'gridex_metering_method_changes.requested_method_supported_v1') await db.exec(definition('gridex_metering_method_changes.canonical_tuple_projection_v1'))
      await db.exec(definition(name))
    }
    for (const name of tables) {
      const start = schema.indexOf(`CREATE TABLE ${name} (`), end = schema.indexOf('\n);', start)
      if (start < 0 || end < start) throw Error(`Missing current table ${name}`)
      const body = schema.slice(start, end + 3)
      // Selected serial defaults need their unchanged sequence, if any.
      for (const match of body.matchAll(/nextval\('([^']+)'/g)) {
        const sequenceStart = schema.indexOf(`CREATE SEQUENCE ${match[1]}\n`)
        const sequenceEnd = schema.indexOf(';', sequenceStart)
        if (sequenceStart < 0) throw Error(`Missing sequence ${match[1]}`)
        await db.exec(schema.slice(sequenceStart, sequenceEnd + 1))
      }
      await db.exec(body)
      for (const constraint of schema.matchAll(/ALTER TABLE ONLY ([\w.]+)\n\s+ADD CONSTRAINT [\s\S]*?;/g)) {
        if (constraint[1] === name && /\b(?:PRIMARY KEY|UNIQUE|CHECK)\b/.test(constraint[0]) && !/\bFOREIGN KEY\b/.test(constraint[0])) await db.exec(constraint[0])
      }
    }
    await db.exec(schema.slice(viewStart, viewEnd + 1))
    await db.exec(`
      CREATE TABLE public.sc012_legal_port(source_id uuid PRIMARY KEY, company_id uuid, payload_hash text, basis jsonb);
      CREATE TABLE public.sc012_rule_port(source_id uuid PRIMARY KEY, company_id uuid, payload_hash text, basis jsonb);
      CREATE TABLE public.sc012_provider_port(source_id uuid PRIMARY KEY, payload_hash text);
      CREATE TABLE public.sc012_actor_port(actor_id uuid, company_id uuid, permission text);
      CREATE FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$
        SELECT EXISTS(SELECT FROM public.sc012_actor_port WHERE actor_id=$1 AND company_id=$2 AND permission=$3)$$;
      CREATE FUNCTION gridex_ediel_inbound_context.require_v1(uuid,uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
        DECLARE b jsonb; BEGIN SELECT p.basis INTO b FROM public.sc012_legal_port p JOIN public.ediel_messages m ON m.id=p.source_id AND m.company_id=p.company_id
          WHERE p.company_id=$1 AND p.source_id=$2 AND p.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex');
          IF b IS NULL THEN RAISE EXCEPTION 'SC012_declared_legal_source_unavailable'; END IF; RETURN b; END$$;
      CREATE FUNCTION gridex_ediel_source_rules.require_v1(uuid,uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
        DECLARE b jsonb; BEGIN SELECT p.basis INTO b FROM public.sc012_rule_port p JOIN public.ediel_messages m ON m.id=p.source_id AND m.company_id=p.company_id
          WHERE p.company_id=$1 AND p.source_id=$2 AND p.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex');
          IF b IS NULL THEN RAISE EXCEPTION 'SC012_declared_rule_source_unavailable'; END IF; RETURN b; END$$;
      CREATE FUNCTION gridex_ediel_transport.accepted_source_basis_v1(public.ediel_messages) RETURNS jsonb LANGUAGE sql AS $$
        SELECT jsonb_build_object('sourceMessageId',($1).id,'originalHash',p.payload_hash) FROM public.sc012_provider_port p
          WHERE p.source_id=($1).id AND p.payload_hash=encode(sha256(convert_to(($1).raw_payload,'UTF8')),'hex')$$;
      CREATE FUNCTION public.ediel_require_source_bytes_available_v1(uuid,uuid) RETURNS void LANGUAGE plpgsql AS $$
        BEGIN IF NOT EXISTS(SELECT FROM public.ediel_messages WHERE company_id=$1 AND id=$2 AND raw_payload IS NOT NULL) THEN RAISE EXCEPTION 'SC012_source_bytes_required'; END IF; END$$;
    `)
    for (const body of bodies) await db.exec(body)
    return { db, schemaHash: hash(schema), definitions: Object.fromEntries(functions.map((name, index) => [name, hash(bodies[index])])), tables: [...tables].sort() }
  } catch (error) {
    await db.close()
    throw error
  }
}
