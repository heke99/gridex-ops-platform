import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'

type Patch={preSha256:string;postSha256:string;hunks:{postStart:number;postCount:number;postSha256:string;preLines:string[]}[]}
const sha=(text:string)=>createHash('sha256').update(text).digest('hex')

/** Exact pre-DB-05 schema.sql capture. The checked-in capture is either that
 * predecessor or the authenticated post-DB-05 GEN; the latter is reversed by
 * the generated patch and the result must hash to the pinned predecessor.
 * Any other capture fails closed. */
export function db05PredecessorSchema(schema:string):string{
 const patch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor.patch.json',import.meta.url),'utf8'))
 const actual=sha(schema)
 if(actual===patch.preSha256)return schema
 if(actual!==patch.postSha256)throw Error('db05_schema_predecessor_unknown:'+actual)
 const lines=schema.split('\n')
 for(const hunk of [...patch.hunks].reverse()){
  if(sha(lines.slice(hunk.postStart,hunk.postStart+hunk.postCount).join('\n'))!==hunk.postSha256)throw Error('db05_schema_predecessor_hunk_changed:'+hunk.postStart)
  lines.splice(hunk.postStart,hunk.postCount,...hunk.preLines)
 }
 const rebuilt=lines.join('\n')
 if(sha(rebuilt)!==patch.preSha256)throw Error('db05_schema_predecessor_rebuild_mismatch')
 return rebuilt
}
