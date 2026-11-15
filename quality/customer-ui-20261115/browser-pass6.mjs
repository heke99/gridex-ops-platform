import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const results=[];
try {
 for(const width of [390,1280]) {
  for(const fixture of ['legal-readiness-company','legal-readiness-platform','legal-long-company','communication-company','communication-writer-company','communication-long-company']) {
   const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();
   await page.goto(`http://127.0.0.1:4187/?fixture=${fixture}`);await page.locator('main').waitFor();
   await page.waitForFunction(()=>document.styleSheets.length>0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${fixture} ${width}: page overflow`);
   if(fixture.endsWith('company')) assert.equal(await page.getByText(/RAW_EVENT|RAW_TEMPLATE|RAW_SOURCE|RAW_PROVIDER_ERROR|RAW_SCOPE|RAW_METHOD|RAW_SNAPSHOT/).count(),0);
   if(fixture==='legal-readiness-company') {
    if(width===1280) assert.equal(await page.locator('#saved-legal-acceptances').evaluate(e=>e.getBoundingClientRect().height<100),true);
    assert.equal(await page.getByRole('link',{name:'Visa kundöversikt',exact:true}).getAttribute('href'),'/admin/customers/customer');
    assert.equal(await page.locator('a[href*="tab=documents"],a[href*="tab=data-requests"]').count(),0);
   }
   if(fixture==='legal-readiness-platform') assert.equal(await page.getByRole('link',{name:'Ladda upp signerad PDF',exact:true}).getAttribute('href'),'/admin/customers/customer?tab=authorization-documents');
   if(fixture==='legal-long-company') {
    const region=page.getByRole('region',{name:'Kunddokument',exact:true});assert.equal(await region.evaluate(e=>e.scrollHeight>e.clientHeight),true);
    await region.focus();await page.keyboard.press('End');await page.waitForTimeout(150);assert.equal(await region.evaluate(e=>e.scrollTop>0),true);
    await page.locator('#customer-legal-history > summary').click();
    await page.getByText('Tidigare händelser (5)',{exact:true}).click();
   }
   if(fixture==='communication-company') assert.equal(await page.locator('form').count(),0);
   if(fixture==='communication-writer-company') {
    const resend=page.getByRole('button',{name:'Skicka igen',exact:true});assert.equal(await resend.isVisible(),false);
    await page.getByText('Fler åtgärder',{exact:true}).click();assert.equal(await resend.isVisible(),true);
    assert.equal(await page.locator('[name=customer_id]').inputValue(),'customer');
    assert.equal(await page.locator('[name=log_id]').inputValue(),'failed');
   }
   if(fixture==='communication-long-company') {
    assert.equal(await page.getByText('Meddelande 34',{exact:true}).isVisible(),false);
    await page.locator('#earlier-customer-messages > summary').click();
    const region=page.getByRole('region',{name:'Tidigare kundmeddelanden',exact:true});await region.focus();await page.keyboard.press('End');await page.waitForTimeout(150);
    assert.equal(await region.evaluate(e=>e.scrollTop>0),true);assert.equal(await page.getByText('Meddelande 34',{exact:true}).isVisible(),true);
   }
   const violations=fixture.endsWith('company') ? (await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})) : [];
   if(width===390)await page.screenshot({path:`quality/customer-ui-20261115/${fixture}-390.png`,fullPage:true});
   results.push({fixture,width,overflow:false,violations});await context.close();
  }
 }
 fs.writeFileSync('quality/customer-ui-20261115/pass6-browser-results.json',JSON.stringify(results,null,2)+'\n');
 const violations=results.flatMap(r=>r.violations);assert.equal(violations.length,0,'WCAG violations');
 console.log(JSON.stringify({states:results.length,wcagViolations:0,passed:true}));
}finally{await browser.close()}
