import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {test,expect} from '@playwright/test'
const enabled=process.env.GRIDEX_EDIEL_CASE_LOCAL_E2E==='1'&&process.env.NEXT_PUBLIC_SUPABASE_URL==='http://127.0.0.1:54321'&&!process.env.GRIDEX_E2E_BROWSER_BASE_URL&&Boolean(process.env.GRIDEX_RCS_FIXTURE_PATH&&process.env.GRIDEX_EDIEL_CASE_TEST_PASSWORD)
test.skip(!enabled,'Requires actual writer-created supply, issuer fixture and local replay.')
const f=enabled?JSON.parse(readFileSync(process.env.GRIDEX_RCS_FIXTURE_PATH,'utf8')):null
async function login(page,email){await page.goto('/login');await page.getByLabel('E-post').fill(email);await page.getByLabel('Lösenord').fill(process.env.GRIDEX_EDIEL_CASE_TEST_PASSWORD);await page.getByRole('button',{name:'Logga in'}).click();await page.waitForURL(u=>!u.pathname.startsWith('/login'))}
const detail=id=>`/admin/ediel/requested-changes?artifactId=${id}`
test('actual browser upload, independent review and keyboard queue persist once without a real send',async({browser},info)=>{
 const writer=await browser.newPage();await login(writer,f.submitterEmail);await writer.goto('/admin/ediel/requested-changes');await expect(writer.getByRole('heading',{name:'Ändringsunderlag',exact:true})).toBeVisible()
 await writer.getByLabel('Kund, anläggning och leveransperiod').selectOption(f.periodId)
 await writer.getByLabel('Gäller från',{exact:true}).fill('2026-10-01T12:00')
 await writer.getByLabel('Originalunderlag',{exact:true}).setInputFiles({name:'synthetic-source.txt',mimeType:'text/plain',buffer:Buffer.from(f.sourceText)})
 await writer.getByLabel('Underlagets beteckning').fill(f.browser.source.reference);await writer.getByLabel('Version',{exact:true}).fill('1')
 await writer.getByLabel('Intyg från utfärdaren, om tillgängligt').setInputFiles({name:'synthetic-receipt.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(f.browser.issuerReceipt))})
 await writer.getByLabel('Kundidentitet',{exact:true}).fill(f.browser.customerIdentity.id);await writer.getByLabel('Typ av kundidentitet',{exact:true}).selectOption('SE1')
 for(const[label,value]of [['Kundnamn',f.browser.customerIdentity.name],['Kundens adress','SYNTHETIC ROAD 1'],['Ort','TEST'],['Postnummer','12345'],['Landkod','SE'],['Fakturamottagarens identitet',f.browser.customerIdentity.id],['Mottagarens namn',f.browser.customerIdentity.name],['Mottagarens adress','SYNTHETIC ROAD 1'],['Mottagarens ort','TEST'],['Mottagarens postnummer','12345'],['Mottagarens landkod','SE']])await writer.getByLabel(label,{exact:true}).fill(value)
 await writer.getByLabel('Typ av mottagaridentitet').selectOption('SE1')
 const archivedResponse=writer.waitForResponse(r=>r.url().endsWith('/api/ediel/requested-change-sources')&&r.request().method()==='POST')
 await writer.getByRole('button',{name:'Arkivera underlag',exact:true}).click();const response=await archivedResponse;expect(response.status()).toBe(201);expect(response.headers()['cache-control']).toBe('private, no-store');const archived=await response.json();expect(archived.sourceHash).toBe(f.browserSourceHash)
 await expect(writer.getByText(f.browserSourceHash,{exact:true})).toBeVisible();await expect(writer.getByRole('button',{name:'Köa ändringsbegäran',exact:true})).toHaveCount(0)
 await writer.getByLabel('Beslut',{exact:true}).selectOption('approve');await writer.getByLabel('Motivering',{exact:true}).fill('Synthetic forbidden self review')
 const selfResponse=writer.waitForResponse(r=>r.url().endsWith(`/${archived.artifactId}/review`)&&r.request().method()==='POST');await writer.getByRole('button',{name:'Registrera granskning'}).click();expect((await selfResponse).status()).toBe(403)
 const reviewer=await browser.newPage();await login(reviewer,f.reviewerEmail);await reviewer.goto(detail(archived.artifactId));await expect(reviewer.getByText(f.browserSourceHash,{exact:true})).toBeVisible()
 const source=await reviewer.request.get(`/api/ediel/requested-change-sources/${archived.artifactId}/source`);expect(source.status()).toBe(200);expect(source.headers()['cache-control']).toBe('private, no-store');expect(await source.text()).toBe(f.sourceText)
 await reviewer.getByLabel('Beslut',{exact:true}).selectOption('approve');await reviewer.getByLabel('Motivering',{exact:true}).fill('Synthetic separate review of exact original source and issuer')
 const reviewResponse=reviewer.waitForResponse(r=>r.url().endsWith(`/${archived.artifactId}/review`)&&r.request().method()==='POST');await reviewer.getByRole('button',{name:'Registrera granskning'}).click();expect((await reviewResponse).status()).toBe(200);await expect(reviewer.getByText('Godkänt',{exact:true})).toBeVisible()
 await writer.reload();const queue=writer.getByRole('button',{name:'Köa ändringsbegäran',exact:true});await expect(queue).toBeVisible();await queue.focus();await expect(queue).toBeFocused()
 const queueResponse=writer.waitForResponse(r=>r.url().endsWith('/api/ediel/requested-changes')&&r.request().method()==='POST');await writer.keyboard.press('Enter');expect((await queueResponse).status()).toBe(202);await expect(writer.getByRole('status')).toContainText('Ändringsbegäran är köad')
 await writer.reload();await expect(writer.getByText('Godkänt',{exact:true})).toBeVisible();await expect(writer.getByText(f.browserSourceHash,{exact:true})).toBeVisible()
 const replayResponse=writer.waitForResponse(r=>r.url().endsWith('/api/ediel/requested-changes')&&r.request().method()==='POST');await writer.getByRole('button',{name:'Köa ändringsbegäran',exact:true}).click();expect((await replayResponse).status()).toBe(200);await expect(writer.getByRole('status')).toContainText('Ändringsbegäran finns redan')
 await info.attach('source-review-queue-reloaded',{body:await writer.screenshot({fullPage:true}),contentType:'image/png'});await writer.close();await reviewer.close()
})
test('real read-only mobile and foreign browser scopes retain private sources and forbid writes',async({browser},info)=>{
 const reader=await browser.newPage({viewport:{width:375,height:812}});await login(reader,f.readerEmail);await reader.goto(detail(f.nativeArtifactId));await expect(reader.getByText('Godkänt',{exact:true})).toBeVisible()
 for(const name of ['Arkivera underlag','Registrera granskning','Köa ändringsbegäran'])await expect(reader.getByRole('button',{name,exact:true})).toHaveCount(0)
 await reader.addStyleTag({content:'html{zoom:2}'});expect(await reader.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+2)).toBe(true)
 await info.attach('source-readonly-mobile-200-percent-layout',{body:await reader.screenshot({fullPage:true}),contentType:'image/png'})
 const forbiddenWrite=await reader.request.post(`/api/ediel/requested-change-sources/${f.nativeArtifactId}/review`,{data:{decision:'approve'}});expect(forbiddenWrite.status()).toBe(403)
 const outsider=await browser.newPage();await login(outsider,f.outsiderEmail);await outsider.goto(detail(f.nativeArtifactId));await expect(outsider.getByText(f.browserSourceHash,{exact:true})).toHaveCount(0);await expect(outsider.getByRole('button',{name:'Köa ändringsbegäran',exact:true})).toHaveCount(0)
 const privateSource=await outsider.request.get(`/api/ediel/requested-change-sources/${f.nativeArtifactId}/source`);expect(privateSource.status()).toBe(403);expect(privateSource.headers()['cache-control']).toBe('private, no-store');expect(await privateSource.text()).not.toContain(f.sourceText)
 await reader.close();await outsider.close()
})
test('actual native outbound PRODAT original is read through the recovery form and survives permalink reload',async({browser},info)=>{
 // The shared fixture sends Z03 through its real producer and queues Z09 through
 // the reviewed source command. supplySource is its inbound Z04, not an outbound
 // original ID. Discover the actual own Z03 through the native READ-only UI.
 // No negative ACK, correction source, client authority or API call is invented.
 const reader=await browser.newPage({viewport:{width:375,height:812}}),pageErrors=[]
 reader.on('pageerror',error=>pageErrors.push(error.message))
 try{
  await login(reader,f.readerEmail);await reader.goto('/admin/ediel/prodat-recovery')
  await expect(reader.getByRole('heading',{name:'PRODAT-rättelse',exact:true})).toBeVisible()
  const choices=reader.getByLabel('Beständigt meddelande',{exact:true}),originalOption=choices.getByRole('option').filter({hasText:/^Z03 · test · /})
  await expect(originalOption).toHaveCount(1)
  const originalId=await originalOption.getAttribute('value');expect(originalId).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i)
  expect(originalId).not.toBe(f.supplySource);await expect(choices.locator(`option[value="${f.supplySource}"]`)).toHaveCount(0)
  await choices.selectOption(originalId)
  const read=reader.getByRole('button',{name:'Återläs status och originalinnehåll',exact:true})
  await read.focus();await expect(read).toBeFocused();await reader.keyboard.press('Enter')
  await expect(reader.getByRole('status')).toHaveText('Meddelandets beständiga status är återläst.')
  await expect(reader.getByText('Miljö: Test · Status: sent',{exact:true})).toBeVisible()
  await expect(reader.getByText(`Meddelande: ${originalId}`,{exact:false})).toBeVisible()
  // This source has no incoming ACK receipt. Mutable message caches cannot
  // turn it green; the same private ACK status reader must label it unproven.
  const ack=reader.getByText('ACK-underlag: Ej styrkt · CONTRL: Ej styrkt · APERAK: Ej styrkt',{exact:true})
  await expect(ack).toBeVisible()
  const contents=reader.getByLabel('Återläst innehåll',{exact:true}),raw=await contents.inputValue()
  expect(raw).toContain('BGM+Z03+');expect(raw).toContain(f.external)
  const payloadHash=createHash('sha256').update(raw,'utf8').digest('hex')
  await expect(reader.getByText(`Payloadhash: ${payloadHash}`,{exact:false})).toBeVisible()
  for(const name of ['Pröva källa och spara utkast','Pröva och köa vald rättelse','Pröva bevis och köa återförsök'])await expect(reader.getByRole('button',{name,exact:true})).toBeDisabled()
  await reader.getByRole('link',{name:'Öppna samma beständiga meddelande efter omladdning',exact:true}).click()
  await expect(reader).toHaveURL(new RegExp(`/admin/ediel/prodat-recovery\\?messageId=${originalId}$`))
  await reader.reload()
  await expect(choices).toHaveValue(originalId);await expect(contents).toHaveValue(raw)
  await expect(reader.getByText(`Meddelande: ${originalId}`,{exact:false})).toBeVisible();await expect(reader.getByText(`Payloadhash: ${payloadHash}`,{exact:false})).toBeVisible()
  await expect(reader.getByText('Miljö: Test · Status: sent',{exact:true})).toBeVisible();await expect(ack).toBeVisible()
  for(const name of ['Pröva källa och spara utkast','Pröva och köa vald rättelse','Pröva bevis och köa återförsök'])await expect(reader.getByRole('button',{name,exact:true})).toBeDisabled()
  expect(pageErrors).toEqual([])
  await info.attach('prodat-recovery-native-read-reloaded',{body:await reader.screenshot({fullPage:true}),contentType:'image/png'})
  await info.attach('prodat-recovery-read-provenance',{body:Buffer.from(JSON.stringify({companyId:f.companyId,originalId,payloadHash,codeSha:process.env.GITHUB_SHA??null,fixture:'ediel-requested-change-browser-native',boundary:'Actual local producer, native READ, browser form and reload; synthetic issuer, legal facts and SMTP; no external integration evidence.'})),contentType:'application/json'})
 }finally{await reader.close()}
})
