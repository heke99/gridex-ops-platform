import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const results=[];
try {
 for(const width of [390,1280]) {
  for(const fixture of ['application-company','application-platform','grid-owner-company','grid-owner-platform','supplier-switch-company','info-requests-company','info-requests-long-company','login-status-company','billing-settings-company','billing-settings-writer-company','metering-business-company']) {
   const context=await browser.newContext({viewport:{width,height:900}});
   const page=await context.newPage();
   await page.goto(`http://127.0.0.1:4187/?fixture=${fixture}`);
   await page.locator('main, h1').first().waitFor();
   await page.waitForFunction(()=>document.styleSheets.length>0);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
   assert.equal(overflow,false,`${fixture} ${width}: page overflow`);
   if(fixture==='application-company') {
    assert.equal(await page.getByText('RAW-APPLICATION-RESPONSE').count(),0);
    const more=page.getByText('Fler åtgärder',{exact:true});await more.click();
    assert.equal(await page.getByRole('button',{name:'Begär uppgifter från nätägare',exact:true}).isVisible(),true);
    await more.click();assert.equal(await page.getByRole('button',{name:'Begär uppgifter från nätägare',exact:true}).isVisible(),false);
   }
   if(fixture==='application-platform') {
    const technical=page.getByText('Tekniska detaljer · superadmin',{exact:true});
    assert.equal(await page.getByText('Payload',{exact:true}).isVisible(),false);
    await technical.click();assert.equal(await page.getByText('Payload',{exact:true}).isVisible(),true);
   }
   if(fixture==='grid-owner-company') {
    assert.equal(await page.getByRole('link',{name:'Öppna dokument'}).isVisible(),true);
    assert.equal(await page.getByRole('button',{name:'Spara status'}).isVisible(),false);
    await page.getByText('Uppdatera status',{exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Spara status'}).isVisible(),true);
    await page.getByText('Uppdatera status',{exact:true}).click();
   }
   if(fixture==='info-requests-company') {
    assert.equal(await page.locator('[name=source_message_id]').count(),0);
    const summary=page.locator('#create-info-request > summary');
    await summary.click();assert.equal(await page.getByRole('button',{name:'Skapa uppgiftsbegäran',exact:true}).isVisible(),true);
    await summary.click();assert.equal(await page.getByRole('button',{name:'Skapa uppgiftsbegäran',exact:true}).isVisible(),false);
   }
   if(fixture==='info-requests-long-company') {
    const region=page.getByRole('region',{name:'Uppgiftsbegäranden',exact:true});
    await region.focus();
    assert.equal(await region.evaluate(e=>e.scrollHeight>e.clientHeight),true);
    await page.keyboard.press('End');
    await page.waitForTimeout(150);
    assert.equal(await region.evaluate(e=>e.scrollTop>0),true);
   }
   if(fixture==='billing-settings-writer-company') {
    const summary=page.locator('#billing-select-provider > summary');await summary.click();
    assert.equal(await page.getByRole('button',{name:'Spara leverantör',exact:true}).isVisible(),true);
    await page.getByRole('combobox',{name:'Leverantör',exact:true}).selectOption('nordfin');
    assert.equal(await page.locator('[name=provider]').inputValue(),'nordfin');
    await summary.click();
   }
   if(fixture==='metering-business-company') {
    assert.equal(await page.getByText(/Sommarstugan/).last().isVisible(),true);
    assert.equal(await page.getByText(/Rättat mätvärde/).isVisible(),true);
   }
   if(fixture==='supplier-switch-company') {
    assert.equal(await page.getByText('Bekräftad leveransstart',{exact:true}).isVisible(),true);
    assert.equal(await page.getByText('Väntar på nätägarens bekräftelse',{exact:true}).isVisible(),true);
   }
   if(width===390&&fixture.endsWith('company'))await page.screenshot({path:`quality/customer-ui-20261115/${fixture}-390.png`,fullPage:true});
   let violations=[];
   if(fixture.endsWith('company'))violations=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}));
   results.push({fixture,width,overflow,violations});await context.close();
  }
 }
 const page=await browser.newPage();await page.goto('http://127.0.0.1:4187/admin/customers/synthetic-customer?tab=contracts');
 await page.getByRole('link',{name:'Nytt avtal'}).waitFor();
 for(let i=0;i<2;i++) {
  await page.getByRole('link',{name:'Nytt avtal'}).click();
  await page.waitForFunction(()=>document.getElementById('new-contract')?.open===true);
  assert.equal(await page.getByRole('button',{name:'Skicka avtal för signering'}).isVisible(),true);
  await page.getByText('Skapa avtal',{exact:true}).click();
  assert.equal(await page.locator('#new-contract').evaluate(e=>e.open),false);
 }
 results.push({scenario:'new-contract repeat click with existing hash',passed:true});await page.close();
 fs.writeFileSync('quality/customer-ui-20261115/browser-results.json',JSON.stringify(results,null,2)+'\n');
 const violations=results.flatMap(r=>r.violations??[]);assert.equal(violations.length,0,'WCAG violations');
 console.log(JSON.stringify({states:results.length,wcagViolations:violations.length,passed:true}));
}finally{await browser.close()}
