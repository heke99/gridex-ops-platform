// Actual browser clicks/forms/reload, never Playwright request/API substitutes.
// Run against the frozen locally qualified candidate and its own test tenant.
// Runtime authority/source provenance is supplied by the integration owner.
import {chromium} from '@playwright/test'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import path from 'node:path'

const env=process.env,base=env.GRIDEX_EDIEL_OPS_BASE_URL,storageState=env.GRIDEX_EDIEL_OPS_STORAGE_STATE
const messageId=env.GRIDEX_EDIEL_RECOVERY_MESSAGE_ID,ackId=env.GRIDEX_EDIEL_RECOVERY_ACK_ID,wireFile=env.GRIDEX_EDIEL_RECOVERY_CORRECTED_WIRE_FILE
const codeSha=env.GRIDEX_QUALIFIED_CODE_SHA,outDir=env.GRIDEX_EDIEL_OPS_EVIDENCE_DIR
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v)
if(!base||!storageState||!uuid(messageId)||!codeSha||!outDir)throw Error('Need frozen codeSha, baseURL, own test-tenant storage state/message UUID and explicit evidence directory')
if((!!ackId)!=(!!wireFile)||ackId&&!uuid(ackId))throw Error('Correction requires actual own negative ACK UUID and genuinely qualified corrected wire file together')
const allowedQueue=env.GRIDEX_EDIEL_RECOVERY_QUEUE_TEST_DRAFT==='1'
if(allowedQueue&&!ackId)throw Error('Queue proof requires prepared test correction flow')
mkdirSync(outDir,{recursive:true})
const browser=await chromium.launch({headless:true}),context=await browser.newContext({storageState}),page=await context.newPage()
const results={codeSha,browser:'Playwright Chromium actual UI',messageId,checks:[],authorityProvenance:env.GRIDEX_EDIEL_RECOVERY_SOURCE_PROVENANCE??'NOT_SUPPLIED',prepare:ackId?'REQUESTED':'NOT_RUN',queue:allowedQueue?'REQUESTED':'NOT_RUN'}
try{
 await page.goto(`${base.replace(/\/$/,'')}/admin/ediel/prodat-recovery?messageId=${messageId}`,{waitUntil:'networkidle'})
 await page.getByRole('heading',{name:'PRODAT-rättelse',exact:true}).waitFor()
 const section=page.getByRole('heading',{name:'1. Läs original eller sparad rättelse'}).locator('..')
 await section.getByLabel('Beständigt meddelande',{exact:true}).selectOption(messageId)
 await section.getByRole('button',{name:'Återläs status och originalinnehåll',exact:true}).click()
 await page.getByRole('status').filter({hasText:'Meddelandets beständiga status är återläst.'}).waitFor()
 if(!(await section.textContent()).includes(messageId))throw Error('Actual native selected message readback missing')
 results.checks.push('real selected own-message read form and returned durable state')
 await section.getByRole('link',{name:'Öppna samma beständiga meddelande efter omladdning'}).click()
 await page.reload({waitUntil:'networkidle'})
 if(!(await page.getByRole('heading',{name:'1. Läs original eller sparad rättelse'}).locator('..').textContent()).includes(messageId))throw Error('Durable source readback missing after actual reload')
 results.checks.push('actual durable reload link and reload native state')
 await page.screenshot({path:path.join(outDir,'recovery-read-reload.png'),fullPage:true})
 if(ackId){
  const prepare=page.getByRole('heading',{name:'2. Förbered eget rättelseutkast'}).locator('..')
  await prepare.getByLabel('Original',{exact:true}).selectOption(messageId)
  if(!(await prepare.textContent()).includes('Miljön hämtas från valt original: Test.'))throw Error('Mutating browser proof is restricted to the actual selected TEST original')
  await prepare.getByLabel('Faktiskt mottaget ACK',{exact:true}).selectOption(ackId)
  const wire=readFileSync(wireFile,'utf8');results.inputPayloadHash=createHash('sha256').update(wire,'utf8').digest('hex')
  await prepare.getByLabel('Rättat EDIFACT-innehåll',{exact:true}).fill(wire)
  await prepare.getByRole('button',{name:'Pröva källa och spara utkast',exact:true}).click()
  await page.getByRole('status').filter({hasText:'Rättelsen är sparad som eget utkast.'}).waitFor()
  const persisted=page.getByRole('heading',{name:'1. Läs original eller sparad rättelse'}).locator('..')
  const readback=await persisted.textContent(),created=/Meddelande:\s*([a-f0-9-]{36})/.exec(readback??'')?.[1]
  if(!uuid(created)||created===messageId||!readback?.includes('Status: draft'))throw Error('Actual prepared separate persistent draft required')
  results.newMessageId=created;results.prepare='PASS';results.checks.push('real preparation form -> protected producer -> native source/command -> durable own draft')
  await persisted.getByRole('link',{name:'Öppna samma beständiga meddelande efter omladdning'}).click();await page.reload({waitUntil:'networkidle'})
  if(!(await page.getByRole('heading',{name:'1. Läs original eller sparad rättelse'}).locator('..').textContent()).includes(created))throw Error('Prepared native draft missing after reload')
  results.checks.push('new prepared correction durable readback after actual reload')
  await page.screenshot({path:path.join(outDir,'recovery-prepared-reload.png'),fullPage:true})
  if(allowedQueue){
   await page.getByRole('button',{name:'Pröva och köa vald rättelse',exact:true}).click()
   await page.getByRole('status').filter({hasText:'Den beständiga leveransavsikten är köad.'}).waitFor()
   await page.reload({waitUntil:'networkidle'})
   if(!(await page.getByRole('heading',{name:'1. Läs original eller sparad rättelse'}).locator('..').textContent()).includes('Status: queued'))throw Error('Actual durable queued status missing after reload')
   results.queue='PASS';results.checks.push('real separate SEND form -> same protected native binding/current executor -> durable queue/readback')
   await page.screenshot({path:path.join(outDir,'recovery-queued-reload.png'),fullPage:true})
  }
 }
 results.status='PASS'
}catch(error){results.status='FAIL';results.error=error.message;process.exitCode=1;await page.screenshot({path:path.join(outDir,'recovery-failure.png'),fullPage:true}).catch(()=>{})}
finally{writeFileSync(path.join(outDir,'recovery-browser-result.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));await browser.close()}
