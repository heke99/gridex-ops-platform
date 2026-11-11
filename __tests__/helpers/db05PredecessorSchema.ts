import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'

type Patch={preSha256:string;postSha256:string;hunks:{postStart:number;postCount:number;postSha256:string;preLines:string[]}[]}
const sha=(text:string)=>createHash('sha256').update(text).digest('hex')

function reversePatch(schema:string,patch:Patch):string{
 if(sha(schema)!==patch.postSha256)throw Error('db05_schema_predecessor_unknown:'+sha(schema))
 const lines=schema.split('\n')
 for(const hunk of [...patch.hunks].reverse()){
  if(sha(lines.slice(hunk.postStart,hunk.postStart+hunk.postCount).join('\n'))!==hunk.postSha256)throw Error('db05_schema_predecessor_hunk_changed:'+hunk.postStart)
  lines.splice(hunk.postStart,hunk.postCount,...hunk.preLines)
 }
 const rebuilt=lines.join('\n')
 if(sha(rebuilt)!==patch.preSha256)throw Error('db05_schema_predecessor_rebuild_mismatch')
 return rebuilt
}

// Exact gitdiff of genuine a9cf RAW3 -> 9e RAW3 (079 view only).
// Reverse only these two pinned hunks; historical047 fixture/provenance stays unchanged.
const local079Patch:Patch={"preSha256":"f8e0964d0f3a51d37ef85a0e0febb21a78b7e91cea12e42d56dcb234ff1669ed","postSha256":"a825c79079b1fad25bc1396d241a19f097020c7567134da40729648c74ec4136","hunks":[{"postStart":131178,"postCount":1,"postSha256":"a5598aee47243c2f5192f9332b2fe27b29638fcf5cbe5b7e9efab5f993c001c4","preLines":["          WHERE ((brp.company_id = c.id) AND (brp.environment = 'production'::text)))) AS has_brp,"]},{"postStart":131208,"postCount":1,"postSha256":"8c5d668fc415b233755ef14025ca9f9c5d22f0b0725d5e4e830502fa9698ad5e","preLines":["          WHERE ((s.company_id = c.id) AND (lower(COALESCE(s.verification_status, ''::text)) = ANY (ARRAY['verified'::text, 'completed'::text, 'active'::text]))))) AS has_sender_identity,"]}]}

// Authentic capture-only run42920177040, source19c177, receipt417e8338.
// Exact8hunk genuine f8 -> f25d diff; never replace the original047 inverse.
const local1049Patch:Patch={"preSha256":"f8e0964d0f3a51d37ef85a0e0febb21a78b7e91cea12e42d56dcb234ff1669ed","postSha256":"f25d892e78532bb5fc02c9470c8a7a2c0b6216b65f756918636730eb94c20137","hunks":[{"postStart":210,"postCount":6,"postSha256":"6389ab94d13bbc44c4b24169c0ed51b17ec300a29be547973afe67de0865c938","preLines":[]},{"postStart":19027,"postCount":313,"postSha256":"e859414efd5b5d35b115c142e4b98cc41690d2b7d34aed808fd8cc40a2c9e7a7","preLines":[]},{"postStart":42510,"postCount":29,"postSha256":"340dfbb003a539a03cce437ea8d2dac0de2d0ee378a70c286f5065e75b242a2f","preLines":[]},{"postStart":44824,"postCount":9,"postSha256":"4765b4992a54f56125fd05f4fde69532dab425ad5c269317e65c475431ced4ff","preLines":[]},{"postStart":122836,"postCount":5,"postSha256":"431e9a2c804504a0b338284bd7474979274962b0db60c144ff8cce33993811dd","preLines":[]},{"postStart":159085,"postCount":78,"postSha256":"de460f35db528d69660e11162b2d93847a2b4e6a334aae080445407f76fdd299","preLines":[]},{"postStart":202695,"postCount":24,"postSha256":"32eb1ffc4bfbd2010395391fd70e8518059261dde239933387854e57d68c5731","preLines":[]},{"postStart":206367,"postCount":7,"postSha256":"847fe7a01452c16bc16c09a68f5048216da28784a538e143a1b559a720aabc06","preLines":[]}]}

/** Reverse only authentic local047 RAW3, then retain the unchanged historical chain. */
export function preLocal047Schema(schema:string):string{
 if(sha(schema)==='f25d892e78532bb5fc02c9470c8a7a2c0b6216b65f756918636730eb94c20137')return preLocal047Schema(reversePatch(schema,local1049Patch))
 if(sha(schema)==='a825c79079b1fad25bc1396d241a19f097020c7567134da40729648c74ec4136')return preLocal047Schema(reversePatch(schema,local079Patch))
 const actual=sha(schema)
 if(actual==='a0f788f2517b919c91dc4c655565da04a456548a25692f0de7fb25bcd4046afc')return schema
 if(actual!=='f8e0964d0f3a51d37ef85a0e0febb21a78b7e91cea12e42d56dcb234ff1669ed')throw Error('db05_schema_predecessor_unknown:'+actual)
 const patch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-local047-20261107.patch.json',import.meta.url),'utf8'))
 if(patch.preSha256!=='a0f788f2517b919c91dc4c655565da04a456548a25692f0de7fb25bcd4046afc'||patch.postSha256!==actual)throw Error('db05_schema_predecessor_rebuild_mismatch')
 return reversePatch(schema,patch)
}

/** Restore only the exact genuine PR949 capture to the unchanged PR973 bytes.
 * Source3e8a830c/artifact13063971334 changes the bounded CONTRL function only;
 * this inverse grants no native, performance or whole-business credit. */
function prePr949ContrlSchema(schema:string):string{
 const pr949:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-pr949-contrl-20261101.patch.json',import.meta.url),'utf8'))
 if(pr949.preSha256!=='bf4370087bed7d9ed8ff754a9c3468443b60d05442f7f9b85d42dc77a0f5538b'||pr949.postSha256!=='a0f788f2517b919c91dc4c655565da04a456548a25692f0de7fb25bcd4046afc')throw Error('db05_schema_predecessor_rebuild_mismatch')
 return reversePatch(schema,pr949)
}

/** Exact pre-PR973 PR932 capture. The genuine PR973 capture is reversed by
 * its generated patch; the PR932 capture itself is returned unchanged. Any
 * other capture fails closed. */
export function prePr973Audit19Schema(schema:string):string{
 if(sha(schema)==='f8e0964d0f3a51d37ef85a0e0febb21a78b7e91cea12e42d56dcb234ff1669ed'||sha(schema)==='a825c79079b1fad25bc1396d241a19f097020c7567134da40729648c74ec4136'||sha(schema)==='f25d892e78532bb5fc02c9470c8a7a2c0b6216b65f756918636730eb94c20137')return prePr973Audit19Schema(preLocal047Schema(schema))
 const actual=sha(schema)
 if(actual==='a0f788f2517b919c91dc4c655565da04a456548a25692f0de7fb25bcd4046afc')return prePr973Audit19Schema(prePr949ContrlSchema(schema))
 if(actual==='20b8165bd30260151e79c43e3759241a99266eddd0b3f47cead2518cbd10893b')return schema
 if(actual!=='bf4370087bed7d9ed8ff754a9c3468443b60d05442f7f9b85d42dc77a0f5538b')throw Error('db05_schema_predecessor_unknown:'+actual)
 // Genuine ordinary PR973 capture 4551eff2/artifact13019755967; the audit19
 // hash requalification is its only hunk.
 const pr973:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-pr973-audit19-20261030.patch.json',import.meta.url),'utf8'))
 if(pr973.preSha256!=='20b8165bd30260151e79c43e3759241a99266eddd0b3f47cead2518cbd10893b'||pr973.postSha256!==actual)throw Error('db05_schema_predecessor_rebuild_mismatch')
 return reversePatch(schema,pr973)
}

/** Exact pre-PR932 C14 capture. The genuine PR932 capture is reversed by its
 * generated patch; the C14 capture itself is returned unchanged. Any other
 * capture fails closed. */
export function prePr932UnsignedEditSchema(schema:string):string{
 if(sha(schema)==='f8e0964d0f3a51d37ef85a0e0febb21a78b7e91cea12e42d56dcb234ff1669ed'||sha(schema)==='a825c79079b1fad25bc1396d241a19f097020c7567134da40729648c74ec4136'||sha(schema)==='f25d892e78532bb5fc02c9470c8a7a2c0b6216b65f756918636730eb94c20137')return prePr932UnsignedEditSchema(preLocal047Schema(schema))
 const actual=sha(schema)
 if(actual==='a0f788f2517b919c91dc4c655565da04a456548a25692f0de7fb25bcd4046afc')return prePr932UnsignedEditSchema(prePr949ContrlSchema(schema))
 if(actual==='aa5d9975d3398081ea157d916308444b3e940f14fe5c9944815eff858cdac0a6')return schema
 if(actual==='bf4370087bed7d9ed8ff754a9c3468443b60d05442f7f9b85d42dc77a0f5538b')return prePr932UnsignedEditSchema(prePr973Audit19Schema(schema))
 if(actual!=='20b8165bd30260151e79c43e3759241a99266eddd0b3f47cead2518cbd10893b')throw Error('db05_schema_predecessor_unknown:'+actual)
 const pr932:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-pr932-unsigned-edit-20261029.patch.json',import.meta.url),'utf8'))
 if(pr932.preSha256!=='aa5d9975d3398081ea157d916308444b3e940f14fe5c9944815eff858cdac0a6'||pr932.postSha256!==actual)throw Error('db05_schema_predecessor_rebuild_mismatch')
 return reversePatch(schema,pr932)
}

/** Exact pre-DB-05 schema.sql capture. The checked-in capture is either that
 * predecessor or an authenticated post-DB-05 GEN; each is reversed by
 * the generated patch and the result must hash to the pinned predecessor.
 * Any other capture fails closed. */
export function db05PredecessorSchema(schema:string):string{
 if(sha(schema)==='f8e0964d0f3a51d37ef85a0e0febb21a78b7e91cea12e42d56dcb234ff1669ed'||sha(schema)==='a825c79079b1fad25bc1396d241a19f097020c7567134da40729648c74ec4136'||sha(schema)==='f25d892e78532bb5fc02c9470c8a7a2c0b6216b65f756918636730eb94c20137')return db05PredecessorSchema(preLocal047Schema(schema))
 let patch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor.patch.json',import.meta.url),'utf8'))
 const actual=sha(schema)
 if(actual==='a0f788f2517b919c91dc4c655565da04a456548a25692f0de7fb25bcd4046afc')return db05PredecessorSchema(prePr949ContrlSchema(schema))
 if(actual==='bf4370087bed7d9ed8ff754a9c3468443b60d05442f7f9b85d42dc77a0f5538b'||actual==='20b8165bd30260151e79c43e3759241a99266eddd0b3f47cead2518cbd10893b'){
  // Genuine ordinary PR973 4551eff2/artifact13019755967 or PR932 capture
  // 9c39bd60/artifact12981765531. Restore the exact C14 bytes before every unchanged older inverse; no native credit.
  return db05PredecessorSchema(prePr932UnsignedEditSchema(schema))
 }
 if(actual==='aa5d9975d3398081ea157d916308444b3e940f14fe5c9944815eff858cdac0a6'){
  // Genuine ordinary C14 capture03e5eac4/artifact12864584609. Restore exact
  // C12 bytes before every unchanged older inverse; no native/runtime credit.
  const tenantKey:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-poa-tenant-key-20261029.patch.json',import.meta.url),'utf8'))
  if(tenantKey.preSha256!=='4a0a481dd5b6af7323f45dd78b5f03f37d08cc3ae244fbd9ea1074f3803d0746'||tenantKey.postSha256!==actual)throw Error('db05_schema_predecessor_rebuild_mismatch')
  return db05PredecessorSchema(reversePatch(schema,tenantKey))
 }
 if(actual==='4a0a481dd5b6af7323f45dd78b5f03f37d08cc3ae244fbd9ea1074f3803d0746'){
  // Genuine ordinary C12 capture011c1c44/artifact12862355503. Restore the
  // unchanged3132 POA capture before every historical DB05 inverse/oracle.
  // This finite inverse grants no confirmation/POA native or business proof.
  const successor:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-poa-20261029.patch.json',import.meta.url),'utf8'))
  if(successor.preSha256!=='313208382efbca3f87375e054352f96d4dfc33e4e48fcf1d1d21bf64698e6e9b'||successor.postSha256!==actual)throw Error('db05_schema_predecessor_rebuild_mismatch')
  return db05PredecessorSchema(reversePatch(schema,successor))
 }
 if(actual==='313208382efbca3f87375e054352f96d4dfc33e4e48fcf1d1d21bf64698e6e9b'){
  // Genuine ordinary POA capture23491/artifact12845430969. This inverse only
  // preserves historical DB05 fixtures; it grants no proof for the new POA SQL.
  const poaPatch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-poa-20261028.patch.json',import.meta.url),'utf8'))
  if(poaPatch.preSha256!=='4ab0c60bd5688e9653927491981f779b374a3a85600d8a87e050ac67f15a15ca'||poaPatch.postSha256!==actual)throw Error('db05_schema_predecessor_rebuild_mismatch')
  return db05PredecessorSchema(reversePatch(schema,poaPatch))
 }
 if(actual==='4ab0c60bd5688e9653927491981f779b374a3a85600d8a87e050ac67f15a15ca'){
  // Genuine ordinary G3 capture012cc8bf/artifact12561956311. Rebuild exact
  // MAIN3d08 capture before its unchanged audit28 -> audit27 -> audit26 chain.
  const audit29Patch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-audit29.patch.json',import.meta.url),'utf8'))
  if(audit29Patch.preSha256!=='69ada64839584b3576e9b57471143f1ce23c0e87bdc724f9f2261ed15fdfa85b'||audit29Patch.postSha256!==actual)throw Error('db05_schema_predecessor_rebuild_mismatch')
  return db05PredecessorSchema(reversePatch(schema,audit29Patch))
 }
 if(actual==='69ada64839584b3576e9b57471143f1ce23c0e87bdc724f9f2261ed15fdfa85b'){
  // Genuine ordinary MAIN capture from 3d08. Rebuild exact S01 capture before
  // its unchanged audit27 -> audit26 -> pinned predecessor chain.
  const audit28Patch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-audit28.patch.json',import.meta.url),'utf8'))
  if(audit28Patch.preSha256!=='fc6968d3f4d4f4e8fe9a487f3af9851c1f29d7ea708dee61f57cfa65dc4ebb4a'||audit28Patch.postSha256!==actual)throw Error('db05_schema_predecessor_rebuild_mismatch')
  return db05PredecessorSchema(reversePatch(schema,audit28Patch))
 }
 if(actual==='fc6968d3f4d4f4e8fe9a487f3af9851c1f29d7ea708dee61f57cfa65dc4ebb4a'){
  // Genuine ordinary capture0ede/artifact12534357628 adds only the bounded S01
  // generated successor. Rebuild exact audit26 input before its existing proof.
  const audit27Patch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-audit27.patch.json',import.meta.url),'utf8'))
  if(audit27Patch.preSha256!=='47726959555e64a527ab2353f9532958fe6cc06bd75235375f33a04d4f231022'||audit27Patch.postSha256!==actual)throw Error('db05_schema_predecessor_rebuild_mismatch')
  return db05PredecessorSchema(reversePatch(schema,audit27Patch))
 }
 if(actual==='a15291106e26b9bea9f70dd99f3c19f6cae7e159afd8a5d4674a997d98c2eac6'){
  const mailPatch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-mail.patch.json',import.meta.url),'utf8'))
  if(mailPatch.preSha256!==patch.preSha256)throw Error('db05_schema_predecessor_rebuild_mismatch')
  patch=mailPatch
 }
 if(actual==='82df2a64df29439af19b4d0ff7b513e43d4e1a4dceb67818f65b8f8620ee2fa6'){
  const auditPatch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-audit21.patch.json',import.meta.url),'utf8'))
  if(auditPatch.preSha256!==patch.preSha256)throw Error('db05_schema_predecessor_rebuild_mismatch')
  patch=auditPatch
 }
 if(actual==='9eab8f0798ef736aba5bc24de56fb24876105a652ee7d701f9764c14c98b7c24'){
  const audit22Patch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-audit22.patch.json',import.meta.url),'utf8'))
  if(audit22Patch.preSha256!==patch.preSha256)throw Error('db05_schema_predecessor_rebuild_mismatch')
  patch=audit22Patch
 }
 if(actual==='1f1e8ca5458470bc7cd06ab027ffbace8af3cbc02013c83e692bc5215ad35d28'){
  const audit23Patch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-audit23.patch.json',import.meta.url),'utf8'))
  if(audit23Patch.preSha256!==patch.preSha256)throw Error('db05_schema_predecessor_rebuild_mismatch')
  patch=audit23Patch
 }
 if(actual==='a4e65c958a235616961ad8b634f49da444f6da94025064e8d37b0f549708c1e9'){
  const audit24Patch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-audit24.patch.json',import.meta.url),'utf8'))
  if(audit24Patch.preSha256!==patch.preSha256)throw Error('db05_schema_predecessor_rebuild_mismatch')
  patch=audit24Patch
 }
 if(actual==='4383694c97944f44900e66929358d5e0acae3b57332e9f30730d6678531d07ad'){
  const audit25Patch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-audit25.patch.json',import.meta.url),'utf8'))
  if(audit25Patch.preSha256!==patch.preSha256)throw Error('db05_schema_predecessor_rebuild_mismatch')
  patch=audit25Patch
 }
 if(actual==='47726959555e64a527ab2353f9532958fe6cc06bd75235375f33a04d4f231022'){
  const audit26Patch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-audit26.patch.json',import.meta.url),'utf8'))
  if(audit26Patch.preSha256!==patch.preSha256)throw Error('db05_schema_predecessor_rebuild_mismatch')
  patch=audit26Patch
 }
 if(actual===patch.preSha256)return schema
 if(actual!==patch.postSha256)throw Error('db05_schema_predecessor_unknown:'+actual)
 return reversePatch(schema,patch)
}
