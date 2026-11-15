import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const results=[];
try {
 for(const width of [390,1280]) {
  for(const fixture of ['profile-reader-company','profile-writer-company','contacts-reader-company','contacts-writer-company','contacts-long-company']) {
   const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();
   await page.goto(`http://127.0.0.1:4187/?fixture=${fixture}`);await page.locator('main').waitFor();await page.waitForFunction(()=>document.styleSheets.length>0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${fixture} ${width}: page overflow`);
   assert.equal(await page.getByText(/RAW_|Z01|Primary|Registered/).count(),0);
   if(fixture.includes('reader')) assert.equal(await page.locator('form').count(),0);
   if(fixture==='profile-writer-company') {
    const save=page.getByRole('button',{name:'Spara kundprofil',exact:true});assert.equal(await save.isVisible(),false);
    await page.locator('#edit-customer-profile > summary').click();assert.equal(await save.isVisible(),true);
    assert.equal(await page.locator('[name=customer_id]').inputValue(),'customer');
    assert.equal(await page.locator('[name=expected_updated_at]').inputValue(),'2026-11-15T10:00:00Z');
   }
   if(fixture==='contacts-reader-company') {
    assert.equal(await page.getByText('Testvägen old',{exact:true}).isVisible(),false);
    await page.locator('#former-customer-addresses > summary').click();assert.equal(await page.getByText('Testvägen old',{exact:true}).isVisible(),true);
   }
   if(fixture==='contacts-writer-company') {
    const summary=page.getByText('Redigera kontakt',{exact:true});const form=summary.locator('..').locator('form');
    await summary.click();assert.equal(await form.locator('[name=customer_id]').inputValue(),'customer');
    assert.equal(await form.locator('[name=id]').inputValue(),'one');assert.equal(await form.locator('[name=type]').inputValue(),'billing');
    await form.getByRole('textbox',{name:'Namn',exact:true}).fill('Syntetisk kontakt utan inskick');
    await summary.click();
    const addressSummary=page.getByText('Redigera adress',{exact:true}).first();await addressSummary.click();const addressForm=addressSummary.locator('..').locator('form');
    assert.equal(await addressForm.locator('[name=type]').inputValue(),'registered');
    assert.equal(await addressForm.locator('[name=moved_in_at]').inputValue(),'2026-11-01');
   }
   if(fixture==='contacts-long-company') {
    for(const name of ['Kundens kontakter','Aktuella kontakt- och fakturaadresser']) {
     const region=page.getByRole('region',{name,exact:true});assert.equal(await region.evaluate(e=>e.scrollHeight>e.clientHeight),true);await region.focus();await page.keyboard.press('End');await page.waitForTimeout(150);assert.equal(await region.evaluate(e=>e.scrollTop>0),true);
    }
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${fixture} ${width}: overflow after expansion`);
   const violations=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}));
   if(width===390)await page.screenshot({path:`quality/customer-ui-20261115/${fixture}-390.png`,fullPage:true});
   results.push({fixture,width,overflow:false,violations});await context.close();
  }
  const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();
  await page.goto('http://127.0.0.1:4187/admin/customers/customer?tab=profile&fixture=profile-hash-company#edit-customer-profile');
  await page.locator('#edit-customer-profile[open]').waitFor();
  const link=page.getByRole('link',{name:'Ändra uppgifter',exact:true});const target=new URL(await link.getAttribute('href'),'http://127.0.0.1:4187');assert.equal(target.hash,'#edit-customer-profile');
  // Keep the fixture mounted to model Next navigation that emits no hashchange.
  await page.evaluate(()=>{window.__profileFixtureToken='same-mount';document.addEventListener('click',event=>{if(event.target.closest('a'))event.preventDefault()})});
  for(let i=0;i<2;i++) {
   await page.locator('#edit-customer-profile > summary').click();assert.equal(await page.locator('#edit-customer-profile').evaluate(e=>e.open),false);
   await link.click();assert.equal(await page.locator('#edit-customer-profile').evaluate(e=>e.open),true);
   assert.equal(await page.evaluate(()=>window.__profileFixtureToken),'same-mount');
  }
  const violations=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}));
  await page.locator('#edit-customer-profile > summary').click();
  await page.evaluate(()=>history.replaceState(history.state,'','/admin/customers/other?tab=profile&fixture=profile-hash-company#edit-customer-profile'));
  await link.click();assert.equal(await page.locator('#edit-customer-profile').evaluate(e=>e.open),false);
  results.push({fixture:'profile-hash-company',width,directHash:true,repeatedOpen:true,wrongCustomerNotOpened:true,violations});await context.close();
 }
 const contractContext=await browser.newContext({viewport:{width:1280,height:900}});const contractPage=await contractContext.newPage();
 await contractPage.goto('http://127.0.0.1:4187/admin/customers/synthetic-customer?tab=contracts');
 await contractPage.getByRole('link',{name:'Nytt avtal',exact:true}).waitFor();
 for(let i=0;i<2;i++) {
  await contractPage.getByRole('link',{name:'Nytt avtal',exact:true}).click();await contractPage.waitForURL(/#new-contract$/);
  await contractPage.getByRole('button',{name:'Skicka avtal för signering',exact:true}).waitFor();
  await contractPage.getByText('Skapa avtal',{exact:true}).click();assert.equal(await contractPage.locator('#new-contract').evaluate(e=>e.open),false);
 }
 results.push({fixture:'existing-contract-link',width:1280,repeatedOpen:true,violations:[]});await contractContext.close();
 fs.writeFileSync('quality/customer-ui-20261115/pass8-browser-results.json',JSON.stringify(results,null,2)+'\n');
 const violations=results.flatMap(r=>r.violations);assert.equal(violations.length,0,'WCAG violations');
 console.log(JSON.stringify({states:results.length,wcagViolations:0,passed:true}));
}finally{await browser.close()}
