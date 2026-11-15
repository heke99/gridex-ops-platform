import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const results=[];
try {
 for(const width of [390,1280]) {
  for(const fixture of ['message-detail-company','message-detail-platform','events-company','messages-company']) {
   const context=await browser.newContext({viewport:{width,height:900}});
   const page=await context.newPage();
   await page.goto(`http://127.0.0.1:4187/?fixture=${fixture}`);
   await page.locator('main').waitFor();
   await page.waitForFunction(()=>document.styleSheets.length>0);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
   assert.equal(overflow,false,`${fixture} ${width}: page overflow`);
   if(fixture==='message-detail-platform') {
    const payload=page.getByText('RAW-PAYLOAD',{exact:true});
    assert.equal(await payload.isVisible(),false);
    await page.locator('summary').click();assert.equal(await payload.isVisible(),true);
   } else {
    assert.equal(await page.getByText(/RAW-PAYLOAD|RAW-REF|RAW-SENDER/).count(),0);
    const customerLinks=page.getByRole('link',{name:fixture==='messages-company' ? 'Syntetisk kund' : /Öppna kundkort/});
    assert.equal(await customerLinks.first().getAttribute('href'),'/admin/customers/customer');
   }
   const violations=fixture.endsWith('company') ? (await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})) : [];
   if(width===390) await page.screenshot({path:`quality/customer-ui-20261115/${fixture}-390.png`,fullPage:true});
   results.push({fixture,width,overflow,violations});
   await context.close();
  }
 }
 fs.writeFileSync('quality/customer-ui-20261115/pass4-browser-results.json',JSON.stringify(results,null,2)+'\n');
 assert.equal(results.flatMap(r=>r.violations).length,0,'WCAG violations');
 console.log(JSON.stringify({states:results.length,wcagViolations:0,passed:true}));
} finally {await browser.close()}
