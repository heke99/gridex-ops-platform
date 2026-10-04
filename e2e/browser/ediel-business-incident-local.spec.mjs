import {readFileSync,writeFileSync} from 'node:fs'
import {test,expect} from '@playwright/test'
const enabled=process.env.GRIDEX_EDIEL_CASE_LOCAL_E2E==='1'&&process.env.NEXT_PUBLIC_SUPABASE_URL==='http://127.0.0.1:54321'&&!process.env.GRIDEX_E2E_BROWSER_BASE_URL&&Boolean(process.env.GRIDEX_EDIEL_INCIDENT_FIXTURE_PATH&&process.env.GRIDEX_EDIEL_CASE_TEST_PASSWORD)
test.skip(!enabled,'Requires genuine accepted ACK/native incident fixture on the local disposable replay.')
const f=enabled?JSON.parse(readFileSync(process.env.GRIDEX_EDIEL_INCIDENT_FIXTURE_PATH,'utf8')):null
async function login(page,email){await page.goto('/login');await page.getByLabel('E-post').fill(email);await page.getByLabel('Lösenord').fill(process.env.GRIDEX_EDIEL_CASE_TEST_PASSWORD);await page.getByRole('button',{name:'Logga in'}).click();await page.waitForURL(u=>!u.pathname.startsWith('/login'))}
const detail=id=>`/admin/ediel/business-incidents?incidentId=${id}`
test('actual keyboard report persists once and reloads its separately held plans without changing ACK history',async({browser},info)=>{
 const writer=await browser.newPage();await login(writer,f.writerEmail);await writer.goto('/admin/ediel/business-incidents')
 for(const[label,value]of [['Originalets meddelande-ID',f.sourceMessageId],['Den accepterade kvittensens meddelande-ID',f.ackMessageId],['Originalets objekt- eller transaktionsreferens',f.scopeReference],['Den nya observationen','Synthetic interactive later business observation']])await writer.getByLabel(label,{exact:true}).fill(value)
 const button=writer.getByRole('button',{name:'Registrera incident',exact:true});await button.focus();await expect(button).toBeFocused()
 const response=writer.waitForResponse(r=>r.url().endsWith('/api/ediel/business-incidents')&&r.request().method()==='POST');await writer.keyboard.press('Enter');const first=await response;expect(first.status()).toBe(201);expect(first.headers()['cache-control']).toBe('private, no-store');const made=await first.json();expect(made).toMatchObject({findingValidated:false,ackHistoryChanged:false,trafficAuthorized:false,contactStatus:'held',correctionStatus:'held'})
 await expect(writer.getByText(made.incidentId,{exact:true})).toBeVisible();const retry=writer.waitForResponse(r=>r.url().endsWith('/api/ediel/business-incidents')&&r.request().method()==='POST');await button.click();expect(await(await retry).json()).toEqual(made)
 await writer.goto(detail(made.incidentId));await expect(writer.getByText(made.finding.summary,{exact:true})).toBeVisible();await expect(writer.getByText('Observationen är ännu inte verifierad. Kvittenshistoriken är bevarad.')).toBeVisible()
 writeFileSync(process.env.GRIDEX_EDIEL_INCIDENT_FIXTURE_PATH,JSON.stringify({...f,browserIncidentId:made.incidentId,browserCommandId:made.commandId,browserFinding:made.finding.summary}),{mode:0o600});await info.attach('fresh-business-incident-keyboard-reloaded',{body:await writer.screenshot({fullPage:true}),contentType:'image/png'});await writer.close()
})
test('actual read-only mobile and foreign browser scopes cannot report or disclose another company incident',async({browser},info)=>{
 const reader=await browser.newPage({viewport:{width:375,height:812}});await login(reader,f.readerEmail);await reader.goto(detail(f.nativeIncidentId));await expect(reader.getByText(f.nativeFinding,{exact:true})).toBeVisible();await expect(reader.getByRole('button',{name:'Registrera incident',exact:true})).toHaveCount(0)
 await reader.addStyleTag({content:'html{zoom:2}'});expect(await reader.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+2)).toBe(true);await info.attach('incident-readonly-mobile-200-percent',{body:await reader.screenshot({fullPage:true}),contentType:'image/png'})
 const denied=await reader.request.post('/api/ediel/business-incidents',{data:{sourceMessageId:f.sourceMessageId,ackMessageId:f.ackMessageId}});expect(denied.status()).toBe(403)
 const outsider=await browser.newPage();await login(outsider,f.outsiderEmail);await outsider.goto(detail(f.nativeIncidentId));await expect(outsider.getByText(f.nativeFinding,{exact:true})).toHaveCount(0)
 const foreign=await outsider.request.get('/api/ediel/business-incidents?incidentId='+f.nativeIncidentId);expect(foreign.status()).toBe(403);expect(foreign.headers()['cache-control']).toBe('private, no-store');expect(await foreign.text()).not.toContain(f.nativeFinding)
 await reader.close();await outsider.close()
})
