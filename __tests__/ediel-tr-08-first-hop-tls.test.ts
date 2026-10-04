// masterplan: TR-08, AT-TR-08
// Actual sender/config/Nodemailer/Node TLS and an owned loopback SMTP peer.
// Archive/entry ports, SMTP credentials and certificate authority are finite
// fixtures. This proves only the first hop, never provider relay policy,
// subsequent hops, recipient SPF or authentic market transport acceptance.
import {createHash,randomUUID} from 'node:crypto'
import net from 'node:net'
import tls from 'node:tls'
import forge from 'node-forge'
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest'

const archive=vi.hoisted(()=>({write:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{}}))
vi.mock('@/lib/ediel/transport/rawMimeArchive',async importOriginal=>({
  ...await importOriginal<typeof import('@/lib/ediel/transport/rawMimeArchive')>(),
  archiveTransportRawMime:archive.write,
}))
import {sendEdielEmail,type SendEdielEmailInput} from '@/lib/email/sendEdielEmail'
import {exactRfcMessageId} from '@/lib/ediel/transport/rawMimeArchive'
import {edielSmtpConfig} from '@/lib/ediel/mailReadiness'

type PeerMode='starttls'|'implicit'|'absent'|'reject'|'plaintext-upgrade'
type PeerOptions={mode:PeerMode;certificate?:'trusted'|'untrusted'|'wrong-host';version?:'TLSv1.1'|'TLSv1.2'}
type Material={key:string;cert:string}
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
const sender='synthetic-first-hop@example.invalid',recipient='synthetic-recipient@example.invalid'
const ownedPeers=new Set<Awaited<ReturnType<typeof createPeer>>>()
// Installed Node typings predate these Node22 APIs; runtime availability is
// asserted below. No dependency or production trust configuration is changed.
const certificateStore=tls as typeof tls&{getCACertificates(type:'default'):string[];setDefaultCACertificates(certificates:string[]):void}
let originalCas:string[],materials:Record<'trusted'|'untrusted'|'wrong-host',Material>,trustedCa:string
let archived:{raw:Buffer;context:{companyId:string;messageId:string}}[]=[]

function createCertificates(){
  const caKeys=forge.pki.rsa.generateKeyPair(2048),untrustedKeys=forge.pki.rsa.generateKeyPair(2048),leafKeys=forge.pki.rsa.generateKeyPair(2048)
  // Dates are only disposable certificate fixture inputs, not Ediel TTL rules.
  const from=new Date(Date.now()-60_000),to=new Date(Date.now()+86400_000)
  const authority=(name:string,keys:forge.pki.rsa.KeyPair)=>{
    const cert=forge.pki.createCertificate();cert.publicKey=keys.publicKey
    cert.serialNumber=name==='trusted'?'01':'02';cert.validity.notBefore=from;cert.validity.notAfter=to
    cert.setSubject([{name:'commonName',value:`Synthetic ${name} loopback CA`}]);cert.setIssuer(cert.subject.attributes)
    cert.setExtensions([{name:'basicConstraints',cA:true,critical:true},{name:'keyUsage',keyCertSign:true,cRLSign:true,critical:true}])
    cert.sign(keys.privateKey,forge.md.sha256.create());return cert
  }
  const trusted=authority('trusted',caKeys),untrusted=authority('untrusted',untrustedKeys)
  trustedCa=forge.pki.certificateToPem(trusted)
  const leaf=(issuer:forge.pki.Certificate,signingKey:forge.pki.rsa.PrivateKey,ip:string,serial:string):Material=>{
    const cert=forge.pki.createCertificate();cert.publicKey=leafKeys.publicKey
    cert.serialNumber=serial;cert.validity.notBefore=from;cert.validity.notAfter=to
    cert.setSubject([{name:'commonName',value:'Synthetic local SMTP peer'}]);cert.setIssuer(issuer.subject.attributes)
    cert.setExtensions([{name:'basicConstraints',cA:false,critical:true},
      {name:'keyUsage',digitalSignature:true,keyEncipherment:true,critical:true},
      {name:'extKeyUsage',serverAuth:true},{name:'subjectAltName',altNames:[{type:7,ip}]}])
    cert.sign(signingKey,forge.md.sha256.create())
    return {key:forge.pki.privateKeyToPem(leafKeys.privateKey),cert:forge.pki.certificateToPem(cert)}
  }
  materials={trusted:leaf(trusted,caKeys.privateKey,'127.0.0.1','10'),untrusted:leaf(untrusted,untrustedKeys.privateKey,'127.0.0.1','11'),'wrong-host':leaf(trusted,caKeys.privateKey,'127.0.0.2','12')}
}

async function createPeer(options:PeerOptions){
  const sockets=new Set<net.Socket>(),commands:{verb:string;secure:boolean}[]=[],messages:Buffer[]=[],protocols:(string|null)[]=[],errors:string[]=[]
  let connections=0,deadlineExpired=false
  const material=materials[options.certificate??'trusted']
  const security:tls.TlsOptions={...material,minVersion:options.version??'TLSv1.2',maxVersion:options.version??'TLSv1.2',ciphers:'DEFAULT@SECLEVEL=0'}
  const track=(socket:net.Socket)=>{
    sockets.add(socket);socket.once('close',()=>sockets.delete(socket))
    socket.on('error',error=>errors.push(error.message))
    socket.setTimeout(5000,()=>{deadlineExpired=true;socket.destroy(Error('synthetic_peer_deadline'))})
  }
  function attach(socket:net.Socket,secure:boolean,greeting:boolean){
    track(socket)
    let pending=Buffer.alloc(0),data=false,expectClientHello=false,retained=0
    if(greeting)socket.write('220 synthetic-loopback ESMTP\r\n')
    const onData=(chunk:Buffer)=>{
      retained+=chunk.length
      if(retained>32768){socket.destroy(Error('synthetic_peer_transcript_limit'));return}
      if(expectClientHello){socket.destroy();return}
      pending=Buffer.concat([pending,chunk])
      while(pending.length){
        if(data){
          const end=pending.indexOf('\r\n.\r\n')
          if(end<0)return
          // Remove SMTP dot transparency only; preserve every archived byte.
          messages.push(Buffer.from(pending.subarray(0,end+2).toString('latin1').replace(/(^|\r\n)\.\./g,'$1.'),'latin1'))
          pending=pending.subarray(end+5);data=false
          socket.write('250 2.0.0 queued as SYNTHETIC_FIRST_HOP\r\n');continue
        }
        const end=pending.indexOf('\r\n');if(end<0)return
        const line=pending.subarray(0,end).toString('ascii');pending=pending.subarray(end+2)
        const verb=line.split(' ',1)[0].toUpperCase();commands.push({verb,secure})
        if(verb==='EHLO'||verb==='HELO'){
          socket.write(!secure&&options.mode!=='absent'
            ?'250-synthetic-loopback\r\n250-STARTTLS\r\n250 AUTH PLAIN\r\n'
            :'250-synthetic-loopback\r\n250 AUTH PLAIN\r\n')
        }else if(verb==='STARTTLS'){
          if(options.mode==='absent'){socket.write('502 5.5.1 STARTTLS unavailable\r\n');continue}
          if(options.mode==='reject'){socket.write('454 4.7.0 TLS unavailable\r\n');continue}
          socket.write('220 2.0.0 begin TLS\r\n')
          if(options.mode==='plaintext-upgrade'){expectClientHello=true;continue}
          socket.off('data',onData)
          const upgraded=new tls.TLSSocket(socket,{isServer:true,secureContext:tls.createSecureContext(security)})
          track(upgraded)
          upgraded.once('secure',()=>{protocols.push(upgraded.getProtocol());attach(upgraded,true,false)})
          return
        }else if(verb==='AUTH')socket.write('235 2.7.0 synthetic authentication accepted\r\n')
        else if(verb==='MAIL'||verb==='RCPT')socket.write('250 2.1.0 synthetic recipient accepted\r\n')
        else if(verb==='DATA'){data=true;socket.write('354 end with CRLF dot CRLF\r\n')}
        else if(verb==='QUIT'){socket.end('221 2.0.0 goodbye\r\n')}
        else if(verb==='RSET'||verb==='NOOP')socket.write('250 2.0.0 OK\r\n')
        else socket.write('500 5.5.1 unsupported synthetic command\r\n')
      }
    }
    socket.on('data',onData)
  }
  const server=options.mode==='implicit'
    ?tls.createServer(security,socket=>{protocols.push(socket.getProtocol());attach(socket,true,true)})
    :net.createServer(socket=>attach(socket,false,true))
  server.on('connection',socket=>{connections++;track(socket)})
  server.on('tlsClientError',error=>errors.push(error.message))
  await new Promise<void>((resolve,reject)=>{
    server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve()})
  })
  const address=server.address();if(!address||typeof address==='string')throw Error('synthetic_peer_port_missing')
  const peer={port:address.port,commands,messages,protocols,errors,
    get connections(){return connections},get deadlineExpired(){return deadlineExpired},
    async close(){for(const socket of sockets)socket.destroy();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));ownedPeers.delete(peer)},
  }
  ownedPeers.add(peer);return peer
}

function configure(peer:Awaited<ReturnType<typeof createPeer>>,secure:boolean){
  for(const [key,value] of Object.entries({EMAIL_PROVIDER:'resend',EDIEL_EMAIL_PROVIDER:'strato',EDIEL_SMTP_HOST:'127.0.0.1',
    EDIEL_SMTP_PORT:String(peer.port),EDIEL_SMTP_SECURE:String(secure),EDIEL_SMTP_FROM:sender,EDIEL_SMTP_USER:sender,
    EDIEL_SMTP_PASS:'synthetic-first-hop-only',EDIEL_SHARED_MAILBOX_ADDRESS:sender,EDIEL_APP_DKIM_ENABLED:'false'}))vi.stubEnv(key,value)
  expect(edielSmtpConfig()).toMatchObject({host:'127.0.0.1',port:peer.port,secure,provider:'strato'})
}
function input(mode:'raw'|'attachment'):SendEdielEmailInput{
  const raw=Buffer.from(`From: ${sender}\r\nTo: ${recipient}\r\nMessage-ID: <${randomUUID()}@example.invalid>\r\nSubject: Synthetic Ediel first hop\r\nContent-Type: application/edifact\r\nContent-Transfer-Encoding: 8bit\r\n\r\nUNB+SYNTHETIC'\r\n.leading dot and latin1 ÅÄÖ\r\n`,'latin1')
  return mode==='raw'?{raw,to:recipient,envelopeFrom:sender}:{to:recipient,subject:'Synthetic Ediel first hop',text:'Synthetic fixture only',attachments:[{filename:'synthetic.edi',content:raw.subarray(raw.indexOf('\r\n\r\n')+4),contentType:'application/edifact'}]}
}
function finiteEntry(peer:Awaited<ReturnType<typeof createPeer>>){
  return {archiveContext:{companyId:randomUUID(),messageId:randomUUID()},beforeProviderCall:vi.fn(async(binding:Record<string,unknown>)=>{
    expect(archived).toHaveLength(1);expect(peer.connections).toBe(0)
    expect(binding).toMatchObject({from:sender,to:recipient,mimeSha256:sha(archived[0].raw),mimeLength:archived[0].raw.length,rfcMessageId:exactRfcMessageId(archived[0].raw)})
    expect(Buffer.from(String(binding.rawBase64),'base64')).toEqual(archived[0].raw)
  })}
}

beforeAll(()=>{
  expect(typeof certificateStore.getCACertificates).toBe('function');expect(typeof certificateStore.setDefaultCACertificates).toBe('function')
  originalCas=certificateStore.getCACertificates('default');createCertificates()
  // Extend the process trust store with one declared synthetic CA. The real
  // sender retains rejectUnauthorized=true and its hostname check unchanged.
  certificateStore.setDefaultCACertificates([...originalCas,trustedCa])
},20000)
beforeEach(()=>{
  archived=[]
  archive.write.mockImplementation(async(raw:Buffer,context:{companyId:string;messageId:string})=>{
    archived.push({raw:Buffer.from(raw),context:{...context}})
    return {mimeArchiveRef:`synthetic://first-hop-archive/${sha(raw)}`,mimeSha256:sha(raw),mimeLength:raw.length,rfcMessageId:exactRfcMessageId(raw),mimePayloadSnapshotId:randomUUID()}
  })
})
afterEach(async()=>{try{await Promise.all([...ownedPeers].map(peer=>peer.close()))}finally{archive.write.mockReset();vi.unstubAllEnvs()}})
afterAll(()=>{if(originalCas)certificateStore.setDefaultCACertificates(originalCas)})

describe.sequential('real Ediel sender TLS for its first owned local SMTP hop only',()=>{
  it.each([{input:'raw',mode:'starttls'},{input:'attachment',mode:'starttls'},{input:'raw',mode:'implicit'},{input:'attachment',mode:'implicit'}] as const)(
    'preserves archived $input bytes over trusted TLS1.2 using $mode',async({input:kind,mode})=>{
      const peer=await createPeer({mode}),mail=input(kind);configure(peer,mode==='implicit')
      const entry=finiteEntry(peer),result=await sendEdielEmail(mail,entry)
      // Nodemailer's info.messageId describes its local mail object for a raw
      // send. Only the captured wire bytes prove the archived RFC identity.
      expect(result).toMatchObject({accepted:[recipient],rejected:[],response:'250 2.0.0 queued as SYNTHETIC_FIRST_HOP',messageId:expect.any(String)})
      expect(entry.beforeProviderCall).toHaveBeenCalledTimes(1);expect(archive.write).toHaveBeenCalledTimes(1)
      expect(peer.connections).toBe(1);expect(peer.protocols).toEqual(['TLSv1.2'])
      expect(peer.messages).toEqual([archived[0].raw]);expect(sha(peer.messages[0])).toBe(sha(archived[0].raw))
      expect(exactRfcMessageId(peer.messages[0])).toBe(exactRfcMessageId(archived[0].raw))
      expect(peer.commands.filter(command=>['AUTH','MAIL','RCPT','DATA'].includes(command.verb)).every(command=>command.secure)).toBe(true)
      expect(peer.commands.filter(command=>command.verb==='DATA')).toHaveLength(1)
      expect(peer.commands.filter(command=>command.verb==='STARTTLS')).toHaveLength(mode==='starttls'?1:0)
      expect(peer.deadlineExpired).toBe(false)
      if('raw' in mail)expect(peer.messages[0]).toEqual(mail.raw)
      else expect(peer.messages[0].toString('ascii')).toContain('filename=synthetic.edi')
    },10000)
  const denied:PeerOptions[]=[{mode:'absent'},{mode:'reject'},{mode:'plaintext-upgrade'},
    {mode:'starttls',certificate:'untrusted'},{mode:'starttls',certificate:'wrong-host'},{mode:'starttls',version:'TLSv1.1'},
    {mode:'implicit',certificate:'untrusted'},{mode:'implicit',version:'TLSv1.1'}]
  it.each(denied.flatMap(options=>(['raw','attachment'] as const).map(kind=>({...options,input:kind}))))(
    'refuses $input DATA for $mode / $certificate / $version',async({input:kind,...options})=>{
      const peer=await createPeer(options);configure(peer,options.mode==='implicit')
      const entry=finiteEntry(peer)
      const failure=await sendEdielEmail(input(kind),entry).then(()=>null,error=>error as Error&{code?:string})
      expect(failure).toBeInstanceOf(Error)
      expect(failure?.code).toMatch(/^(ETLS|ESOCKET|ECONNECTION)$/)
      expect(peer.connections).toBe(1);expect(peer.deadlineExpired).toBe(false)
      expect(peer.messages).toEqual([])
      expect(peer.commands.filter(command=>['AUTH','MAIL','RCPT','DATA'].includes(command.verb))).toEqual([])
      expect(entry.beforeProviderCall).toHaveBeenCalledTimes(1);expect(archive.write).toHaveBeenCalledTimes(1)
      if(options.mode!=='implicit')expect(peer.commands.filter(command=>command.verb==='STARTTLS')).toHaveLength(1)
      if(options.version==='TLSv1.1')expect(peer.errors.some(error=>/unsupported protocol|protocol version/i.test(error))).toBe(true)
    },10000)
})
