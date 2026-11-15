import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const results=[];
try {
 for(const width of [390,1280]) {
  for(const fixture of ['support-list-company','support-writer-company','support-detail-company','support-detail-writer-company','support-long-company','billing-summary-company']) {
   const context=await browser.newContext({viewport:{width,height:900}});
   const page=await context.newPage();
   await page.goto(`http://127.0.0.1:4187/?fixture=${fixture}`);
   await page.locator('main').waitFor();
   await page.waitForFunction(()=>document.styleSheets.length>0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${fixture} ${width}: page overflow`);
   assert.equal(await page.getByText(/tenant_support_|RAW_TECHNICAL_BLOCKER/).count(),0);
   if(fixture==='support-list-company') {
    const closed=page.getByRole('link',{name:'Ärende closed',exact:true});
    assert.equal(await closed.isVisible(),false);
    await page.locator('#closed-support-cases > summary').click();assert.equal(await closed.isVisible(),true);
    assert.equal(await page.locator('form').count(),0);
   }
   if(fixture==='support-writer-company') {
    assert.equal(await page.getByRole('button',{name:'Skapa supportärende',exact:true}).isVisible(),true);
    assert.equal(await page.locator('[name=channel]').inputValue(),'phone');
    assert.equal(await page.locator('[name=customer_id]').inputValue(),'customer');
   }
   if(fixture.startsWith('support-detail')) {
    assert.equal(await page.getByText('Historik 13',{exact:true}).isVisible(),true);
    assert.equal(await page.getByText('Historik 0',{exact:true}).isVisible(),false);
    await page.locator('#earlier-support-history > summary').click();assert.equal(await page.getByText('Historik 0',{exact:true}).isVisible(),true);
   }
   if(fixture==='support-long-company') {
    const region=page.getByRole('region',{name:'Öppna supportärenden',exact:true});
    assert.equal(await region.evaluate(e=>e.scrollHeight>e.clientHeight),true);
    await region.focus();await page.keyboard.press('End');await page.waitForTimeout(150);
    assert.equal(await region.evaluate(e=>e.scrollTop>0),true);
   }
   if(fixture==='billing-summary-company') assert.equal(await page.getByRole('link',{name:'Öppna fakturor',exact:true}).getAttribute('href'),'/admin/billing?customer=customer');
   const violations=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}));
   if(width===390) await page.screenshot({path:`quality/customer-ui-20261115/${fixture}-390.png`,fullPage:true});
   results.push({fixture,width,overflow:false,violations});await context.close();
  }
 }
 fs.writeFileSync('quality/customer-ui-20261115/pass5-browser-results.json',JSON.stringify(results,null,2)+'\n');
 const violations=results.flatMap(r=>r.violations);assert.equal(violations.length,0,'WCAG violations');
 console.log(JSON.stringify({states:results.length,wcagViolations:0,passed:true}));
} finally {await browser.close()}
