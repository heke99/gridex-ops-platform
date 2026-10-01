import {readFileSync} from 'node:fs'
import {test,expect} from '@playwright/test'
const enabled=process.env.GRIDEX_EDIEL_CASE_LOCAL_E2E==='1'&&process.env.NEXT_PUBLIC_SUPABASE_URL==='http://127.0.0.1:54321'&&!process.env.GRIDEX_E2E_BROWSER_BASE_URL&&Boolean(process.env.GRIDEX_REGULATED_FIXTURE_PATH&&process.env.GRIDEX_EDIEL_CASE_TEST_PASSWORD)
test.skip(!enabled,'Requires genuine local contract/source owners and explicitly synthetic issuer verifier configuration.')
const f=enabled?JSON.parse(readFileSync(process.env.GRIDEX_REGULATED_FIXTURE_PATH,'utf8')):null
async function login(page,email){await page.goto('/login');await page.getByLabel('E-post').fill(email);await page.getByLabel('Lösenord').fill(process.env.GRIDEX_EDIEL_CASE_TEST_PASSWORD);await page.getByRole('button',{name:'Logga in'}).click();await page.waitForURL(url=>!url.pathname.startsWith('/login'))}
test('actual upload, private original download, separate keyboard review and reload create one ground and no market activation',async({browser},info)=>{
 const writer=await browser.newPage();await login(writer,f.actorEmail);await writer.goto('/admin/ediel/regulated-supply');await expect(writer.getByRole('heading',{name:'Rättsgrund för särskild leverans',exact:true})).toBeVisible()
 await writer.getByLabel('Avtal och anläggning',{exact:true}).selectOption(f.contractId);await writer.getByLabel('Dokumenterad överenskommelse',{exact:true}).selectOption(f.agreementId);await writer.getByLabel('Gäller från',{exact:true}).fill('2026-10-14T23:00')
 await writer.getByLabel('Originalunderlag',{exact:true}).setInputFiles({name:'synthetic-legal-original.pdf',mimeType:'application/pdf',buffer:Buffer.from(f.sourceText)})
 await writer.getByLabel('Underlagets beteckning enligt överenskommelsen',{exact:true}).fill(f.submission.source.reference);await writer.getByLabel('Version',{exact:true}).fill('1')
 await writer.getByLabel('Utfärdarens signerade intyg',{exact:true}).setInputFiles({name:'synthetic-issuer-receipt.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(f.submission.issuerReceipt))})
 const archiveResponse=writer.waitForResponse(r=>r.url().endsWith('/api/ediel/regulated-supply-sources')&&r.request().method()==='POST');await writer.getByRole('button',{name:'Arkivera original',exact:true}).click();const archived=await(await archiveResponse).json();expect(archived.status).toBe('archived');expect(archived.sourceHash).toBe(f.sourceHash)
 const self=await writer.request.post(`/api/ediel/regulated-supply-sources/${archived.artifactId}/review`,{data:{sourceHash:archived.sourceHash,scopeHash:archived.scopeHash,decision:'approve',reason:'Forbidden self review'}});expect(self.status()).toBe(403)
 const reviewer=await browser.newPage();await login(reviewer,f.reviewerEmail);await reviewer.goto(`/admin/ediel/regulated-supply?artifactId=${archived.artifactId}`);await expect(reviewer.getByText(f.sourceHash,{exact:true})).toBeVisible()
 const download=await reviewer.request.get(`/api/ediel/regulated-supply-sources/${archived.artifactId}/source`);expect(download.headers()['cache-control']).toBe('private, no-store');expect(await download.text()).toBe(f.sourceText)
 await reviewer.getByLabel('Beslut',{exact:true}).selectOption('approve');await reviewer.getByLabel('Motivering',{exact:true}).fill('Separate exact original and synthetic issuer verifier review')
 const button=reviewer.getByRole('button',{name:'Registrera granskning',exact:true});await button.focus();await expect(button).toBeFocused();const reviewed=reviewer.waitForResponse(r=>r.url().endsWith(`/${archived.artifactId}/review`)&&r.request().method()==='POST');await reviewer.keyboard.press('Enter');expect((await reviewed).status()).toBe(200)
 await expect(reviewer.getByText('Källkvalificerad rättsgrund',{exact:true})).toBeVisible();await writer.reload();await expect(writer.getByText('Källkvalificerad rättsgrund',{exact:true})).toBeVisible()
 await reviewer.setViewportSize({width:375,height:812});await reviewer.addStyleTag({content:'html{zoom:2}'});expect(await reviewer.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+2)).toBe(true)
 await info.attach('regulated-original-separate-review-reload',{body:await reviewer.screenshot({fullPage:true}),contentType:'image/png'});await writer.close();await reviewer.close()
})
