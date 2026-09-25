import {execFileSync} from 'node:child_process'
import {X509Certificate} from 'node:crypto'
import {expect,it} from 'vitest'
import {encryptSmimeEnvelopedData,inspectCmsRecipientInfo,parseOpenSslCmsSerial} from '@/lib/ediel/transport/index.part-1'

it.each([
 {serial:'1234',hex:'04D2',printed:'1234'},
 {serial:'0xFEDCBA98765432100123456789ABCDEF',hex:'FEDCBA98765432100123456789ABCDEF',printed:'0xFEDCBA98765432100123456789ABCDEF'},
])('actual CMS recipient inspection matches certificate serial $serial and rejects another recipient',async({serial,hex,printed})=>{
 const pem=execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout','/dev/null','-days','365','-set_serial',serial,'-subj','/CN=60021'],{encoding:'utf8',stdio:['ignore','pipe','ignore']})
 const certificate=new X509Certificate(pem)
 expect(certificate.serialNumber).toBe(hex)
 const encryptedDer=await encryptSmimeEnvelopedData({innerMime:Buffer.from('Content-Type: application/EDIFACT\r\n\r\nsynthetic CMS payload'),recipientCertificatePem:pem})
 const inspected=await inspectCmsRecipientInfo({encryptedDer,expectedSerialNumber:certificate.serialNumber})
 expect(inspected.raw).toContain(`serialNumber: ${printed}`)
 expect(inspected.expectedReceiverPresent).toBe(true)
 const wrongRecipient=await inspectCmsRecipientInfo({encryptedDer,expectedSerialNumber:'DEADBEEF'})
 expect(wrongRecipient.expectedReceiverPresent).toBe(false)
})

it.each(['','-1','0x','0xD2junk','12 trailing','1.2','D2'])('printed CMS serial rejects unrecognized complete value %j',value=>{
 expect(parseOpenSslCmsSerial(value)).toBeNull()
})
it('printed decimal CMS serial retains integer precision beyond Number range',()=>{
 expect(parseOpenSslCmsSerial('9007199254740993')).toBe('20000000000001')
})
