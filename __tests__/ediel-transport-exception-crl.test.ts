// masterplan: TR-09, AT-TR-09
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID, X509Certificate } from 'node:crypto'
const io=vi.hoisted(()=>({rpc:vi.fn(), legacyZeroExit:false}))
vi.mock('node:child_process', async importOriginal => {
 const actual=await importOriginal<typeof import('node:child_process')>()
 const {promisify}=await import('node:util')
 const execute=promisify(actual.execFile),execFile=actual.execFile.bind(undefined)
 // Declared legacy OpenSSL process port: real cryptography, original streams,
 // only its known exit-zero-on-signature-failure convention is emulated.
 Object.defineProperty(execFile,promisify.custom,{value:async(file:string,args:string[],options:import('node:child_process').ExecFileOptions)=>{
  try{return await execute(file,args,options)}catch(error){
   const result=error as Error & {code?:number;stdout?:string;stderr?:string}
   if(io.legacyZeroExit&&file==='openssl'&&args[0]==='crl'&&args.includes('-verify')&&result.code===1
    &&typeof result.stdout==='string'&&typeof result.stderr==='string'&&result.stderr.includes('verify failure'))
    return {stdout:result.stdout,stderr:result.stderr}
   throw error
  }
 }})
 return {...actual,execFile}
})
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {rpc:io.rpc} }))
import { type EdielCertificateTrustAuthority } from '@/lib/ediel/security/certificateTrust'
const scope = { companyId: randomUUID(), environment: 'test' as const, receiverEdielId: '76543' }
let directory: string, leaf: string, authority: EdielCertificateTrustAuthority, cleanCrl: string, revokedCrl: string, actuallyExpiredCrl:string
function openssl(args: string[]) { return execFileSync('openssl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) }
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'ediel-trust-unit-'))
  const path = (name: string) => join(directory, name)
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path('ca.key'), '-out', path('ca.pem'), '-days', '365', '-subj', '/CN=Synthetic unit CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign'])
  openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', path('leaf.key'), '-out', path('leaf.csr'), '-subj', '/CN=Synthetic unit recipient'])
  writeFileSync(path('index.txt'), ''); writeFileSync(path('serial'), '1000'); writeFileSync(path('crlnumber'), '1000')
  writeFileSync(path('ca.cnf'), `[ca]\ndefault_ca=main\n[main]\ndatabase=${path('index.txt')}\nnew_certs_dir=${directory}\ncertificate=${path('ca.pem')}\nprivate_key=${path('ca.key')}\nserial=${path('serial')}\ncrlnumber=${path('crlnumber')}\ndefault_days=365\ndefault_crl_days=1\ndefault_md=sha256\npolicy=policy\nx509_extensions=recipient\n[policy]\ncommonName=supplied\n[recipient]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=emailProtection\ncrlDistributionPoints=URI:https://synthetic.example.invalid/current.crl\n`)
  openssl(['ca', '-config', path('ca.cnf'), '-batch', '-in', path('leaf.csr'), '-out', path('leaf.pem')])
  const crlDate=(at:number)=>new Date(at).toISOString().replace(/[-:T]/g,'').replace(/\.\d{3}Z$/,'Z')
  openssl(['ca','-config',path('ca.cnf'),'-gencrl','-crl_lastupdate',crlDate(Date.now()-2*86400_000),'-crl_nextupdate',crlDate(Date.now()-86400_000),'-out',path('actually-expired.crl')])
  actuallyExpiredCrl=readFileSync(path('actually-expired.crl'),'utf8')
  openssl(['ca', '-config', path('ca.cnf'), '-gencrl', '-out', path('clean.crl')])
  leaf = readFileSync(path('leaf.pem'), 'utf8'); cleanCrl = readFileSync(path('clean.crl'), 'utf8')
  openssl(['ca', '-config', path('ca.cnf'), '-revoke', path('leaf.pem')]); openssl(['ca', '-config', path('ca.cnf'), '-gencrl', '-out', path('revoked.crl')]); revokedCrl = readFileSync(path('revoked.crl'), 'utf8')
  const now = Date.now()
  authority = { ...scope, registrationId: randomUUID(), registerVersion: 'synthetic-version', originalReference: 'synthetic://crypto-unit-only', originalSha256: 'a'.repeat(64), authorizationReference: 'synthetic://unit-only-does-not-authorize-live',
    validFrom: new Date(now - 60_000).toISOString(), validTo: new Date(now + 31 * 86400_000).toISOString(), recipientFingerprints: [new X509Certificate(leaf).fingerprint256.replaceAll(':', '').toLowerCase()], anchors: [readFileSync(path('ca.pem'), 'utf8')], intermediates: [], crls: [cleanCrl] }
})
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }) })
afterEach(()=>{io.rpc.mockReset();io.legacyZeroExit=false})
const verifierPath=new URL('../lib/ediel/transport/exception/previousCrl.ts',import.meta.url)
const sha=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex')
async function verify(crl=cleanCrl,at=new Date(Date.now()+2*86400_000),hashes=[sha(crl)]){
 if(!existsSync(fileURLToPath(verifierPath)))return {verified:false,code:'previous_crl_verifier_missing'}
 return (await import('@/lib/ediel/transport/exception/previousCrl')).verifyPreviousSignedCrlCryptography({
  scope,leafPem:leaf,authority:{...authority,crls:[crl]},priorCrlSha256:hashes,cdpLocations:['https://synthetic.example.invalid/current.crl'],now:at})
}
it('verifies a real nearest-prior signed CRL after its expiry while leaf and CA remain current',async()=>{
 expect(await verify()).toMatchObject({verified:true,leafFingerprint:new X509Certificate(leaf).fingerprint256.replaceAll(':','').toLowerCase()})
})
it('keeps an actually revoked recipient held even under a prior-CRL reserve procedure',async()=>{
 expect(await verify(revokedCrl)).toMatchObject({verified:false})
})
it('refuses prior CRL bytes different from the immutable exception source',async()=>{
 expect(await verify(cleanCrl,new Date(Date.now()+2*86400_000),['f'.repeat(64)])).toMatchObject({verified:false})
})
it('keeps actual expired leaf/CA dates current rather than rewinding to CRL validity',async()=>{
 expect(await verify(cleanCrl,new Date(Date.now()+400*86400_000))).toMatchObject({verified:false})
})
it('refuses a corrupted CRL even when its issuer, dates and source digest claim a reserve case',async()=>{
 const lines=cleanCrl.split('\n');lines[2]=(lines[2][0]==='A'?'B':'A')+lines[2].slice(1)
 expect(await verify(lines.join('\n'))).toMatchObject({verified:false})
})
it('holds a structurally valid CRL whose signature fails even when OpenSSL exits zero',async()=>{
 const original=join(directory,'clean.crl'),derPath=join(directory,'bad-signature.der'),badPath=join(directory,'bad-signature.crl')
 const der=execFileSync('openssl',['crl','-in',original,'-outform','DER'],{stdio:['ignore','pipe','pipe']})
 // Change only the last signature octet, retaining every signed issuer/date
 // and revoked-serial byte; the new source digest remains correctly bound.
 der[der.length-1]^=1;writeFileSync(derPath,der)
 openssl(['crl','-inform','DER','-in',derPath,'-out',badPath])
 const metadata=(path:string)=>openssl(['crl','-in',path,'-noout','-issuer','-lastupdate','-nextupdate'])
 expect(metadata(badPath)).toBe(metadata(original))
 const result=spawnSync('openssl',['crl','-in',badPath,'-noout','-verify','-CAfile',join(directory,'ca.pem')],
  {encoding:'utf8',timeout:10000,maxBuffer:65536,stdio:['ignore','pipe','pipe']})
 expect(result.error).toBeUndefined();expect(result.signal).toBeNull()
 expect([0,1]).toContain(result.status);expect(result.stdout.trim()).toBe('')
 expect(result.stderr).toContain('verify failure')
 const badCrl=readFileSync(badPath,'utf8')
 if(result.status===1)expect(await verify(badCrl)).toMatchObject({verified:false})
 io.legacyZeroExit=true
 expect(await verify(badCrl)).toMatchObject({verified:false})
})
it('refuses an all-CDP claim that omits the actual certificate distribution point',async()=>{
 const verify=(await import('@/lib/ediel/transport/exception/previousCrl')).verifyPreviousSignedCrlCryptography
 expect(await verify({scope,leafPem:leaf,authority,priorCrlSha256:[sha(cleanCrl)],cdpLocations:['https://synthetic.example.invalid/foreign.crl']})).toMatchObject({verified:false})
})
it('actual trust ingress permits expired CRL only inside the issued exact owner scope, then restores strict verification',async()=>{
 const {verifyEdielCertificateTrust}=await import('@/lib/ediel/security/certificateTrust')
 const {readTransportExceptionAuthorization,withTransportExceptionCertificateScope}=await import('@/lib/ediel/transport/exception/source')
 const message={id:randomUUID(),company_id:scope.companyId,environment:'test',direction:'outbound',message_standard:'edifact',message_family:'PRODAT',
  raw_payload:'synthetic crypto ingress original',communication_route_id:randomUUID(),sender_ediel_id:'43210',receiver_ediel_id:scope.receiverEdielId,receiver_email:'synthetic@example.invalid'} as import('@/lib/ediel/types').EdielMessageRow
 const actorUserId=randomUUID(),exceptionId=randomUUID(),a={...authority,crls:[actuallyExpiredCrl]}
 io.rpc.mockResolvedValue({error:null,data:{status:'authorized',version:1,approvalId:exceptionId,companyId:scope.companyId,environment:'test',messageId:message.id,actorUserId,
  originalHash:sha(message.raw_payload!),routeId:message.communication_route_id,senderEdielId:message.sender_ediel_id,receiverEdielId:message.receiver_ediel_id,receiverEmail:message.receiver_email,
  case:'crl_refresh_failure',sourceDigest:'a'.repeat(64),approvalDigest:'b'.repeat(64),tlsEvidenceDigest:'c'.repeat(64),
  validFrom:new Date(Date.now()-60000).toISOString(),validTo:new Date(Date.now()+600000).toISOString(),priorCrlSha256:[sha(actuallyExpiredCrl)],
  certificateAuthorityId:a.registrationId,cdpLocations:['https://synthetic.example.invalid/current.crl']}})
 const capability=await readTransportExceptionAuthorization({message,actorUserId,exceptionId})
 expect(capability.status).toBe('authorized');if(capability.status!=='authorized')throw Error('synthetic owner port held')
 const verify=()=>verifyEdielCertificateTrust({scope,leafPem:leaf,authority:a})
 expect(await verify()).toMatchObject({verified:false})
 expect(await withTransportExceptionCertificateScope(capability,verify)).toMatchObject({verified:true})
 expect(await verify()).toMatchObject({verified:false})
 expect(()=>withTransportExceptionCertificateScope(structuredClone(capability),verify)).toThrow(/capability_invalid/)
 expect(await withTransportExceptionCertificateScope(capability,()=>verifyEdielCertificateTrust({scope,leafPem:leaf,authority:{...a,registrationId:randomUUID()}}))).toMatchObject({verified:false})
})
