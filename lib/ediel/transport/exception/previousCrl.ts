import {X509Certificate,createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {promisify} from 'node:util'
import type {EdielCertificateTrustAuthority,EdielCertificateTrustResult,EdielCertificateTrustScope} from '@/lib/ediel/security/certificateTrust'
const execute=promisify(execFile),sha=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex')
const fp=(c:X509Certificate)=>c.fingerprint256.replaceAll(':','').toLowerCase()
const current=(c:X509Certificate,n:Date)=>Date.parse(c.validFrom)<=n.getTime()&&Date.parse(c.validTo)>n.getTime()
const serial=(s:string)=>BigInt('0x'+s.replaceAll(':','')).toString(16)
/** Cryptography only: callers need an independently issued, current private
 * reserve capability. Only CRL nextUpdate may be past; leaf/CA/PKIX use now.
 * Delta/indirect/critical CRL extensions stay held rather than approximated. */
export async function verifyPreviousSignedCrlCryptography(input:{scope:EdielCertificateTrustScope;leafPem:string;
 authority:EdielCertificateTrustAuthority;priorCrlSha256:readonly string[];cdpLocations:readonly string[];now?:Date}):Promise<EdielCertificateTrustResult>{
 const a=input.authority,n=input.now??new Date(),held=():EdielCertificateTrustResult=>({verified:false,code:'transport_exception_previous_crl_crypto_held'})
 if(!a||a.companyId!==input.scope.companyId||a.environment!==input.scope.environment||a.receiverEdielId!==input.scope.receiverEdielId
  ||!Number.isFinite(n.getTime())||!(Date.parse(a.validFrom)<=n.getTime()&&Date.parse(a.validTo)>n.getTime())
  ||!a.registrationId||!a.registerVersion||!a.authorizationReference||!a.originalReference||!/^[a-f0-9]{64}$/.test(a.originalSha256)
  ||!Array.isArray(a.anchors)||!a.anchors.length||a.anchors.length>16||!Array.isArray(a.intermediates)||a.intermediates.length>16
  ||!Array.isArray(a.crls)||!a.crls.length||a.crls.length>16||a.crls.length!==input.priorCrlSha256.length
  ||a.crls.some((p,i)=>typeof p!=='string'||p.length>1048576||sha(p)!==input.priorCrlSha256[i])
  ||!Array.isArray(input.cdpLocations)||input.cdpLocations.length<1||input.cdpLocations.length>16
  ||input.cdpLocations.some(v=>typeof v!=='string'||!v||v.length>2048)||new Set(input.cdpLocations).size!==input.cdpLocations.length
  ||typeof input.leafPem!=='string'||input.leafPem.length>1048576)return held()
 let directory:string|null=null
 try{
  const leaf=new X509Certificate(input.leafPem),pool=[...a.intermediates,...a.anchors].map(p=>new X509Certificate(p))
  if(!current(leaf,n)||!a.recipientFingerprints.includes(fp(leaf)))return held()
  const roots=new Set(a.anchors.map(p=>new X509Certificate(p)).filter(c=>c.ca&&current(c,n)).map(fp)),chain=[leaf],seen=new Set([fp(leaf)])
  while(!roots.has(fp(chain.at(-1)!))){
   const child=chain.at(-1)!,parents=pool.filter(p=>p.ca&&current(p,n)&&child.checkIssued(p)&&child.verify(p.publicKey)&&!seen.has(fp(p)))
   if(parents.length!==1||chain.length>=16)return held()
   chain.push(parents[0]);seen.add(fp(parents[0]))
  }
  if(chain.length<2)return held()
  directory=await mkdtemp(join(tmpdir(),'ediel-prior-crl-'))
  const leafPath=join(directory,'leaf.pem'),caPath=join(directory,'ca.pem'),intermediatePath=join(directory,'intermediates.pem')
  await Promise.all([writeFile(leafPath,input.leafPem,{mode:0o600}),writeFile(caPath,a.anchors.join('\n'),{mode:0o600}),writeFile(intermediatePath,a.intermediates.join('\n'),{mode:0o600})])
  const run=async(args:string[])=>(await execute('openssl',args,{timeout:10000,maxBuffer:65536})).stdout
  await run(['verify','-no-CApath','-no-CAstore','-CAfile',caPath,...(a.intermediates.length?['-untrusted',intermediatePath]:[]),
   '-purpose','smimeencrypt','-attime',String(Math.floor(n.getTime()/1000)),leafPath])
  const currentCdps=new Set<string>()
  for(let i=0;i<chain.length-1;i++){
   const path=join(directory,`cdp-certificate-${i}.pem`);await writeFile(path,chain[i].toString(),{mode:0o600})
   const cdpText=await run(['x509','-in',path,'-noout','-ext','crlDistributionPoints'])
   const locations=[...cdpText.matchAll(/URI:([^\r\n]+)/g)].map(m=>m[1].trim())
   // Non-URI distribution points stay held: their retrieval ownership needs a
   // precise adapter rather than a caller's "all CDPs" boolean.
   if(locations.length===0||/DirName:|Relative Name:/.test(cdpText))return held()
   locations.forEach(uri=>currentCdps.add(uri))
  }
  if(JSON.stringify([...currentCdps].sort())!==JSON.stringify([...input.cdpLocations].sort()))return held()
  const issuerNames:string[]=[],issuerPaths:string[]=[]
  for(let i=1;i<chain.length;i++){
   const path=join(directory,`issuer-${i}.pem`);await writeFile(path,chain[i].toString(),{mode:0o600});issuerPaths.push(path)
   issuerNames.push((await run(['x509','-in',path,'-noout','-subject','-nameopt','RFC2253'])).trim().replace(/^subject=/,''))
   const usage=await run(['x509','-in',path,'-noout','-text'])
   if(!/X509v3 Key Usage:[^\n]*\n\s*[^\n]*CRL Sign/.test(usage))return held()
  }
  const verifiedIssuers=new Set<number>()
  for(let i=0;i<a.crls.length;i++){
   const path=join(directory,`prior-${i}.pem`);await writeFile(path,a.crls[i],{mode:0o600})
   const issuerName=(await run(['crl','-in',path,'-noout','-issuer','-nameopt','RFC2253'])).trim().replace(/^issuer=/,'')
   const matches=issuerNames.flatMap((name,index)=>name===issuerName?[index]:[])
   if(matches.length!==1||verifiedIssuers.has(matches[0]))return held()
   const issuerIndex=matches[0]
   const signature=await execute('openssl',['crl','-in',path,'-noout','-verify','-CAfile',issuerPaths[issuerIndex]],{timeout:10000,maxBuffer:65536})
   // Some OpenSSL versions exit zero after printing a failed CRL signature
   // verification. This command must explicitly confirm cryptographic success.
   if(signature.stdout.trim()!==''||signature.stderr.trim()!=='verify OK')return held()
   const text=await run(['crl','-in',path,'-noout','-text'])
   if(/Delta CRL Indicator|Issuing Distribution Point|X509v3[^\n]*critical/.test(text))return held()
   const last=text.match(/Last Update:\s*([^\n]+)/)?.[1]
   const next=text.match(/Next Update:\s*([^\n]+)/)?.[1]
   if(!last||!next||!Number.isFinite(Date.parse(last))||!Number.isFinite(Date.parse(next))
    ||Date.parse(last)>n.getTime()||Date.parse(next)<=Date.parse(last))return held()
   const revoked=[...text.matchAll(/^\s*Serial Number:\s*([0-9A-Fa-f:]+)\s*$/gm)].map(m=>serial(m[1]))
   if(!revoked.length&&!text.includes('No Revoked Certificates.'))return held()
   if(revoked.includes(serial(chain[issuerIndex].serialNumber)))return held()
   verifiedIssuers.add(issuerIndex)
  }
  if(verifiedIssuers.size!==chain.length-1)return held()
  return {verified:true,registrationId:a.registrationId,registerVersion:a.registerVersion,leafFingerprint:fp(leaf),
   chainFingerprints:chain.map(fp),crlSha256:a.crls.map(sha),verifiedAt:n.toISOString()}
 }catch{return held()}
 finally{if(directory)await rm(directory,{recursive:true,force:true})}
}
