import {execFileSync} from 'node:child_process'
import {createHash, X509Certificate} from 'node:crypto'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {literal, sql} from './correctionContextNative'

/** SYNTHETIC test PKI only: a throwaway CA, one recipient leaf for the Ediel
 * receiver and a fresh empty CRL, published through the dedicated external
 * certificate-authority owner role (the only publisher the authority accepts).
 * No real CA, CRL, legal register or Ediel certificate is involved. */
export function publishSyntheticRecipientTrust(input:{companyId:string;actorUserId:string;environment:'test'|'production';receiverEdielId:string;recipientEmail:string}){
 const dir=mkdtempSync(join(tmpdir(),'synthetic-ediel-pki-'))
 const openssl=(args:string[])=>execFileSync('openssl',args,{cwd:dir,stdio:['ignore','pipe','pipe']})
 try{
  writeFileSync(join(dir,'index.txt'),'');writeFileSync(join(dir,'crlnumber'),'01\n')
  writeFileSync(join(dir,'ca.cnf'),[
   '[ca]','default_ca=synthetic','[synthetic]',`dir=${dir}`,'database=$dir/index.txt','crlnumber=$dir/crlnumber',
   'certificate=$dir/ca.pem','private_key=$dir/ca.key','default_md=sha256','default_crl_days=7',
   '[ca_ext]','basicConstraints=critical,CA:true','keyUsage=critical,keyCertSign,cRLSign','subjectKeyIdentifier=hash',
   '[leaf_ext]','basicConstraints=critical,CA:false','keyUsage=critical,keyEncipherment,digitalSignature','extendedKeyUsage=emailProtection',
   `subjectAltName=email:${input.recipientEmail}`,'subjectKeyIdentifier=hash','authorityKeyIdentifier=keyid,issuer',''].join('\n'))
  openssl(['req','-x509','-newkey','rsa:2048','-nodes','-keyout','ca.key','-out','ca.pem','-days','30','-subj','/CN=SYNTHETIC Ediel test CA','-config','ca.cnf','-extensions','ca_ext'])
  openssl(['req','-newkey','rsa:2048','-nodes','-keyout','leaf.key','-out','leaf.csr','-subj',`/CN=${input.receiverEdielId}`])
  openssl(['x509','-req','-in','leaf.csr','-CA','ca.pem','-CAkey','ca.key','-set_serial','4660','-days','30','-out','leaf.pem','-extfile','ca.cnf','-extensions','leaf_ext'])
  openssl(['ca','-gencrl','-config','ca.cnf','-out','crl.pem'])
  const anchor=readFileSync(join(dir,'ca.pem'),'utf8'),leafPem=readFileSync(join(dir,'leaf.pem'),'utf8'),crl=readFileSync(join(dir,'crl.pem'),'utf8')
  const leaf=new X509Certificate(leafPem),fingerprint=leaf.fingerprint256.replaceAll(':','').toLowerCase()
  const register=Buffer.from(`SYNTHETIC owner register for ${input.receiverEdielId}; NOT A REAL CERTIFICATE AUTHORITY`)
  const scope={companyId:input.companyId,environment:input.environment,receiverEdielId:input.receiverEdielId,registerVersion:`synthetic-${createHash('sha256').update(leafPem).digest('hex').slice(0,12)}`,
   originalReference:'SYNTHETIC owner register',legalAuthorityReference:'SYNTHETIC legal authority',processAuthorityReference:'SYNTHETIC process authority',
   ownerRegisterReference:'SYNTHETIC owner register reference',validFrom:new Date(Date.now()-60_000).toISOString(),validTo:new Date(Date.now()+86_400_000).toISOString(),actorUserId:input.actorUserId}
  const materials={anchors:[anchor],intermediates:[],crls:[crl],recipientFingerprints:[fingerprint]}
  // CI's postgres is not a superuser: membership exists only inside this
  // transaction and is revoked before commit, so the NOLOGIN owner role keeps
  // no lasting members.
  const registrationId=sql<string>(`BEGIN; GRANT gridex_ediel_certificate_authority_owner TO CURRENT_USER;
   SET LOCAL ROLE gridex_ediel_certificate_authority_owner;
   CREATE TEMP TABLE synthetic_trust_publication ON COMMIT DROP AS SELECT public.gridex_ediel_certificate_trust_publish_v1(${literal(scope)}::jsonb,decode(${literal(register.toString('hex'))},'hex'),${literal(materials)}::jsonb) AS id;
   RESET ROLE; REVOKE gridex_ediel_certificate_authority_owner FROM CURRENT_USER;
   SELECT to_jsonb(id) FROM synthetic_trust_publication; COMMIT;`)
  return {registrationId,leafPem,leaf,fingerprint}
 }finally{rmSync(dir,{recursive:true,force:true})}
}
