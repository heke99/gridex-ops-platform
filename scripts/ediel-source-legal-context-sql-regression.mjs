// Actual prospective SQL/rolebasis regression; focused embedded PostgreSQL only.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
if (!process.env.EDIEL_PGLITE_MODULE) throw Error('EDIEL_PGLITE_MODULE required; pinned temporary @electric-sql/pglite@0.3.14')
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db = new PGlite()
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const wire = ({ outbound = false, receiver = 'SUPPLIER', legal = 'SUPPLIER', app = '23-DDQ-E66-T' } = {}) => `UNB+UNOC:3+${outbound ? 'SUPPLIER' : 'DSO'}:14+${outbound ? 'DSO' : receiver}:14+260930:1200+I++${app}++++1'UNH+1+UTILTS:D:04A:UN:E5SE5A'BGM+${outbound ? 'E73' : 'E66'}+D+9'NAD+MS+${outbound ? legal : 'DSO'}::9'NAD+MR+${outbound ? 'DSO' : legal}::9'IDE+24+T'UNT+6+1'UNZ+1+I'`
let checks = 0
try {
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema extensions;create schema gridex_utilts_binding;create schema gridex_ediel_readiness;
   create function extensions.digest(bytea,text) returns bytea language sql immutable as 'select sha256($1)';
   create table gridex_ediel_readiness.source_editions(source_version text primary key,input_manifest jsonb,catalog jsonb,recorded_at timestamptz default clock_timestamp());
   create table public.ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,message_family text,message_code text,raw_payload text,message_received_at timestamptz,related_message_id uuid);
   create table public.tenant_ediel_profiles(id uuid,company_id uuid,environment text,market text,is_enabled boolean,valid_from timestamptz,valid_to timestamptz);
   create table public.tenant_actor_identifiers(id uuid,company_id uuid,environment text,actor_id uuid,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);
   create table public.tenant_actor_roles(id uuid,company_id uuid,environment text,actor_id uuid,role_code text,valid_from timestamptz,valid_to timestamptz);
   create table public.tenant_counterparty_relations(id uuid,company_id uuid,environment text,counterparty_actor_id uuid,relation_type text,is_enabled boolean,valid_from timestamptz,valid_to timestamptz);
   create table public.platform_actor_identifiers(id uuid,actor_id uuid,identifier_type text,identifier_value text,valid_from date,valid_to date);
   insert into tenant_ediel_profiles values('${uid(3)}','${uid(1)}','test','electricity',true,'2000-01-01',null);
   insert into tenant_actor_identifiers values('${uid(4)}','${uid(1)}','test','${uid(2)}','EdielId','SUPPLIER','2000-01-01',null);
   insert into tenant_actor_roles values('${uid(5)}','${uid(1)}','test','${uid(2)}','electricity_supplier','2000-01-01',null);`)
  const inherited = readFileSync(new URL('../supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql', import.meta.url), 'utf8')
  await db.exec(inherited.slice(inherited.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'), inherited.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
  const insert = async (id, company, raw, direction = 'inbound', code = 'E66', related = null) => db.query("insert into ediel_messages values($1,$2,'test',$3,'UTILTS',$4,$5,'2026-09-30T12:00:00Z',$6)", [uid(id), uid(company), direction, code, raw, related])
  await insert(9, 1, wire()) // Synthetic retained original preceding new capture.
  await db.exec(readFileSync(new URL('../supabase/migrations/20260930173632_ediel_immutable_source_legal_context.sql', import.meta.url), 'utf8')); checks++
  const requireContext = async id => (await db.query('select public.ediel_require_inbound_legal_context_v1($1,$2) context', [uid(1), uid(id)])).rows[0].context
  await assert.rejects(requireContext(9), /ediel_historical_identity_basis_unavailable/); checks++
  await insert(10, 1, wire()); const first = await requireContext(10)
  assert.equal(first.legalEdielId, 'SUPPLIER'); assert.equal(first.actorRole, 'electricity_supplier'); assert.equal(first.transportEdielId, 'SUPPLIER'); assert.equal(first.basisKind, 'observed_source_persistence'); checks++
  assert.ok(Date.parse(first.observedAt) > Date.parse(first.sourceReceivedAt)); checks++
  const ackSender = "UNB+UNOC:3+SUPPLIER:14+DSO:14+260930:1200+ACK-I++23-DDQ-E66-T++++1'UNH+1+APERAK:D:04A:UN:E5SE5A'BGM+312+ACK-D+9'NAD+MS+SUPPLIER::9'NAD+MR+DSO::9'ERC+100::260'RFF+ACW:T'UNT+7+1'UNZ+1+ACK-I'"
  await db.query("insert into ediel_messages values($1,$2,'test','outbound','APERAK','312',$3,null,$4)", [uid(20), uid(1), ackSender, uid(10)])
  assert.equal((await requireContext(20)).basisKind, 'prescribed_outbound_ack'); checks++
  await db.query("insert into ediel_messages values($1,$2,'test','outbound','APERAK','312',$3,null,$4)", [uid(21), uid(1), ackSender.replace('NAD+MS+SUPPLIER','NAD+MS+OTHER'), uid(10)])
  await assert.rejects(requireContext(21), /ediel_inbound_legal_context_required/); checks++
  await insert(11, 99, wire())
  await assert.rejects(db.query('select public.ediel_require_inbound_legal_context_v1($1,$2)', [uid(99), uid(11)]), /ediel_inbound_legal_context_required/); checks++
  await insert(12, 1, wire({ receiver: 'UNKNOWN' })); await assert.rejects(requireContext(12), /ediel_inbound_legal_context_required/); checks++
  await insert(13, 1, wire({ legal: 'OTHER' })); await assert.rejects(requireContext(13), /ediel_inbound_legal_context_required/); checks++
  await insert(14, 1, wire({ app: '23-GUESSED-E66-T' })); await assert.rejects(requireContext(14), /ediel_inbound_legal_context_required/); checks++
  await db.exec(`insert into tenant_actor_identifiers values('${uid(30)}','${uid(31)}','test','${uid(32)}','EdielId','SUPPLIER','2000-01-01',null)`)
  await insert(15, 1, wire()); await assert.rejects(requireContext(15), /ediel_inbound_legal_context_required/); checks++
  await db.exec(`delete from tenant_actor_identifiers where id='${uid(30)}';insert into tenant_counterparty_relations values('${uid(40)}','${uid(1)}','test','${uid(41)}','ediel_transport_agent',true,'2000-01-01',null);insert into platform_actor_identifiers values('${uid(42)}','${uid(41)}','EdielId','AGENT','2000-01-01',null)`)
  await insert(16, 1, wire({ receiver: 'AGENT' })); assert.equal((await requireContext(16)).legalEdielId, 'SUPPLIER'); assert.equal((await requireContext(16)).transportEdielId, 'AGENT'); checks++
  await db.exec(`delete from tenant_counterparty_relations;update tenant_actor_roles set role_code='energy_service_company'`)
  // Current role changes cannot rewrite an authentic captured original basis.
  assert.equal((await requireContext(10)).actorRole, first.actorRole); checks++
  await insert(19, 1, wire({ app: '23-DGI-E66-T' })); assert.equal((await requireContext(19)).actorRole, 'energy_service_company'); checks++
  await db.exec(`update tenant_actor_roles set role_code='electricity_supplier'`)
  await insert(17, 1, wire({ outbound: true }), 'outbound', 'E73'); assert.equal((await requireContext(17)).direction, 'outbound'); checks++
  await db.exec(`update tenant_actor_roles set role_code='energy_service_company'`)
  const ackRaw = "UNB+UNOC:3+DSO:14+SUPPLIER:14+260930:1200+ACK++23-DDQ-E66-T++++1'UNH+1+APERAK:D:04A:UN:E5SE5A'BGM+312+ACK-D+9'DOC+E73::260+D'ERC+100::260'RFF+ACW:T'UNT+6+1'UNZ+1+ACK'"
  await db.query("insert into ediel_messages values($1,$2,'test','inbound','APERAK','312',$3,null,null)", [uid(18), uid(1), ackRaw])
  const acknowledged = (await db.query('select gridex_ediel_inbound_context.require_ack_v1(a,s) context from ediel_messages a,ediel_messages s where a.id=$1 and s.id=$2', [uid(18), uid(17)])).rows[0].context
  assert.equal(acknowledged.actorRole, 'electricity_supplier'); assert.equal(acknowledged.basisKind, 'qualified_outbound_original_ack'); checks++
  await assert.rejects(db.exec('delete from gridex_ediel_inbound_context.receipts'), /ediel_original_identity_basis_immutable/); checks++
  await db.query('update ediel_messages set raw_payload=replace(raw_payload,$1,$2) where id=$3', ['IDE+24+T', 'IDE+24+FORGED', uid(10)])
  await assert.rejects(requireContext(10), /ediel_inbound_legal_context_required/); checks++
  const acl = (await db.query("select has_function_privilege('authenticated','public.ediel_require_inbound_legal_context_v1(uuid,uuid)','execute') user_rpc,has_table_privilege('service_role','gridex_ediel_inbound_context.receipts','insert') direct_write")).rows[0]
  assert.deepEqual(acl, { user_rpc: false, direct_write: false }); checks++
  console.log(`Focused PostgreSQL immutable legal/transport/rolebasis/sourceclock/replay/ACK/ACL checks: ${checks} PASS`)
} finally { await db.close() }
