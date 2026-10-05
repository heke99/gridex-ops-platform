/** Exact native projection of the EXISTING canonical facade. Does not fetch or
 * authenticate original bytes and does not select a guide by local dates. */
import {createServer} from 'vite'
import {readFileSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
const file=process.argv[2]
if(!file)throw Error('Migration path required')
const server=await createServer({configFile:false,resolve:{alias:{'@':process.cwd()}},server:{middlewareMode:true}})
try{
 const {canonicalProdatMethodChangeTuple}=await server.ssrLoadModule('/lib/ediel/rulebook/canonicalEdielFacade.ts')
 const profile={F:canonicalProdatMethodChangeTuple('F'),G:canonicalProdatMethodChangeTuple('G')}
 const projected=profile
 const line=" SELECT '"+JSON.stringify(projected).replace(/'/g,"''")+"'::jsonb"
 const path=resolve(file),old=readFileSync(path,'utf8'),updated=old.replace(/-- BEGIN CANONICAL METHOD CHANGE PROJECTION\n[\s\S]*?\n-- END CANONICAL METHOD CHANGE PROJECTION/,`-- BEGIN CANONICAL METHOD CHANGE PROJECTION\n${line}\n-- END CANONICAL METHOD CHANGE PROJECTION`)
 if(old===updated&&process.argv.includes('--check'))console.log('PASS: native method-change tuple is an exact canonical-facade frozen-masterplan projection; no original-byte authentication claimed.')
 else if(process.argv.includes('--check'))throw Error('Native canonical method-change projection differs')
 else writeFileSync(path,updated)
}finally{await server.close()}
