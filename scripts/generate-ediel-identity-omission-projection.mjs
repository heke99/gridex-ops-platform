/** Exact derivative of the existing field209 matrix/subtype owner, not a new
 * national table or rule selector. Publish changes only in new forwards. */
import {createServer} from 'vite'
import {readFileSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
const file=process.argv[2]
if(!file)throw Error('Migration path required')
const server=await createServer({configFile:false,resolve:{alias:{'@':process.cwd()}},server:{middlewareMode:true,watch:null}})
try{
 const {prodatIdentityOmissionCases}=await server.ssrLoadModule('/lib/ediel/prodat/prodatIdentityOmissionScope.ts')
 const line=" SELECT '"+JSON.stringify(prodatIdentityOmissionCases()).replace(/'/g,"''")+"'::jsonb"
 const path=resolve(file),old=readFileSync(path,'utf8'),updated=old.replace(/-- BEGIN CANONICAL IDENTITY OMISSION PROJECTION\n[\s\S]*?\n-- END CANONICAL IDENTITY OMISSION PROJECTION/,`-- BEGIN CANONICAL IDENTITY OMISSION PROJECTION\n${line}\n-- END CANONICAL IDENTITY OMISSION PROJECTION`)
 if(process.argv.includes('--check')){if(old!==updated)throw Error('Native field209 omission projection differs');console.log('PASS same field209/subtype-owner projection')}
 else writeFileSync(path,updated)
}finally{await server.close()}
