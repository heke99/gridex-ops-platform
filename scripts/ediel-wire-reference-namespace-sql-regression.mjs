// Focused embedded PostgreSQL regression, not native migration/replay evidence.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
if (!process.env.EDIEL_PGLITE_MODULE) throw Error('EDIEL_PGLITE_MODULE required; pinned temporary @electric-sql/pglite@0.3.14')
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db = new PGlite()
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const wire = ({ sender = 'ESCO', app = '23-DGI-E66-T', interchange = 'I-ONE', document = 'D-ONE', ide = 'TX-ONE', family = 'UTILTS', dm = null } = {}) =>
  `UNB+UNOC:3+${sender}:14+DSO:14+260930:1200+${interchange}++${app}++++1'UNH+1+${family}:D:04A:UN:E5SE5A'BGM+${family === 'APERAK' ? '312' : 'E66'}+${document}+9'NAD+MS+${sender}::9'${dm ? `RFF+DM:${dm}'` : `IDE+24+${ide}'`}UNT+5+1'UNZ+1+${interchange}'`
const insert = async (id, company, raw) => db.query("insert into ediel_messages values($1,$2,'test','outbound','UTILTS',$3)", [uid(id), uid(company), raw])
let checks = 0
try {
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema extensions;create schema gridex_utilts_binding;
    create function extensions.digest(bytea,text) returns bytea language sql immutable as 'select sha256($1)';
    create table public.ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,message_family text,raw_payload text);`)
  const tokenizer = readFileSync(new URL('../supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql', import.meta.url), 'utf8')
  await db.exec(tokenizer.slice(tokenizer.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'), tokenizer.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
  // Genuine pre-migration retained fixture. No synthetic send/approval stamp.
  await insert(1, 100, wire())
  await db.exec(readFileSync(new URL('../supabase/migrations/20260930171116_ediel_wire_reference_namespace.sql', import.meta.url), 'utf8')); checks++
  await assert.rejects(insert(2, 200, wire()), /ediel_wire_reference_namespace_collision/); checks++
  await db.query('select public.ediel_reserve_wire_reference_namespace_v1($1,$2)', [uid(100), uid(1)])
  const initial = (await db.query('select count(*)::int n from gridex_ediel_wire_namespace.reservations')).rows[0].n
  assert.equal(initial, 4); checks++
  await db.query('select public.ediel_reserve_wire_reference_namespace_v1($1,$2)', [uid(100), uid(1)])
  assert.equal((await db.query('select count(*)::int n from gridex_ediel_wire_namespace.reservations')).rows[0].n, initial); checks++
  await assert.rejects(db.query('select public.ediel_reserve_wire_reference_namespace_v1($1,$2)', [uid(200), uid(1)]), /ediel_wire_reference_source_invalid/); checks++
  await assert.rejects(insert(3, 200, wire({ interchange: 'I-TWO' })), /ediel_wire_reference_namespace_collision/); checks++
  await assert.rejects(insert(4, 200, wire({ interchange: 'I-TWO', document: 'D-TWO' })), /ediel_wire_reference_namespace_collision/); checks++
  await insert(5, 200, wire({ interchange: 'I-TWO', document: 'D-TWO', ide: 'TX-TWO' })); checks++
  // Same external sender across tenants: different application namespaces may
  // use the same BGM/IDE, while the interchange reference remains sender-wide.
  await insert(6, 200, wire({ app: '23-DDQ-E66-T', interchange: 'I-THREE' })); checks++
  await assert.rejects(insert(7, 200, wire({ app: '23-DDQ-E66-T', document: 'D-THREE', ide: 'TX-THREE' })), /ediel_wire_reference_namespace_collision/); checks++
  await insert(8, 200, wire({ sender: 'OTHER' })); checks++
  await assert.rejects(db.exec(`update ediel_messages set company_id='${uid(200)}' where id='${uid(1)}'`), /ediel_wire_reference_namespace_context_immutable/); checks++
  await assert.rejects(db.exec('delete from gridex_ediel_wire_namespace.reservations'), /ediel_wire_reference_reservation_immutable/); checks++
  await insert(9, 200, wire({ family: 'APERAK', interchange: 'ACK-I', document: 'ACK-D', dm: 'ACK-T' })); checks++
  await assert.rejects(insert(10, 100, wire({ family: 'APERAK', interchange: 'ACK-I-TWO', document: 'ACK-D-TWO', dm: 'ACK-T' })), /ediel_wire_reference_namespace_collision/); checks++
  const keys = (await db.query('select gridex_ediel_wire_namespace.keys($1) result', [wire({ sender: 'ESC?+O', interchange: 'RELEASED', document: 'DOC?+X', ide: 'IDE?:X' })])).rows[0].result
  assert.ok(keys.some(key => key.sender === 'ESC+O' && key.kind === 'IDE' && key.value === 'IDE:X')); checks++
  const alternate = "UNA;*.! ~UNB*UNOC;3*ESCO;14*DSO;14*260930;1200*ALT-I**23-DGI-E66-T****1~UNH*1*UTILTS;D;04A;UN;E5SE5A~BGM*E66*ALT-D*9~NAD*MS*ESCO;;9~IDE*24*ALT!*ID~UNT*5*1~UNZ*1*ALT-I~"
  await insert(11, 100, alternate); checks++
  assert.ok((await db.query('select gridex_ediel_wire_namespace.keys($1) result', [alternate])).rows[0].result.some(key => key.kind === 'IDE' && key.value === 'ALT*ID')); checks++
  await assert.rejects(insert(12, 100, wire({ interchange: 'THIS-IS-OVER-14-CHARS' })), /ediel_wire_reference_source_invalid/); checks++
  await assert.rejects(db.query("insert into ediel_messages values($1,$2,'production','outbound','UTILTS',$3)", [uid(13), uid(100), wire({ sender: 'ANOTHER' })]), /ediel_wire_reference_source_invalid/); checks++
  const acl = (await db.query("select has_function_privilege('authenticated','public.ediel_reserve_wire_reference_namespace_v1(uuid,uuid)','execute') user_rpc,has_table_privilege('service_role','gridex_ediel_wire_namespace.reservations','insert') direct_write")).rows[0]
  assert.deepEqual(acl, { user_rpc: false, direct_write: false }); checks++
  console.log(`Focused PostgreSQL physical namespace/collision/immutability/tenant/ACL checks: ${checks} PASS`)
} finally { await db.close() }
