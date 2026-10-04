import {readFileSync} from 'node:fs'
import {test,expect} from '@playwright/test'
const enabled=process.env.GRIDEX_EDIEL_CASE_LOCAL_E2E==='1'&&process.env.NEXT_PUBLIC_SUPABASE_URL==='http://127.0.0.1:54321'&&!process.env.GRIDEX_E2E_BROWSER_BASE_URL&&Boolean(process.env.GRIDEX_AI_PURPOSE_FIXTURE_PATH&&process.env.GRIDEX_EDIEL_CASE_TEST_PASSWORD)
test.skip(!enabled,'Requires actual native original/purpose writers and disposable local GoTrue/issuer boundary.')
const f=enabled?JSON.parse(readFileSync(process.env.GRIDEX_AI_PURPOSE_FIXTURE_PATH,'utf8')):null
async function login(page,email){await page.goto('/login');await page.getByLabel('E-post').fill(email);await page.getByLabel('Lösenord').fill(process.env.GRIDEX_EDIEL_CASE_TEST_PASSWORD);await page.getByRole('button',{name:'Logga in'}).click();await page.waitForURL(u=>!u.pathname.startsWith('/login'))}
const detail=id=>`/admin/ediel/ai-purpose-sources?artifactId=${id}`
test('actual browser original upload, independent legal-purpose review and private reload retain native source continuity',async({browser},info)=>{
 const writer=await browser.newPage();await login(writer,f.submitterEmail);await writer.goto('/admin/ediel/ai-purpose-sources');await expect(writer.getByRole('heading',{name:'AI/BI:s ändamålsunderlag',exact:true})).toBeVisible()
 await writer.getByLabel('Miljö',{exact:true}).selectOption('test');await writer.getByLabel('Ändamål',{exact:true}).selectOption('ediel_list_export');await writer.getByLabel('Listtyp',{exact:true}).selectOption('AI')
 for(const[label,value]of [['Juridisk grund enligt originalet',f.browser.gdprBasis],['Giltig från',f.browser.validFrom.slice(0,16)],['Giltig till',f.browser.validUntil.slice(0,16)],['Gallringsfrist i dagar',String(f.browser.retentionDays)],['Sista lagringsdag',f.browser.retentionUntil],['Originalets beteckning',f.browser.source.reference],['Version','1']])await writer.getByLabel(label,{exact:true}).fill(value)
 await writer.getByLabel('PDF-original',{exact:true}).setInputFiles({name:'synthetic-legal-original.pdf',mimeType:'application/pdf',buffer:Buffer.from(f.sourceText)})
 await writer.getByLabel('Utfärdarintyg, om tillgängligt').setInputFiles({name:'synthetic-legal-receipt.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(f.browser.issuerReceipt))})
 const initial=writer.waitForResponse(r=>r.url().endsWith('/api/ediel/ai-purpose-sources')&&r.request().method()==='POST');await writer.getByRole('button',{name:'Arkivera ändamålsunderlag',exact:true}).click();const response=await initial;expect(response.status()).toBe(201);const archived=await response.json();expect(archived.sourceHash).toBe(f.browserSourceHash);await expect(writer.getByText(f.browserSourceHash,{exact:true})).toBeVisible()
 await writer.getByLabel('Beslut',{exact:true}).selectOption('approve');await writer.getByLabel('Motivering',{exact:true}).fill('Synthetic self-review forbidden');await writer.getByLabel('Var finns den juridiska klausulen?').fill(f.clause.locator);await writer.getByLabel('Ordagrant utdrag om ändamål och gallring').fill(f.clause.quote)
 const self=writer.waitForResponse(r=>r.url().endsWith(`/${archived.artifactId}/review`)&&r.request().method()==='POST');await writer.getByRole('button',{name:'Registrera ändamålsgranskning'}).click();expect((await self).status()).toBe(403)
 const reviewer=await browser.newPage();await login(reviewer,f.reviewerEmail);await reviewer.goto(detail(archived.artifactId));await expect(reviewer.getByText(f.browserSourceHash,{exact:true})).toBeVisible()
 const source=await reviewer.request.get(`/api/ediel/ai-purpose-sources/${archived.artifactId}/source`);expect(source.status()).toBe(200);expect(source.headers()['cache-control']).toBe('private, no-store');expect(source.headers()['x-content-type-options']).toBe('nosniff');expect(source.headers()['content-disposition']).toContain('attachment');expect(await source.text()).toBe(f.sourceText)
 await reviewer.getByLabel('Beslut',{exact:true}).selectOption('approve');await reviewer.getByLabel('Motivering',{exact:true}).fill('Synthetic independent legal source review');await reviewer.getByLabel('Var finns den juridiska klausulen?').fill(f.clause.locator);await reviewer.getByLabel('Ordagrant utdrag om ändamål och gallring').fill(f.clause.quote)
 const decision=reviewer.waitForResponse(r=>r.url().endsWith(`/${archived.artifactId}/review`)&&r.request().method()==='POST');const submit=reviewer.getByRole('button',{name:'Registrera ändamålsgranskning'});await submit.focus();await reviewer.keyboard.press('Enter');expect((await decision).status()).toBe(200);await expect(reviewer.getByText('Styrkt ändamålsunderlag',{exact:true})).toBeVisible()
 await writer.reload();await expect(writer.getByText('Styrkt ändamålsunderlag',{exact:true})).toBeVisible();await expect(writer.getByText(f.browserSourceHash,{exact:true})).toBeVisible();await info.attach('actual-purpose-source-separate-review-reload',{body:await writer.screenshot({fullPage:true}),contentType:'image/png'})
 await writer.close();await reviewer.close()
})
test('current owncompany read-only mobile and foreign browser cannot write or download foreign original; independent producers do not fabricate AI history',async({browser},info)=>{
 expect(f.fixtureStage).toBe('legal_contract_before_received_z04');expect(f.nativeAiMessageId).toBeNull();expect(f.downstreamEvidence.status).toBe('not_executed')
 const reader=await browser.newPage({viewport:{width:375,height:812}});await login(reader,f.readerEmail);await reader.goto(detail(f.nativeArtifactId));await expect(reader.getByRole('heading',{name:'AI/BI:s ändamålsunderlag',exact:true})).toBeVisible()
 for(const name of ['Arkivera ändamålsunderlag','Registrera ändamålsgranskning'])await expect(reader.getByRole('button',{name,exact:true})).toHaveCount(0)
 expect((await reader.request.post(`/api/ediel/ai-purpose-sources/${f.nativeArtifactId}/review`,{data:{decision:'approve'}})).status()).toBe(403)
 await reader.addStyleTag({content:'html{zoom:2}'});expect(await reader.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+2)).toBe(true);await info.attach('purpose-readonly-mobile-200-percent',{body:await reader.screenshot({fullPage:true}),contentType:'image/png'})
 await reader.goto('/admin/ediel/ai-list');await expect(reader.getByRole('button',{name:/Generera|Skapa AI|Skicka/i})).toHaveCount(0)
 const outsider=await browser.newPage();await login(outsider,f.outsiderEmail);await outsider.goto(detail(f.nativeArtifactId));await expect(outsider.getByText(f.browserSourceHash,{exact:true})).toHaveCount(0)
 const original=await outsider.request.get(`/api/ediel/ai-purpose-sources/${f.nativeArtifactId}/source`);expect(original.status()).toBe(403);expect(await original.text()).not.toContain(f.sourceText)
 await info.attach('downstream-ai-history-not-executed',{body:Buffer.from(JSON.stringify(f.downstreamEvidence)),contentType:'application/json'})
 await reader.close();await outsider.close()
})
