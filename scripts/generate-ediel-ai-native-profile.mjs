/** Exact native projection of the EXISTING canonical facade. Does not fetch or
 * authenticate original bytes and does not select a guide by local dates. */
import {createServer} from 'vite'
import {readFileSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
const file=process.argv[2]
if(!file)throw Error('Migration path required')
const server=await createServer({configFile:false,resolve:{alias:{'@':process.cwd()}},server:{middlewareMode:true}})
try{
 const {canonicalAiListProfile}=await server.ssrLoadModule('/lib/ediel/rulebook/canonicalEdielFacade.ts')
 const profile=canonicalAiListProfile()
 const projected={sourceId:profile.sourceId,guideRevision:profile.guideRevision,technicalVersion:profile.technicalVersion,sourceSha256:profile.sourceSha256,format:profile.format,provenance:'frozen_masterplan_projection'}
 const line=" SELECT '"+JSON.stringify(projected).replace(/'/g,"''")+"'::jsonb"
 const path=resolve(file),old=readFileSync(path,'utf8'),updated=old.replace(/-- BEGIN CANONICAL AI PROFILE PROJECTION\n[\s\S]*?\n-- END CANONICAL AI PROFILE PROJECTION/,`-- BEGIN CANONICAL AI PROFILE PROJECTION\n${line}\n-- END CANONICAL AI PROFILE PROJECTION`)
 if(old===updated&&process.argv.includes('--check'))console.log('PASS: native AI profile is an exact canonical-facade frozen-masterplan projection; no original-byte authentication claimed.')
 else if(process.argv.includes('--check'))throw Error('Native canonical AI projection differs')
 else writeFileSync(path,updated)
}finally{await server.close()}
