// Actual PostgreSQL core proof. No hosted database or real pg_dump is used.
// OLD is an exact SQL snapshot captured with git show 9e620d0, not a fixture
// result. Both OLD and the current production query execute inside PostgreSQL.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const OLD_SQL_SHA='806c845eca6827104b6aa0177b87db1563e91115fe3c2246944778ad2d3be256';
const OLD_SQL_BASE64='LS0gR1JJREVYIE9QUyBtYXN0ZXIgcmVtZWRpYXRpb24gcGxhbiwgRmFzIDQgKMKnNyk6IGNhbm9uaWNhbC9saXZlIHNjaGVtYSBwYXJpdHkuCi0tCi0tIEVtaXRzIG9uZSBkZXRlcm1pbmlzdGljIEpTT04gZG9jdW1lbnQgZGVzY3JpYmluZyBldmVyeSBzY2hlbWEgb2JqZWN0IHRoZQotLSBwYXJpdHkgZW5naW5lIGNvbXBhcmVzLiBTdHJ1Y3R1cmUgb25seTogbm8gdGFibGUgZGF0YSBpcyByZWFkLgotLQotLSBSZXF1aXJlcyBwc3FsIHZhcmlhYmxlIDpzY2hlbWFzLCBhIFBvc3RncmVzIHRleHRbXSBsaXRlcmFsLCBlLmcuICd7cHVibGljfScuCndpdGggbnNwIGFzICgKICBzZWxlY3Qgbi5vaWQsIG4ubnNwbmFtZQogIGZyb20gcGdfbmFtZXNwYWNlIG4KICB3aGVyZSBuLm5zcG5hbWUgPSBhbnkgKDonc2NoZW1hcyc6OnRleHRbXSkKKSwKcmVscyBhcyAoCiAgc2VsZWN0IG4ubnNwbmFtZSwgYy5yZWxuYW1lLCBjLnJlbGtpbmQ6OnRleHQgYXMgcmVsa2luZCwgYy5vaWQsCiAgICAgICAgIGMucmVscm93c2VjdXJpdHksIGMucmVsZm9yY2Vyb3dzZWN1cml0eSwKICAgICAgICAgY2FzZSB3aGVuIGMucmVsa2luZCBpbiAoJ3YnLCAnbScpIHRoZW4gcGdfZ2V0X3ZpZXdkZWYoYy5vaWQsIHRydWUpIGVuZCBhcyB2aWV3X2RlZmluaXRpb24sCiAgICAgICAgIGNhc2Ugd2hlbiBjLnJlbGtpbmQgPSAncCcgdGhlbiBwZ19nZXRfcGFydGtleWRlZihjLm9pZCkgZW5kIGFzIHBhcnRpdGlvbl9rZXkKICBmcm9tIHBnX2NsYXNzIGMKICBqb2luIG5zcCBuIG9uIG4ub2lkID0gYy5yZWxuYW1lc3BhY2UKICB3aGVyZSBjLnJlbGtpbmQgaW4gKCdyJywgJ3AnLCAndicsICdtJywgJ2YnKQopLApjb2xzIGFzICgKICBzZWxlY3Qgci5uc3BuYW1lLCByLnJlbG5hbWUsIGEuYXR0bnVtLCBhLmF0dG5hbWUsCiAgICAgICAgIGZvcm1hdF90eXBlKGEuYXR0dHlwaWQsIGEuYXR0dHlwbW9kKSBhcyBkYXRhX3R5cGUsCiAgICAgICAgIHQudHlwbmFtZSBhcyB1ZHRfbmFtZSwKICAgICAgICAgbm90IGEuYXR0bm90bnVsbCBhcyBpc19udWxsYWJsZSwKICAgICAgICAgY29hbGVzY2UocGdfZ2V0X2V4cHIoYWQuYWRiaW4sIGFkLmFkcmVsaWQsIHRydWUpLCAnJykgYXMgY29sdW1uX2RlZmF1bHQsCiAgICAgICAgIGEuYXR0aWRlbnRpdHk6OnRleHQgYXMgaWRlbnRpdHksCiAgICAgICAgIGEuYXR0Z2VuZXJhdGVkOjp0ZXh0IGFzIGdlbmVyYXRlZAogIGZyb20gcGdfYXR0cmlidXRlIGEKICBqb2luIHJlbHMgciBvbiByLm9pZCA9IGEuYXR0cmVsaWQKICBqb2luIHBnX3R5cGUgdCBvbiB0Lm9pZCA9IGEuYXR0dHlwaWQKICBsZWZ0IGpvaW4gcGdfYXR0cmRlZiBhZCBvbiBhZC5hZHJlbGlkID0gYS5hdHRyZWxpZCBhbmQgYWQuYWRudW0gPSBhLmF0dG51bQogIHdoZXJlIGEuYXR0bnVtID4gMCBhbmQgbm90IGEuYXR0aXNkcm9wcGVkCiksCmVudW1zIGFzICgKICBzZWxlY3Qgbi5uc3BuYW1lLCB0LnR5cG5hbWUsIGUuZW51bWxhYmVsLCBlLmVudW1zb3J0b3JkZXIKICBmcm9tIHBnX3R5cGUgdAogIGpvaW4gbnNwIG4gb24gbi5vaWQgPSB0LnR5cG5hbWVzcGFjZQogIGpvaW4gcGdfZW51bSBlIG9uIGUuZW51bXR5cGlkID0gdC5vaWQKKSwKY29ucyBhcyAoCiAgc2VsZWN0IHIubnNwbmFtZSwgci5yZWxuYW1lLCBjb24uY29ubmFtZSwgY29uLmNvbnR5cGU6OnRleHQgYXMgY29udHlwZSwKICAgICAgICAgcGdfZ2V0X2NvbnN0cmFpbnRkZWYoY29uLm9pZCwgdHJ1ZSkgYXMgZGVmaW5pdGlvbiwKICAgICAgICAgY29uLmNvbnZhbGlkYXRlZAogIGZyb20gcGdfY29uc3RyYWludCBjb24KICBqb2luIHJlbHMgciBvbiByLm9pZCA9IGNvbi5jb25yZWxpZAopLAppZHggYXMgKAogIHNlbGVjdCByLm5zcG5hbWUsIHIucmVsbmFtZSwgaWMucmVsbmFtZSBhcyBpbmRleG5hbWUsCiAgICAgICAgIHBnX2dldF9pbmRleGRlZihpLmluZGV4cmVsaWQpIGFzIGRlZmluaXRpb24sCiAgICAgICAgIGkuaW5kaXN1bmlxdWUsIGkuaW5kaXNwcmltYXJ5CiAgZnJvbSBwZ19pbmRleCBpCiAgam9pbiByZWxzIHIgb24gci5vaWQgPSBpLmluZHJlbGlkCiAgam9pbiBwZ19jbGFzcyBpYyBvbiBpYy5vaWQgPSBpLmluZGV4cmVsaWQKKSwKZnVuY3MgYXMgKAogIHNlbGVjdCBuLm5zcG5hbWUsIHAucHJvbmFtZSwKICAgICAgICAgcGdfZ2V0X2Z1bmN0aW9uX2lkZW50aXR5X2FyZ3VtZW50cyhwLm9pZCkgYXMgaWRlbnRpdHlfYXJndW1lbnRzLAogICAgICAgICBwZ19nZXRfZnVuY3Rpb25fYXJndW1lbnRzKHAub2lkKSBhcyBhcmd1bWVudHMsCiAgICAgICAgIHBnX2dldF9mdW5jdGlvbl9yZXN1bHQocC5vaWQpIGFzIHJldHVybl90eXBlLAogICAgICAgICBwLnByb3NlY2RlZiBhcyBzZWN1cml0eV9kZWZpbmVyLAogICAgICAgICBwLnByb3ZvbGF0aWxlOjp0ZXh0IGFzIHZvbGF0aWxpdHksCiAgICAgICAgIHAucHJva2luZDo6dGV4dCBhcyBraW5kLAogICAgICAgICBjYXNlIHdoZW4gcC5wcm9raW5kIGluICgnZicsICdwJykgdGhlbiBtZDUocGdfZ2V0X2Z1bmN0aW9uZGVmKHAub2lkKSkgZW5kIGFzIGJvZHlfbWQ1CiAgZnJvbSBwZ19wcm9jIHAKICBqb2luIG5zcCBuIG9uIG4ub2lkID0gcC5wcm9uYW1lc3BhY2UKKSwKdHJnIGFzICgKICBzZWxlY3Qgci5uc3BuYW1lLCByLnJlbG5hbWUsIHQudGduYW1lLAogICAgICAgICBwZ19nZXRfdHJpZ2dlcmRlZih0Lm9pZCwgdHJ1ZSkgYXMgZGVmaW5pdGlvbiwKICAgICAgICAgdC50Z2VuYWJsZWQ6OnRleHQgYXMgZW5hYmxlZAogIGZyb20gcGdfdHJpZ2dlciB0CiAgam9pbiByZWxzIHIgb24gci5vaWQgPSB0LnRncmVsaWQKICB3aGVyZSBub3QgdC50Z2lzaW50ZXJuYWwKKSwKcG9sIGFzICgKICBzZWxlY3Qgci5uc3BuYW1lLCByLnJlbG5hbWUsIHAucG9sbmFtZSwKICAgICAgICAgcC5wb2xjbWQ6OnRleHQgYXMgY29tbWFuZCwKICAgICAgICAgcC5wb2xwZXJtaXNzaXZlIGFzIHBlcm1pc3NpdmUsCiAgICAgICAgIGNvYWxlc2NlKHBnX2dldF9leHByKHAucG9scXVhbCwgcC5wb2xyZWxpZCwgdHJ1ZSksICcnKSBhcyB1c2luZ19leHByZXNzaW9uLAogICAgICAgICBjb2FsZXNjZShwZ19nZXRfZXhwcihwLnBvbHdpdGhjaGVjaywgcC5wb2xyZWxpZCwgdHJ1ZSksICcnKSBhcyBjaGVja19leHByZXNzaW9uLAogICAgICAgICBjb2FsZXNjZSgoCiAgICAgICAgICAgc2VsZWN0IGFycmF5X2FnZyhjYXNlIHdoZW4gcm9sZV9vaWQgPSAwIHRoZW4gJ1BVQkxJQycKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSBwZ19nZXRfdXNlcmJ5aWQocm9sZV9vaWQpIGVuZAogICAgICAgICAgICAgICAgICAgICAgICAgICAgb3JkZXIgYnkgMSkKICAgICAgICAgICBmcm9tIHVubmVzdChwLnBvbHJvbGVzKSBhcyByb2xlX29pZAogICAgICAgICApLCAne30nOjp0ZXh0W10pIGFzIHJvbGVzCiAgZnJvbSBwZ19wb2xpY3kgcAogIGpvaW4gcmVscyByIG9uIHIub2lkID0gcC5wb2xyZWxpZAopLApyZWxncmFudHMgYXMgKAogIHNlbGVjdCByLm5zcG5hbWUsIHIucmVsbmFtZSwKICAgICAgICAgY2FzZSB3aGVuIGFjbC5ncmFudGVlID0gMCB0aGVuICdQVUJMSUMnIGVsc2UgcGdfZ2V0X3VzZXJieWlkKGFjbC5ncmFudGVlKSBlbmQgYXMgZ3JhbnRlZSwKICAgICAgICAgYWNsLnByaXZpbGVnZV90eXBlCiAgZnJvbSByZWxzIHIKICBqb2luIHBnX2NsYXNzIGMgb24gYy5vaWQgPSByLm9pZCwKICBsYXRlcmFsIGFjbGV4cGxvZGUoY29hbGVzY2UoYy5yZWxhY2wsIGFjbGRlZmF1bHQoJ3InLCBjLnJlbG93bmVyKSkpIGFzIGFjbAopLApmdW5jZ3JhbnRzIGFzICgKICBzZWxlY3Qgbi5uc3BuYW1lLCBwLnByb25hbWUsCiAgICAgICAgIHBnX2dldF9mdW5jdGlvbl9pZGVudGl0eV9hcmd1bWVudHMocC5vaWQpIGFzIGlkZW50aXR5X2FyZ3VtZW50cywKICAgICAgICAgY2FzZSB3aGVuIGFjbC5ncmFudGVlID0gMCB0aGVuICdQVUJMSUMnIGVsc2UgcGdfZ2V0X3VzZXJieWlkKGFjbC5ncmFudGVlKSBlbmQgYXMgZ3JhbnRlZSwKICAgICAgICAgYWNsLnByaXZpbGVnZV90eXBlCiAgZnJvbSBwZ19wcm9jIHAKICBqb2luIG5zcCBuIG9uIG4ub2lkID0gcC5wcm9uYW1lc3BhY2UsCiAgbGF0ZXJhbCBhY2xleHBsb2RlKGNvYWxlc2NlKHAucHJvYWNsLCBhY2xkZWZhdWx0KCdmJywgcC5wcm9vd25lcikpKSBhcyBhY2wKKSwKc2NoZW1hZ3JhbnRzIGFzICgKICBzZWxlY3Qgbi5uc3BuYW1lLAogICAgICAgICBjYXNlIHdoZW4gYWNsLmdyYW50ZWUgPSAwIHRoZW4gJ1BVQkxJQycgZWxzZSBwZ19nZXRfdXNlcmJ5aWQoYWNsLmdyYW50ZWUpIGVuZCBhcyBncmFudGVlLAogICAgICAgICBhY2wucHJpdmlsZWdlX3R5cGUKICBmcm9tIG5zcCBuCiAgam9pbiBwZ19uYW1lc3BhY2UgcG4gb24gcG4ub2lkID0gbi5vaWQsCiAgbGF0ZXJhbCBhY2xleHBsb2RlKGNvYWxlc2NlKHBuLm5zcGFjbCwgYWNsZGVmYXVsdCgnbicsIHBuLm5zcG93bmVyKSkpIGFzIGFjbAopLApleHQgYXMgKAogIHNlbGVjdCBlLmV4dG5hbWUsIGUuZXh0dmVyc2lvbiwgbi5uc3BuYW1lCiAgZnJvbSBwZ19leHRlbnNpb24gZQogIGpvaW4gcGdfbmFtZXNwYWNlIG4gb24gbi5vaWQgPSBlLmV4dG5hbWVzcGFjZQopCnNlbGVjdCBqc29uYl9wcmV0dHkoanNvbmJfYnVpbGRfb2JqZWN0KAogICdzY2hlbWFzJywgKHNlbGVjdCBjb2FsZXNjZShqc29uYl9hZ2cobnNwbmFtZSBvcmRlciBieSBuc3BuYW1lKSwgJ1tdJzo6anNvbmIpIGZyb20gbnNwKSwKICAncmVsYXRpb25zJywgKHNlbGVjdCBjb2FsZXNjZShqc29uYl9hZ2codG9fanNvbmIoeCkgLSAnb2lkJyBvcmRlciBieSB4Lm5zcG5hbWUsIHgucmVsbmFtZSksICdbXSc6Ompzb25iKSBmcm9tIHJlbHMgeCksCiAgJ2NvbHVtbnMnLCAoc2VsZWN0IGNvYWxlc2NlKGpzb25iX2FnZyh0b19qc29uYih4KSBvcmRlciBieSB4Lm5zcG5hbWUsIHgucmVsbmFtZSwgeC5hdHRudW0pLCAnW10nOjpqc29uYikgZnJvbSBjb2xzIHgpLAogICdlbnVtcycsIChzZWxlY3QgY29hbGVzY2UoanNvbmJfYWdnKHRvX2pzb25iKHgpIG9yZGVyIGJ5IHgubnNwbmFtZSwgeC50eXBuYW1lLCB4LmVudW1zb3J0b3JkZXIpLCAnW10nOjpqc29uYikgZnJvbSBlbnVtcyB4KSwKICAnY29uc3RyYWludHMnLCAoc2VsZWN0IGNvYWxlc2NlKGpzb25iX2FnZyh0b19qc29uYih4KSBvcmRlciBieSB4Lm5zcG5hbWUsIHgucmVsbmFtZSwgeC5jb25uYW1lKSwgJ1tdJzo6anNvbmIpIGZyb20gY29ucyB4KSwKICAnaW5kZXhlcycsIChzZWxlY3QgY29hbGVzY2UoanNvbmJfYWdnKHRvX2pzb25iKHgpIG9yZGVyIGJ5IHgubnNwbmFtZSwgeC5yZWxuYW1lLCB4LmluZGV4bmFtZSksICdbXSc6Ompzb25iKSBmcm9tIGlkeCB4KSwKICAnZnVuY3Rpb25zJywgKHNlbGVjdCBjb2FsZXNjZShqc29uYl9hZ2codG9fanNvbmIoeCkgb3JkZXIgYnkgeC5uc3BuYW1lLCB4LnByb25hbWUsIHguaWRlbnRpdHlfYXJndW1lbnRzKSwgJ1tdJzo6anNvbmIpIGZyb20gZnVuY3MgeCksCiAgJ3RyaWdnZXJzJywgKHNlbGVjdCBjb2FsZXNjZShqc29uYl9hZ2codG9fanNvbmIoeCkgb3JkZXIgYnkgeC5uc3BuYW1lLCB4LnJlbG5hbWUsIHgudGduYW1lKSwgJ1tdJzo6anNvbmIpIGZyb20gdHJnIHgpLAogICdwb2xpY2llcycsIChzZWxlY3QgY29hbGVzY2UoanNvbmJfYWdnKHRvX2pzb25iKHgpIG9yZGVyIGJ5IHgubnNwbmFtZSwgeC5yZWxuYW1lLCB4LnBvbG5hbWUpLCAnW10nOjpqc29uYikgZnJvbSBwb2wgeCksCiAgJ3JlbGF0aW9uX2dyYW50cycsIChzZWxlY3QgY29hbGVzY2UoanNvbmJfYWdnKHRvX2pzb25iKHgpIG9yZGVyIGJ5IHgubnNwbmFtZSwgeC5yZWxuYW1lLCB4LmdyYW50ZWUsIHgucHJpdmlsZWdlX3R5cGUpLCAnW10nOjpqc29uYikgZnJvbSByZWxncmFudHMgeCksCiAgJ2Z1bmN0aW9uX2dyYW50cycsIChzZWxlY3QgY29hbGVzY2UoanNvbmJfYWdnKHRvX2pzb25iKHgpIG9yZGVyIGJ5IHgubnNwbmFtZSwgeC5wcm9uYW1lLCB4LmlkZW50aXR5X2FyZ3VtZW50cywgeC5ncmFudGVlLCB4LnByaXZpbGVnZV90eXBlKSwgJ1tdJzo6anNvbmIpIGZyb20gZnVuY2dyYW50cyB4KSwKICAnc2NoZW1hX2dyYW50cycsIChzZWxlY3QgY29hbGVzY2UoanNvbmJfYWdnKHRvX2pzb25iKHgpIG9yZGVyIGJ5IHgubnNwbmFtZSwgeC5ncmFudGVlLCB4LnByaXZpbGVnZV90eXBlKSwgJ1tdJzo6anNvbmIpIGZyb20gc2NoZW1hZ3JhbnRzIHgpLAogICdleHRlbnNpb25zJywgKHNlbGVjdCBjb2FsZXNjZShqc29uYl9hZ2codG9fanNvbmIoeCkgb3JkZXIgYnkgeC5leHRuYW1lKSwgJ1tdJzo6anNvbmIpIGZyb20gZXh0IHgpCikpOwo=';
const oldSql=Buffer.from(OLD_SQL_BASE64,'base64').toString('utf8');
assert.equal(createHash('sha256').update(oldSql).digest('hex'),OLD_SQL_SHA);
const currentSql=fs.readFileSync(path.join(__dirname,'sql/gridex-db-parity-introspect.sql'),'utf8');
function executable(sql){
 const lines=sql.split('\n').filter(line=>{
  if(!line.startsWith('\\'))return true;
  assert.match(line,/^\\set QUIET (on|off)$/);return false;
 });
 return lines.join('\n').replace(":'schemas'","'{parity_probe,auth_probe}'");
}
async function snapshot(db,sql=currentSql,searchPath='pg_catalog,parity_probe,auth_probe'){
 await db.exec('set search_path='+searchPath);
 const results=await db.exec(executable(sql));
 const documents=results.flatMap(r=>r.rows||[]).filter(r=>Object.hasOwn(r,'jsonb_pretty'));
 assert.equal(documents.length,1,'actual query must yield one complete JSON document');
 return JSON.parse(documents[0].jsonb_pretty);
}
const changes=(a,b)=>Object.keys(a).filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k]));
function ddl({dropped=false,reverseRoleCreation=false,reorder=false}={}){
 const roles=reverseRoleCreation?['parity_reader_zeta','parity_reader_alpha']:['parity_reader_alpha','parity_reader_zeta'];
 const columns=reorder?"tag text not null default 'visible',owner_id uuid default auth_probe.uid()":"owner_id uuid default auth_probe.uid(),tag text not null default 'visible'";
 return `create role ${roles[0]};create role ${roles[1]};create role parity_other;
 create schema auth_probe;create schema parity_probe;
 create function auth_probe.uid()returns uuid language sql stable as $$select '00000000-0000-4000-8000-000000000001'::uuid$$;
 create table auth_probe.users(id uuid primary key,allowed boolean not null);
 create table parity_probe.cases(id uuid primary key,${dropped?'unused text,':''}${columns});
 ${dropped?'alter table parity_probe.cases drop column unused;':''}
 alter table parity_probe.cases enable row level security;
 create policy owner_allowed on parity_probe.cases to parity_reader_alpha,parity_reader_zeta
 using(owner_id=auth_probe.uid()and exists(select 1 from auth_probe.users u where u.id=cases.owner_id and u.allowed))
 with check(owner_id=auth_probe.uid()and tag<>'denied');`;
}
async function pair(source={},target={}){
 const a=await PGlite.create(),b=await PGlite.create();
 try{await a.exec(ddl(source));await b.exec(ddl(target));return {a,b};}
 catch(error){await a.close();await b.close();throw error;}
}
async function close(p){await p.a.close();await p.b.close();}
test('OLD actual query differs on storage attnum after DROP; NEW complete query accepts an identical visible schema',async()=>{
 const p=await pair({dropped:true});try{
  const before=await snapshot(p.a,oldSql),after=await snapshot(p.b,oldSql);
  assert.deepEqual(changes(before,after),['columns']);
  const cols=d=>d.columns.filter(c=>c.nspname==='parity_probe');
  assert.deepEqual(cols(before).map(c=>[c.attname,c.attnum]),[['id',1],['owner_id',3],['tag',4]]);
  assert.deepEqual(cols(after).map(c=>[c.attname,c.attnum]),[['id',1],['owner_id',2],['tag',3]]);
  assert.deepEqual(cols(before).map(({attnum,...c})=>c),cols(after).map(({attnum,...c})=>c));
  assert.deepEqual(await snapshot(p.a),await snapshot(p.b));
 }finally{await close(p);}
});
test('OLD same actual schema differs by session deparser search_path; NEW query fixes the environment without rewriting expressions',async()=>{
 const db=await PGlite.create();try{
  await db.exec(ddl());const before=await snapshot(db,oldSql),after=await snapshot(db,oldSql,'pg_catalog,parity_probe');
  assert.deepEqual(changes(before,after),['columns','policies']);
  const owner=d=>d.columns.find(c=>c.nspname==='parity_probe'&&c.attname==='owner_id');
  assert.equal(owner(before).column_default,'uid()');assert.equal(owner(after).column_default,'auth_probe.uid()');
  assert.notEqual(before.policies[0].using_expression,after.policies[0].using_expression);
  const current=await snapshot(db);assert.deepEqual(current,await snapshot(db,currentSql,'pg_catalog,parity_probe'));
  assert.equal(owner(current).column_default,'auth_probe.uid()');
  assert.match(current.policies[0].using_expression,/auth_probe\.uid\(\)/);
 }finally{await db.close();}
});
test('actual non-pretty policy-expression round-trip and visible rebuild preserve the NEW full catalog',async()=>{
 const p=await pair({dropped:true});try{
  await p.a.exec('set search_path=pg_catalog');await p.b.exec('set search_path=pg_catalog');
  const policy=(await p.a.query("select pg_get_expr(polqual,polrelid,false)as u,pg_get_expr(polwithcheck,polrelid,false)as c from pg_policy where polname='owner_allowed'")).rows[0];
  await p.b.exec(`drop policy owner_allowed on parity_probe.cases;create policy owner_allowed on parity_probe.cases to parity_reader_alpha,parity_reader_zeta using(${policy.u})with check(${policy.c});`);
  assert.deepEqual(changes(await snapshot(p.a,oldSql),await snapshot(p.b,oldSql)),['columns']);
  assert.deepEqual(await snapshot(p.a),await snapshot(p.b));
 }finally{await close(p);}
});
test('OLD constant aggregate ORDER BY preserves differing policy input order; NEW sorts the same real role set',async()=>{
 const p=await pair({}, {reverseRoleCreation:true});try{
  await p.b.exec('alter policy owner_allowed on parity_probe.cases to parity_reader_zeta,parity_reader_alpha;');
  const before=await snapshot(p.a,oldSql),after=await snapshot(p.b,oldSql);
  assert.deepEqual(changes(before,after),['policies']);
  assert.notDeepEqual(before.policies[0].roles,after.policies[0].roles);
  assert.deepEqual([...before.policies[0].roles].sort(),[...after.policies[0].roles].sort());
  const raw=db=>db.query("select array(select pg_get_userbyid(x)from unnest(polroles)x)as names from pg_policy where polname='owner_allowed'");
  assert.notDeepEqual((await raw(p.a)).rows[0].names,(await raw(p.b)).rows[0].names);
  // Execute separately: adding a second sorted aggregate can change shared
  // input order and accidentally mask the constant ORDER BY defect.
  const constant=(await p.a.query("select array_agg(x order by 1)as roles from(values('zeta'),('alpha'))t(x)")).rows[0].roles;
  const named=(await p.a.query("select array_agg(x order by x)as roles from(values('zeta'),('alpha'))t(x)")).rows[0].roles;
  assert.deepEqual(constant,['zeta','alpha']);assert.deepEqual(named,['alpha','zeta']);
  assert.deepEqual(await snapshot(p.a),await snapshot(p.b));
 }finally{await close(p);}
});
const realDrifts=[
 ['column type','alter table parity_probe.cases alter column id type text using id::text;','columns'],
 ['column default',"alter table parity_probe.cases alter column owner_id set default '00000000-0000-4000-8000-000000000002'::uuid;",'columns'],
 ['column nullability','alter table parity_probe.cases alter column tag drop not null;','columns'],
 ['policy body',"alter policy owner_allowed on parity_probe.cases with check(owner_id=auth_probe.uid()and tag='allowed');",'policies'],
 ['removed policy role','alter policy owner_allowed on parity_probe.cases to parity_reader_alpha;','policies'],
 ['added policy role','alter policy owner_allowed on parity_probe.cases to parity_reader_alpha,parity_reader_zeta,parity_other;','policies'],
 ['RLS enabled flag','alter table parity_probe.cases disable row level security;','relations'],
 ['RLS forced flag','alter table parity_probe.cases force row level security;','relations'],
 ['relation grant','grant select on parity_probe.cases to parity_other;','relation_grants'],
 ['schema grant','grant usage on schema auth_probe to parity_other;','schema_grants'],
 ['function grant','revoke execute on function auth_probe.uid()from public;','function_grants'],
 ['function security definer','alter function auth_probe.uid()security definer;','functions'],
];
for(const [label,mutation,category]of realDrifts)test('NEW actual full query still detects '+label,async()=>{
 const p=await pair({dropped:true});try{
  const before=await snapshot(p.a);assert.deepEqual(before,await snapshot(p.b));
  await p.b.exec(mutation);const after=await snapshot(p.b);
  assert.notDeepEqual(before,after);assert.ok(changes(before,after).includes(category));
 }finally{await close(p);}
});
test('NEW visible ordinals still detect actual visible column-order changes',async()=>{
 const p=await pair({dropped:true},{reorder:true});try{
  assert.deepEqual(changes(await snapshot(p.a),await snapshot(p.b)),['columns']);
 }finally{await close(p);}
});
