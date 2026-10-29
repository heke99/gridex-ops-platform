import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Full actual manual + publisher + fcb ensure bodies; complete one-DO installer.
// Immutable historical donors below reconstruct the exact observed bacc/0ec
// predecessor, not a mutable GEN snapshot. ROOT metadata-only receipts MP01/03/
// 06/07 qualify the declared headers/private module, no business data fixtures.
// Runtime pricing/save/sync/readiness/actor helpers are explicitly finite
// replacements AFTER installation. They do not attest complete Auth, pricing,
// legal, trigger, provider, native concurrency or managed nonsuperuser execution.
const forward = readFileSync('supabase/migrations/20261020220844_one_off_manual_publication_gate_convergence.sql', 'utf8')
const donorPins: Record<string, string> = {
  "20261011094500_one_off_binding_staff_publish.sql": "91bf87357b2d3226849ebdf6b8d915ce745d95ac8593d4a2a35e91936fbbb2a5",
  "20261015015221_ops_api_manual_contract_binding_legacy_alias_alignment.sql": "de6372aa60398ca6a3711365ad2246b2216889c9833c1c7044fd894405ce53ee",
  "20260727030000_contract_operation_readiness_completion.sql": "29b9b451cb20bdd13906c7260dfa918b1d83c3d69072e4c739b938ce04da3abb",
  "20260720233000_contract_product_lifecycle_go_live_completion.sql": "351ca4b2bf2cabd2f66eda73c0bab3fe4b3044e3f8be730f7d75053e67b064ad",
  "20260716183000_contract_canonical_finalization.sql": "37da788d8e05adf15b177d6c6eed7467f6a86cc81d7932fc3cb9df04b52827e0",
  "20260718010000_canonical_portfolio_pricing_versions.sql": "95a6871deab646478a1dc05332a2efbccdc59d4f4dc78dd4adf4577ec67bf821",
  "20261013112412_ops_api_consumption_vat25_authoring.sql": "0d1eff69cd2cd0a2f347c08417e9ff1b4094a623b1eedc22d02e079cff3ab656",
  "20260727160000_contract_valid_to_active_rpc_repair.sql": "43d23965a8842982e30ff90a4d01b0fb374d898672512ec9611191c5d227372f",
  "20260728170000_live_schema_code_canonical_sync.sql": "4b1af824f75423faa393d60b845d3b39a3998bcfc7d7ea1cec2a54aa8d3bd400",
  "20260730130000_historical_sync_forward_repair.sql": "3e204b00fa33badbfdc7a11c0304df3bc5385b16e0854e40af2df1c06b32b50b",
  "20261010230000_one_off_offer_contract_binding.sql": "8f11ef49c48abc1b0a2fa45e0ef2e61890f7b9fcfee5920cea6a54e475985b7c"
}
const sources = Object.fromEntries(Object.entries(donorPins).map(([path, hash]) => {
  const sql = readFileSync(`supabase/migrations/${path}`, 'utf8')
  if (digest(sql) !== hash) throw new Error(`immutable donor drift: ${path}`)
  return [path.slice(0, 14), sql]
}))
const profiles = [
  {
    "name": "gridex_assert_contract_permission",
    "signature": "public.gridex_assert_contract_permission(uuid, text)",
    "types": "uuid, text",
    "args": [
      "p_actor_user_id",
      "p_permission"
    ],
    "defaults": 0,
    "defaultsHash": null,
    "result": "void",
    "language": "plpgsql",
    "securityDefiner": true,
    "volatility": "v",
    "config": [
      "search_path=public, auth, pg_temp"
    ],
    "hash": "4d842e5cb0a2903a08b718eb34826e08e294c766a7295410a46bc178135cbcb8",
    "acl": [
      [
        "postgres",
        "postgres",
        "EXECUTE",
        false
      ],
      [
        "service_role",
        "postgres",
        "EXECUTE",
        false
      ]
    ]
  },
  {
    "name": "gridex_contract_readiness_blocker_v2",
    "signature": "public.gridex_contract_readiness_blocker_v2(text, text, text, jsonb, text, uuid, jsonb)",
    "types": "text, text, text, jsonb, text, uuid, jsonb",
    "args": [
      "p_code",
      "p_field",
      "p_message",
      "p_current_value",
      "p_resource_type",
      "p_resource_id",
      "p_metadata"
    ],
    "defaults": 4,
    "defaultsHash": "c32b4761412fd5818d44083d80941e5dc6305859ca496086d51238b19d08800a",
    "result": "jsonb",
    "language": "sql",
    "securityDefiner": false,
    "volatility": "i",
    "config": [
      "search_path=public, pg_temp"
    ],
    "hash": "e27ad22e353254369cab98dae37fc42b27eda9a2b9626272dcb710d4506708c6",
    "acl": [
      [
        "authenticated",
        "postgres",
        "EXECUTE",
        false
      ],
      [
        "postgres",
        "postgres",
        "EXECUTE",
        false
      ],
      [
        "service_role",
        "postgres",
        "EXECUTE",
        false
      ]
    ]
  },
  {
    "name": "gridex_create_or_version_contract_pricing",
    "signature": "public.gridex_create_or_version_contract_pricing(uuid, text, text, text, text, jsonb, date, date, boolean, uuid)",
    "types": "uuid, text, text, text, text, jsonb, date, date, boolean, uuid",
    "args": [
      "p_company_id",
      "p_plan_name",
      "p_contract_type",
      "p_pricing_model",
      "p_customer_type",
      "p_snapshot",
      "p_valid_from",
      "p_valid_to",
      "p_publish",
      "p_actor_user_id"
    ],
    "defaults": 4,
    "defaultsHash": "256ce60302569e560973581355ad6c708bd79537c551d080a100066fa082c823",
    "result": "jsonb",
    "language": "plpgsql",
    "securityDefiner": true,
    "volatility": "v",
    "config": [
      "search_path=public, extensions, pg_temp"
    ],
    "hash": "d96198cf05057aede63a12e923c6186d0f4c70a4799a48e9b87846020693d9d7",
    "acl": [
      [
        "postgres",
        "postgres",
        "EXECUTE",
        false
      ],
      [
        "service_role",
        "postgres",
        "EXECUTE",
        false
      ]
    ]
  },
  {
    "name": "gridex_ensure_internal_contract_publication",
    "signature": "public.gridex_ensure_internal_contract_publication(uuid, uuid, uuid)",
    "types": "uuid, uuid, uuid",
    "args": [
      "p_company_id",
      "p_contract_offer_id",
      "p_actor_user_id"
    ],
    "defaults": 1,
    "defaultsHash": "4385a67c7204ff8b2cea0aeef7c4f7a7396230440bad0ad1ec2d0bbe91018a56",
    "result": "uuid",
    "language": "plpgsql",
    "securityDefiner": true,
    "volatility": "v",
    "config": [
      "search_path=public, extensions, pg_temp"
    ],
    "hash": "fcb963b3d282b1f886cbbc5c90c35b34d8d4647c0f4e4e6d6330a55314659984",
    "acl": [
      [
        "postgres",
        "postgres",
        "EXECUTE",
        false
      ],
      [
        "service_role",
        "postgres",
        "EXECUTE",
        false
      ]
    ]
  },
  {
    "name": "gridex_prepare_manual_contract_binding",
    "signature": "public.gridex_prepare_manual_contract_binding(uuid, jsonb, jsonb, uuid)",
    "types": "uuid, jsonb, jsonb, uuid",
    "args": [
      "p_company_id",
      "p_payload",
      "p_pricing_snapshot",
      "p_actor_user_id"
    ],
    "defaults": 1,
    "defaultsHash": "4385a67c7204ff8b2cea0aeef7c4f7a7396230440bad0ad1ec2d0bbe91018a56",
    "result": "jsonb",
    "language": "plpgsql",
    "securityDefiner": true,
    "volatility": "v",
    "config": [
      "search_path=public, pg_temp"
    ],
    "hash": "baccd65df7e303df26aef3516ad8bf7e5faf42d380dd1bae6bcc8205c50ca5ec",
    "acl": [
      [
        "postgres",
        "postgres",
        "EXECUTE",
        false
      ],
      [
        "service_role",
        "postgres",
        "EXECUTE",
        false
      ]
    ]
  },
  {
    "name": "gridex_publish_internal_contract_version",
    "signature": "public.gridex_publish_internal_contract_version(uuid, uuid, uuid)",
    "types": "uuid, uuid, uuid",
    "args": [
      "p_company_id",
      "p_offer_id",
      "p_actor_user_id"
    ],
    "defaults": 0,
    "defaultsHash": null,
    "result": "jsonb",
    "language": "plpgsql",
    "securityDefiner": true,
    "volatility": "v",
    "config": [
      "search_path=public, pg_temp"
    ],
    "hash": "0ec83ae81a9c66c97cdfdb90237acf913d7adbe7326e7fd01de59e690962dd4c",
    "acl": [
      [
        "postgres",
        "postgres",
        "EXECUTE",
        false
      ],
      [
        "service_role",
        "postgres",
        "EXECUTE",
        false
      ]
    ]
  },
  {
    "name": "gridex_sync_internal_offer_to_canonical",
    "signature": "public.gridex_sync_internal_offer_to_canonical(uuid)",
    "types": "uuid",
    "args": [
      "p_offer_id"
    ],
    "defaults": 0,
    "defaultsHash": null,
    "result": "uuid",
    "language": "plpgsql",
    "securityDefiner": true,
    "volatility": "v",
    "config": [
      "search_path=public, extensions, pg_catalog, pg_temp"
    ],
    "hash": "a14bafb58ec5e487b6b7c24cb10217ccd669ead807b3d91ae29e06c2a139886d",
    "acl": [
      [
        "postgres",
        "postgres",
        "EXECUTE",
        false
      ],
      [
        "service_role",
        "postgres",
        "EXECUTE",
        false
      ]
    ]
  },
  {
    "name": "gridex_upsert_internal_contract_offer",
    "signature": "public.gridex_upsert_internal_contract_offer(uuid, uuid, jsonb, jsonb, uuid)",
    "types": "uuid, uuid, jsonb, jsonb, uuid",
    "args": [
      "p_company_id",
      "p_offer_id",
      "p_payload",
      "p_pricing_snapshot",
      "p_actor_user_id"
    ],
    "defaults": 0,
    "defaultsHash": null,
    "result": "jsonb",
    "language": "plpgsql",
    "securityDefiner": true,
    "volatility": "v",
    "config": [
      "search_path=public, pg_temp"
    ],
    "hash": "7e37e58fdaa9d32471e27de9033a8cbac5b6e4574b7c5d47ec2d7a17f22c2f79",
    "acl": [
      [
        "postgres",
        "postgres",
        "EXECUTE",
        false
      ]
    ]
  },
  {
    "name": "gridex_validate_contract_readiness_v2",
    "signature": "public.gridex_validate_contract_readiness_v2(uuid, uuid, text, text)",
    "types": "uuid, uuid, text, text",
    "args": [
      "p_company_id",
      "p_contract_offer_id",
      "p_operation",
      "p_channel"
    ],
    "defaults": 1,
    "defaultsHash": "79d73f5cebbe6c19dca63a8c137158712c447b59ea705adb7b189c0d80ecc6cf",
    "result": "jsonb",
    "language": "plpgsql",
    "securityDefiner": true,
    "volatility": "s",
    "config": [
      "search_path=public, auth, pg_temp"
    ],
    "hash": "baa6718147ed18243630b27b1cf0d2d694691e4c7e238a097c419d68932994ce",
    "acl": [
      [
        "postgres",
        "postgres",
        "EXECUTE",
        false
      ],
      [
        "service_role",
        "postgres",
        "EXECUTE",
        false
      ]
    ]
  }
]
const manual = 'gridex_prepare_manual_contract_binding'
const publisher = 'gridex_publish_internal_contract_version'
const hashes = {
  oldManual: 'baccd65df7e303df26aef3516ad8bf7e5faf42d380dd1bae6bcc8205c50ca5ec',
  newManual: 'dbf492dbb0887519d2683a2442aca9b5c51dfcaf74899fb6ea26a398176b745a',
  oldPublisher: '0ec83ae81a9c66c97cdfdb90237acf913d7adbe7326e7fd01de59e690962dd4c',
  newPublisher: 'e65e9f046b558512e00a89622f5fdffe888dee5a57072982ee4a01292192732a',
}
function digest(s: string) { return createHash('sha256').update(s).digest('hex') }
function definition(sql: string, name: string) {
  const start = sql.search(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`, 'i'))
  if (start < 0) throw new Error(`definition absent: ${name}`)
  const tail = sql.slice(start)
  const tag = /\bas\s+(\$[A-Za-z_0-9]*\$)/i.exec(tail)
  if (!tag) throw new Error('body delimiter absent')
  const begin = tag.index + tag[0].length
  const end = tail.indexOf(tag[1], begin)
  return { ddl: tail.slice(0, end + tag[1].length) + ';', body: tail.slice(begin, end) }
}
function unique(s: string, before: string, after: string) {
  if (!before || s.split(before).length !== 2) throw new Error('immutable unique anchor required')
  return s.replace(before, () => after)
}
function tagged(sql: string, tag: string) {
  const parts = sql.split(`$${tag}$`)
  if (parts.length < 3) throw new Error(`immutable tag absent: ${tag}`)
  return parts[1]
}
function repair(sql: string, signature: string, body: string) {
  const statements = sql.match(/select public\.gridex__\w+\([\s\S]*?\n\);/gi) ?? []
  for (const statement of statements) {
    const tokens = [...statement.matchAll(/\$\$([\s\S]*?)\$\$|'((?:[^']|'')*)'/g)]
      .map(m => m[1] ?? m[2].replaceAll("''", "'"))
    if (tokens[0] === signature) body = unique(body, tokens[1], tokens[2])
  }
  return body
}
const beforeGate = `  -- Staff who may create contracts may sell a one-off contract without the
  -- catalog publish rights: authorize exactly this new offer, for this actor,
  -- in this transaction, and withdraw the authorization right after.
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.create');
  insert into gridex_one_off_offer_binding.publish_authorizations(offer_id,company_id,actor_user_id,txid)
  values (v_offer_id,p_company_id,p_actor_user_id,txid_current());
`
const afterGate = '  delete from gridex_one_off_offer_binding.publish_authorizations where offer_id=v_offer_id;\n'
const canonicalManual = (() => {
  const base = definition(sources['20261011094500'], manual).body
  return unique(base, tagged(sources['20261015015221'], 'alias_anchor'),
    tagged(sources['20261015015221'], 'alias_addition') + tagged(sources['20261015015221'], 'alias_anchor'))
})()
// DECLARED_ROOT_MP09 actual bacc SHA, receipt186da15b…; exact gate removal is
// independently reversible to immutable945+150, leaving all native bridges.
const observedManual = unique(unique(canonicalManual, beforeGate, ''), afterGate, '')
const observedPublisher = definition(sources['20260727030000'], publisher).body
const canonicalPublisher = definition(sources['20261011094500'], publisher).body
const definitions: Record<string, { ddl: string; body: string }> = {}
for (const [name, epoch] of Object.entries({
  gridex_assert_contract_permission: '20260720233000',
  gridex_contract_readiness_blocker_v2: '20260727030000',
  gridex_create_or_version_contract_pricing: '20260718010000',
  gridex_ensure_internal_contract_publication: '20260716183000',
  gridex_prepare_manual_contract_binding: '20261011094500',
  gridex_publish_internal_contract_version: '20260727030000',
  gridex_sync_internal_offer_to_canonical: '20260727160000',
  gridex_upsert_internal_contract_offer: '20260720233000',
  gridex_validate_contract_readiness_v2: '20260727030000',
})) definitions[name] = definition(sources[epoch], name)
for (const [name, index] of [[ 'gridex_create_or_version_contract_pricing', 0 ], [ 'gridex_upsert_internal_contract_offer', 1 ]] as const) {
  definitions[name].body = unique(definitions[name].body,
    tagged(sources['20261013112412'], `anchor${index}`), tagged(sources['20261013112412'], `patch${index}`))
}
definitions.gridex_sync_internal_offer_to_canonical.body = repair(sources['20260728170000'],
  'public.gridex_sync_internal_offer_to_canonical(uuid)', definitions.gridex_sync_internal_offer_to_canonical.body)
definitions.gridex_sync_internal_offer_to_canonical.body = repair(sources['20260730130000'],
  'public.gridex_sync_internal_offer_to_canonical(uuid)', definitions.gridex_sync_internal_offer_to_canonical.body)
definitions[manual].body = observedManual
for (const p of profiles) {
  if (digest(definitions[p.name].body) !== p.hash) throw new Error(`immutable body reconstruction: ${p.name}`)
}
if (digest(canonicalManual) !== hashes.newManual || digest(canonicalPublisher) !== hashes.newPublisher
  || Buffer.byteLength(beforeGate + afterGate) !== 579) throw new Error('canonical recipe mismatch')

const COMPANY = '10000000-0000-0000-0000-000000000001'
const OTHER = '10000000-0000-0000-0000-000000000002'
const ACTOR = '20000000-0000-0000-0000-000000000001'
const FOREIGN_ACTOR = '20000000-0000-0000-0000-000000000002'
let db: PGlite
const foundation = `
create role anon; create role authenticated; create role service_role;
create schema extensions; create schema fixture;
create schema gridex_one_off_offer_binding;
revoke all on schema gridex_one_off_offer_binding from public,anon,authenticated,service_role;
create table public.companies(id uuid primary key);
create table public.customer_contracts(id uuid primary key);
create table public.contract_offers(
 id uuid primary key default gen_random_uuid(), company_id uuid not null, name text,
 lifecycle_status text default 'draft', status text default 'inactive', is_active boolean default false,
 commercial_snapshot jsonb default '{}', customer_type text default 'both', contract_type text default 'variable_hourly',
 valid_from date,valid_to date, price_plan_id uuid,price_plan_version_id uuid,price_book_id uuid,
 contract_product_id uuid,contract_product_version_id uuid,legal_bundle_version_id uuid,version_series_id uuid,
 updated_by uuid,updated_at timestamptz,archived_at timestamptz,superseded_at timestamptz
);
create table public.contract_product_versions(id uuid primary key,contract_product_id uuid,status text,locked_at timestamptz,commercial_snapshot jsonb);
create table public.legal_bundle_versions(id uuid primary key,status text,locked_at timestamptz,unresolved_variables text[],rendered_snapshot jsonb);
create table public.tenant_contract_assignments(id uuid primary key default gen_random_uuid(),company_id uuid,contract_product_version_id uuid,
 internal_sales_allowed boolean,website_publication_allowed boolean,status text,legal_mode text,valid_from date,valid_to date,assigned_by uuid,created_at timestamptz default now());
create table public.tenant_contract_channels(id uuid primary key default gen_random_uuid(),assignment_id uuid,status text,valid_from timestamptz,valid_to timestamptz);
create table public.contract_publications(id uuid primary key default gen_random_uuid(),assignment_id uuid,channel text,status text,created_by uuid,updated_at timestamptz,
 unique(assignment_id,channel));
create table public.contract_publication_versions(id uuid primary key default gen_random_uuid(),contract_publication_id uuid,
 version_number integer,contract_product_version_id uuid,price_plan_id uuid,price_plan_version_id uuid,price_book_id uuid,
 legal_bundle_version_id uuid,legacy_public_contract_offer_id uuid,customer_type text,channel text,valid_from timestamptz,valid_to timestamptz,
 publication_snapshot jsonb,offer_reference text,content_sha256 text,status text,published_at timestamptz,locked_at timestamptz,created_by uuid);
create unique index finite_one_published on public.contract_publication_versions(contract_publication_id) where status='published';
create table public.audit_logs(company_id uuid,actor_user_id uuid,entity_type text,entity_id text,action text,old_values jsonb,new_values jsonb,metadata jsonb);
create table fixture.saved(payload jsonb,pricing jsonb,offer_id uuid);
create function public.digest(text,text) returns bytea language sql immutable as $$select pg_catalog.sha256(pg_catalog.convert_to($1,'UTF8'))$$;
insert into public.companies values('${COMPANY}'),('${OTHER}');
set check_function_bodies=off;
`
const privateTables = [sources['20261010230000'], sources['20261011094500']].map((sql, i) => {
  const table = i ? 'publish_authorizations' : 'reservations'
  const start = sql.indexOf(`create table gridex_one_off_offer_binding.${table} (`)
  const end = sql.indexOf('\n);', start) + 2
  return sql.slice(start, end + 1) + `\nrevoke all on table gridex_one_off_offer_binding.${table} from public,anon,authenticated,service_role;`
}).join('\n')
async function replaceBody(name: string, body: string) {
  const p = profiles.find(p => p.name === name)!
  const row = await db.query<{ ddl: string; body: string }>('select pg_get_functiondef($1::regprocedure) ddl,prosrc body from pg_proc where oid=$1::regprocedure', [p.signature])
  await db.exec(unique(row.rows[0].ddl, row.rows[0].body, body))
}
async function apply() { await db.exec(forward) }
async function catalog() {
  return (await db.query<{ state: unknown }>(`select jsonb_build_object(
    'functions',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p where p.pronamespace in('public'::regnamespace,'gridex_one_off_offer_binding'::regnamespace)),
    'classes',(select jsonb_agg(to_jsonb(c) order by c.oid) from pg_class c where c.relnamespace in('public'::regnamespace,'gridex_one_off_offer_binding'::regnamespace)),
    'constraints',(select jsonb_agg(to_jsonb(c) order by c.oid) from pg_constraint c),
    'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t),
    'policies',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p),
    'roles',(select jsonb_agg(to_jsonb(r) order by r.oid) from pg_roles r),
    'memberships',(select jsonb_agg(to_jsonb(m) order by roleid,member,grantor) from pg_auth_members m),
    'defaults',(select jsonb_agg(to_jsonb(a) order by a.oid) from pg_default_acl a)) state`)).rows[0].state
}
async function bodies() {
  return (await db.query<{ name: string; hash: string }>(`select proname name,encode(sha256(convert_to(prosrc,'UTF8')),'hex') hash from pg_proc where proname in($1,$2) order by proname`, [manual,publisher])).rows
}
async function refused(run: () => Promise<unknown>, message?: string) {
  await db.exec('savepoint refusal')
  let error: { message?: string; code?: string; detail?: string } | undefined
  try { await run() } catch (e) { error = e as typeof error; await db.exec('rollback to savepoint refusal') }
  await db.exec('release savepoint refusal')
  expect(error).toBeDefined()
  if (message) expect(error?.message).toContain(message)
  return error
}
async function installerRefused(mutation: string) {
  await db.exec(mutation)
  const before = await catalog()
  const error = await refused(apply, 'one_off_gate_convergence_')
  expect(error?.code).toBe('55000')
  expect(await catalog()).toEqual(before)
}
async function runtimeHelpers() {
  // These replace only bounded callees after the strict real-source install.
  // Real target manual/publisher/ensure/assert/blocker bodies stay unchanged.
  await db.exec(`
create or replace function public.gridex_contract_actor_has_permission(p_actor_user_id uuid,p_permission text) returns boolean language sql as $$
 select p_actor_user_id is not null and p_actor_user_id::text=current_setting('fixture.actor',true)
 and coalesce(current_setting('fixture.jwt',true),p_actor_user_id::text)=p_actor_user_id::text
 and p_permission=any(string_to_array(current_setting('fixture.permissions',true),',')) $$;
create or replace function public.gridex_upsert_internal_contract_offer(p_company_id uuid,p_offer_id uuid,p_payload jsonb,p_pricing_snapshot jsonb,p_actor_user_id uuid) returns jsonb
 language plpgsql security definer set search_path=public,pg_temp as $$declare v uuid:=gen_random_uuid();pv uuid:=gen_random_uuid();begin
 perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.create');
 perform public.gridex_assert_contract_permission(p_actor_user_id,'pricing.write');
 if jsonb_typeof(p_pricing_snapshot->'price_areas')<>'array' then raise exception 'finite_invalid_price_areas';end if;
 if current_setting('fixture.missing_offer',true)='yes' then return '{}';end if;
 insert into public.contract_offers(id,company_id,name,contract_type,customer_type,commercial_snapshot,price_plan_id,price_plan_version_id,version_series_id,valid_from,valid_to)
 values(v,p_company_id,p_payload->>'name',p_payload->>'contract_type',p_payload->>'customer_type',p_pricing_snapshot,gen_random_uuid(),pv,gen_random_uuid(),nullif(p_payload->>'valid_from','')::date,nullif(p_payload->>'valid_to','')::date);
 insert into fixture.saved values(p_payload,p_pricing_snapshot,v);
 return jsonb_build_object('offer',jsonb_build_object('id',v));end $$;
create or replace function public.gridex_validate_contract_readiness_v2(p_company_id uuid,p_contract_offer_id uuid,p_operation text,p_channel text default null) returns jsonb
 language plpgsql stable security definer set search_path=public,auth,pg_temp as $$begin
 return jsonb_build_object('can_execute',current_setting('fixture.block_readiness',true) is distinct from 'yes','blockers',jsonb_build_array('finite_readiness'));
 end $$;
create or replace function public.gridex_create_or_version_contract_pricing(p_company_id uuid,p_plan_name text,p_contract_type text,p_pricing_model text,p_customer_type text,p_snapshot jsonb,p_valid_from date default null,p_valid_to date default null,p_publish boolean default false,p_actor_user_id uuid default null) returns jsonb
 language plpgsql security definer set search_path=public,extensions,pg_temp as $$declare o public.contract_offers%rowtype;begin
 select * into strict o from public.contract_offers where company_id=p_company_id and name=p_plan_name order by id limit 1;
 if current_setting('fixture.require_capability',true)='yes' and not exists(select 1 from gridex_one_off_offer_binding.publish_authorizations a
 where a.offer_id=o.id and a.company_id=p_company_id and a.actor_user_id is not distinct from p_actor_user_id and a.txid=txid_current()) then raise exception 'finite_exact_capability_missing';end if;
 return jsonb_build_object('price_plan_id',o.price_plan_id,'price_plan_version_id',case when current_setting('fixture.bad_pricing',true)='yes' then gen_random_uuid() else o.price_plan_version_id end,'price_book_id',o.price_book_id);
 end $$;
create or replace function public.gridex_sync_internal_offer_to_canonical(p_offer_id uuid) returns uuid language plpgsql security definer set search_path=public,extensions,pg_catalog,pg_temp as $$declare o public.contract_offers%rowtype;p uuid:=gen_random_uuid();l uuid:=gen_random_uuid();begin
 if current_setting('fixture.sync_legal_error',true)='yes' then raise exception 'internal_offer_legal_documents_not_ready' using errcode='23514';end if;
 select * into strict o from public.contract_offers where id=p_offer_id;
 insert into public.contract_product_versions values(p,gen_random_uuid(),'approved',case when current_setting('fixture.bad_product',true)='yes' then null else now() end,o.commercial_snapshot);
 insert into public.legal_bundle_versions values(l,'published',case when current_setting('fixture.bad_legal',true)='yes' then null else now() end,
 case when current_setting('fixture.unresolved_legal',true)='yes' then array['missing'] else array[]::text[] end,'{"finite":"legal"}');
 update public.contract_offers set contract_product_version_id=p,contract_product_id=(select contract_product_id from public.contract_product_versions where id=p),legal_bundle_version_id=l where id=p_offer_id;
 return p;end $$;
`)
  await db.query("select set_config('fixture.actor',$1,true),set_config('fixture.jwt',$1,true),set_config('fixture.permissions','contracts.create,pricing.write',true),set_config('fixture.require_capability','yes',true)", [ACTOR])
}
async function prepare(payload: Record<string, unknown> = {}, pricing: Record<string, unknown> = { price_area: 'SE3' }) {
  return (await db.query<{ result: Record<string, unknown> }>('select public.gridex_prepare_manual_contract_binding($1,$2::jsonb,$3::jsonb,$4) result',
    [COMPANY, JSON.stringify(payload), JSON.stringify(pricing), ACTOR])).rows[0].result
}
async function business() {
  return (await db.query<{ state: unknown }>(`select jsonb_build_object('offers',(select jsonb_agg(to_jsonb(o) order by id) from public.contract_offers o),
 'publications',(select jsonb_agg(to_jsonb(v) order by id) from public.contract_publication_versions v),
 'audit',(select jsonb_agg(to_jsonb(a)) from public.audit_logs a),'saved',(select jsonb_agg(to_jsonb(s)) from fixture.saved s),
 'capabilities',(select jsonb_agg(to_jsonb(a)) from gridex_one_off_offer_binding.publish_authorizations a),
 'reservations',(select jsonb_agg(to_jsonb(r)) from gridex_one_off_offer_binding.reservations r)) state`)).rows[0].state
}

describe('coherent one-off manual permission gate, actual SQL and strict installer', () => {
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(foundation + privateTables).catch(e => { throw new Error('foundation setup: '+e.message+' position '+e.position) })
    for (const p of profiles) {
      const original = definition(definitions[p.name].ddl,p.name).body
      await db.exec(unique(definitions[p.name].ddl,original,definitions[p.name].body)).catch(e => { throw new Error(p.name+' setup: '+e.message+' position '+e.position) })
      await db.exec(`alter function ${p.signature} set search_path=${p.config[0].slice('search_path='.length)};
        revoke all on function ${p.signature} from public,anon,authenticated,service_role;`)
      for (const grantee of p.acl.map(a => a[0]).filter(a => a !== 'postgres')) await db.exec(`grant execute on function ${p.signature} to ${grantee}`)
    }
  })
  beforeEach(async () => { await db.exec('begin') })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db?.close() })

  it('reconstructs exact immutable observed and canonical bodies, including579 gate bytes and all nine real helper hashes', async () => {
    expect(digest(observedManual)).toBe(hashes.oldManual)
    expect(digest(canonicalManual)).toBe(hashes.newManual)
    expect(digest(observedPublisher)).toBe(hashes.oldPublisher)
    expect(digest(canonicalPublisher)).toBe(hashes.newPublisher)
    expect(unique(unique(canonicalManual,beforeGate,''),afterGate,'')).toBe(observedManual)
    for (const p of profiles) expect(digest(definitions[p.name].body)).toBe(p.hash)
  })
  it('changes only two prosrc values, preserving every OID/header/ACL and the whole protected catalog', async () => {
    const old = await catalog() as { functions: Record<string, unknown>[] }
    await apply()
    const after = await catalog() as typeof old
    expect(await bodies()).toEqual([{ name:manual,hash:hashes.newManual },{ name:publisher,hash:hashes.newPublisher }])
    const normalize = (state: typeof old) => ({ ...state, functions: state.functions.map(p => p.proname===manual || p.proname===publisher ? { ...p,prosrc:'EXACT_ALLOWED_BODY' } : p) })
    expect(normalize(after)).toEqual(normalize(old))
  })
  it('complete canonical pair is a true no-op, including pg_proc xmin', async () => {
    await replaceBody(manual,canonicalManual);await replaceBody(publisher,canonicalPublisher)
    const before = await catalog()
    const xmins = await db.query('select oid,xmin::text from pg_proc where proname in($1,$2) order by oid',[manual,publisher])
    await apply()
    expect(await catalog()).toEqual(before)
    expect((await db.query('select oid,xmin::text from pg_proc where proname in($1,$2) order by oid',[manual,publisher])).rows).toEqual(xmins.rows)
  })
  it('old pair refuses create+pricing.write without catalog rights before the fix', async () => {
    await runtimeHelpers()
    expect((await refused(() => prepare(),'contract_permission_denied:contracts.publish'))?.code).toBe('42501')
    expect(await db.query('select * from fixture.saved')).toHaveProperty('rows',[])
  })
  for (const half of ['manual','publisher'] as const) it(`${half} half alone remains insufficient, actual target bodies`, async () => {
    await replaceBody(half==='manual'?manual:publisher,half==='manual'?canonicalManual:canonicalPublisher)
    await runtimeHelpers()
    expect((await refused(() => prepare(),'contract_permission_denied:contracts.publish'))?.code).toBe('42501')
    expect((await db.query('select * from gridex_one_off_offer_binding.publish_authorizations')).rows).toEqual([])
  })
  it('both installed gates admit the real manual+publisher+ensure path and clean capability before reservation', async () => {
    await apply();await runtimeHelpers()
    const out = await prepare({ intended_contract_id: FOREIGN_ACTOR,valid_from:'2099-01-01',contract_type:'spot' },{ price_area:'SE3',fixed_price_ore_per_kwh:99 })
    expect(out.source_of_truth).toBe('contract_publication_versions')
    expect((await db.query('select * from gridex_one_off_offer_binding.publish_authorizations')).rows).toEqual([])
    const reservation = (await db.query<{ company_id:string;intended_contract_id:string }>('select * from gridex_one_off_offer_binding.reservations')).rows[0]
    expect(reservation.company_id).toBe(COMPANY);expect(reservation.intended_contract_id).toBe(FOREIGN_ACTOR)
    const saved=(await db.query<{ payload:Record<string,unknown>;pricing:Record<string,unknown> }>('select * from fixture.saved')).rows[0]
    expect(saved.payload.contract_type).toBe('variable_monthly');expect(saved.payload.fixed_price_ore_per_kwh).toBe(99)
    expect(saved.payload.valid_from).toBe((await db.query<{ date:string }>('select current_date::text date')).rows[0].date)
    expect(saved.pricing.price_areas).toEqual(['SE3'])
    expect((await db.query<{ status:string;is_active:boolean }>('select status,is_active from public.contract_offers')).rows[0]).toEqual({status:'inactive',is_active:false})
    expect((await db.query('select * from public.audit_logs')).rows).toHaveLength(1)
  })
  it('keeps explicit payload values and native multi-area/alias/future-start bridges', async () => {
    await apply();await runtimeHelpers()
    await prepare({ fixed_price_ore_per_kwh:45,contract_type:'hourly_spot',binding_months:12,notice_months:3 },{ fixed_price_ore_per_kwh:99,price_area:'SE3',price_areas:['SE3','SE4'] })
    const saved=(await db.query<{ payload:Record<string,unknown>;pricing:Record<string,unknown> }>('select * from fixture.saved')).rows[0]
    expect(saved.payload.fixed_price_ore_per_kwh).toBe(45);expect(saved.payload.contract_type).toBe('variable_hourly')
    expect(saved.payload.default_binding_months).toBe(12);expect(saved.payload.default_notice_months).toBe(3)
    expect(saved.pricing.price_areas).toEqual(['SE3','SE4'])
  })
  for (const [permission,permissions] of [['contracts.create','pricing.write'],['pricing.write','contracts.create']] as const) it(`preserves ${permission} refusal and leaves no finite business writes`,async()=>{
    await apply();await runtimeHelpers();await db.query("select set_config('fixture.permissions',$1,true)",[permissions])
    const before=await business();await refused(()=>prepare(),`contract_permission_denied:${permission}`);expect(await business()).toEqual(before)
  })
  it('preserves actor/JWT mismatch refusal in the explicitly finite Auth seam',async()=>{
    await apply();await runtimeHelpers();await db.query("select set_config('fixture.jwt',$1,true)",[FOREIGN_ACTOR])
    await refused(()=>prepare(),'contract_permission_denied:contracts.create')
  })
  for (const [key,message] of [
    ['block_readiness','one_off_publication_refused'],['bad_pricing','one_off_publication_refused'],
    ['sync_legal_error','one_off_publication_refused'],['bad_product','one_off_product_version_not_locked'],
    ['bad_legal','one_off_legal_version_not_ready'],['unresolved_legal','one_off_legal_version_not_ready'],
    ['missing_offer','one_off_offer_creation_failed'],
  ] as const) it(`retains ${key} refusal with atomic capability/business rollback`,async()=>{
    await apply();await runtimeHelpers();await db.query("select set_config($1,'yes',true)",['fixture.'+key])
    const before=await business();await refused(()=>prepare(),message);expect(await business()).toEqual(before)
  })
  it('rejects conflicting resolved price areas before save and preserves malformed explicit canonical refusal',async()=>{
    await apply();await runtimeHelpers()
    await refused(()=>prepare({}, {price_area:'SE3',price_areas:['SE4']}),'one_off_price_area_not_in_price_areas')
    await refused(()=>prepare({}, {price_area:'SE3',price_areas:'SE3'}),'finite_invalid_price_areas')
    expect((await db.query('select * from fixture.saved')).rows).toEqual([])
  })
  for (const mismatch of ['absent','company','offer','actor','null_actor','txid'] as const) it(`ordinary publisher keeps catalog rights when private capability ${mismatch}`,async()=>{
    await apply();await runtimeHelpers()
    const offer=(await db.query<{ id:string }>(`insert into public.contract_offers(company_id,name,lifecycle_status)values($1,'ordinary','published')returning id`,[COMPANY])).rows[0].id
    if(mismatch!=='absent')await db.query(`insert into gridex_one_off_offer_binding.publish_authorizations values($1,$2,$3,txid_current()+$4)`,
      [mismatch==='offer'?(await db.query<{ id:string }>(`insert into public.contract_offers(company_id)values($1)returning id`,[COMPANY])).rows[0].id:offer,mismatch==='company'?OTHER:COMPANY,mismatch==='null_actor'?null:mismatch==='actor'?FOREIGN_ACTOR:ACTOR,mismatch==='txid'?1:0])
    await refused(()=>db.query('select public.gridex_publish_internal_contract_version($1,$2,$3)',[COMPANY,offer,ACTOR]),'contract_permission_denied:contracts.publish')
  })
  for(const missing of ['contracts.publish','pricing.publish'] as const)it(`ordinary catalog still requires ${missing}`,async()=>{
    await apply();await runtimeHelpers();await db.query("select set_config('fixture.permissions',$1,true)",[missing==='contracts.publish'?'pricing.publish':'contracts.publish'])
    const id=(await db.query<{id:string}>(`insert into public.contract_offers(company_id,lifecycle_status)values($1,'published')returning id`,[COMPANY])).rows[0].id
    await refused(()=>db.query('select public.gridex_publish_internal_contract_version($1,$2,$3)',[COMPANY,id,ACTOR]),`contract_permission_denied:${missing}`)
  })
  for(const role of ['anon','authenticated','service_role'] as const)it(`${role} cannot write a private publish capability`,async()=>{
    await apply();await db.exec(`set local role ${role}`)
    expect((await refused(()=>db.query('insert into gridex_one_off_offer_binding.publish_authorizations values(gen_random_uuid(),$1,$2,txid_current())',[COMPANY,ACTOR])))?.code).toBe('42501')
    await db.exec('reset role')
  })
  for(const [label,mutation] of [
    ['manual unknown source',`create or replace function public.gridex_prepare_manual_contract_binding(p_company_id uuid,p_payload jsonb,p_pricing_snapshot jsonb,p_actor_user_id uuid default null)returns jsonb language sql as $$select '{}'::jsonb$$`],
    ['ensure changed source',`do $$begin execute replace(pg_get_functiondef('public.gridex_ensure_internal_contract_publication(uuid,uuid,uuid)'::regprocedure),'end ','end -- changed\n');end $$`],
    ['wrong owner',`create role alien;alter function public.gridex_publish_internal_contract_version(uuid,uuid,uuid)owner to alien`],
    ['extra execute',`grant execute on function public.gridex_publish_internal_contract_version(uuid,uuid,uuid)to authenticated`],
    ['grant option',`grant execute on function public.gridex_publish_internal_contract_version(uuid,uuid,uuid)to service_role with grant option`],
    ['invoker',`alter function public.gridex_publish_internal_contract_version(uuid,uuid,uuid)security invoker`],
    ['search path',`alter function public.gridex_publish_internal_contract_version(uuid,uuid,uuid)set search_path=public`],
    ['volatility',`alter function public.gridex_publish_internal_contract_version(uuid,uuid,uuid)stable`],
    ['cost',`alter function public.gridex_publish_internal_contract_version(uuid,uuid,uuid)cost 99`],
    ['strict',`alter function public.gridex_publish_internal_contract_version(uuid,uuid,uuid)strict`],
    ['parallel',`alter function public.gridex_publish_internal_contract_version(uuid,uuid,uuid)parallel safe`],
    ['overload',`create function public.gridex_publish_internal_contract_version(uuid)returns jsonb language sql as $$select '{}'::jsonb$$`],
    ['private schema access',`grant usage on schema gridex_one_off_offer_binding to service_role`],
    ['private table access',`grant select on gridex_one_off_offer_binding.publish_authorizations to authenticated`],
    ['private extra column',`alter table gridex_one_off_offer_binding.publish_authorizations add column unintended text`],
    ['private default',`alter table gridex_one_off_offer_binding.publish_authorizations alter column txid set default txid_current()`],
    ['private rls',`alter table gridex_one_off_offer_binding.publish_authorizations enable row level security`],
    ['private policy',`create policy unexpected on gridex_one_off_offer_binding.publish_authorizations using(true)`],
    ['private check',`alter table gridex_one_off_offer_binding.publish_authorizations add constraint unexpected check(txid>0)`],
    ['private index',`create index unexpected on gridex_one_off_offer_binding.publish_authorizations(company_id)`],
    ['FK action',`alter table gridex_one_off_offer_binding.publish_authorizations drop constraint publish_authorizations_offer_id_fkey;alter table gridex_one_off_offer_binding.publish_authorizations add constraint publish_authorizations_offer_id_fkey foreign key(offer_id)references public.contract_offers(id)on delete restrict`],
    ['private trigger',`create function fixture.extra()returns trigger language plpgsql as $$begin return new;end $$;create trigger unexpected before insert on gridex_one_off_offer_binding.publish_authorizations for each row execute function fixture.extra()`],
  ] as const)it(`installer rejects ${label} without additional mutation`,async()=>{await installerRefused(mutation)})
  for(const name of profiles.map(p=>p.name).filter(n=>n!==manual&&n!==publisher))it(`requires exact known ${name} dependency body`,async()=>{
    await replaceBody(name,definitions[name].body+'\n-- unknown dependency')
    await installerRefused('select 1')
  })
  for(const half of [manual,publisher])it(`installer refuses unqualified mixed ${half} POST/PRE pair`,async()=>{
    await replaceBody(half,half===manual?canonicalManual:canonicalPublisher);await installerRefused('select 1')
  })
  it('late exception after second function DDL rolls back both bodies atomically',async()=>{
    await db.exec(`create function fixture.late_fault()returns event_trigger language plpgsql as $$begin
 if(select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='public.gridex_publish_internal_contract_version(uuid,uuid,uuid)'::regprocedure)='${hashes.newPublisher}'then raise exception 'finite_late_second_ddl_fault';end if;end $$;
 create event trigger finite_late_fault on ddl_command_end when tag in('CREATE FUNCTION')execute function fixture.late_fault()`)
    const before=await catalog();await refused(apply,'finite_late_second_ddl_fault');expect(await catalog()).toEqual(before)
    expect(await bodies()).toEqual([{name:manual,hash:hashes.oldManual},{name:publisher,hash:hashes.oldPublisher}])
  })
  it('late ACL drift after second DDL is detected and rolled back, not merely body-checked',async()=>{
    await db.exec(`create function fixture.late_acl()returns event_trigger language plpgsql as $$begin
 if(select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='public.gridex_publish_internal_contract_version(uuid,uuid,uuid)'::regprocedure)='${hashes.newPublisher}'then grant execute on function public.gridex_publish_internal_contract_version(uuid,uuid,uuid)to authenticated;end if;end $$;
 create event trigger finite_late_acl on ddl_command_end when tag in('CREATE FUNCTION')execute function fixture.late_acl()`)
    const before=await catalog();await refused(apply,'one_off_gate_convergence_');expect(await catalog()).toEqual(before)
  })
})
