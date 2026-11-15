import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const results=[];
try {
 for(const width of [390,1280]) {
  for(const fixture of ['customer-sites-company','customer-sites-long-company','duplicates-reader-company','duplicates-writer-company','duplicates-long-company']) {
   const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();
   await page.goto(`http://127.0.0.1:4187/?fixture=${fixture}`);await page.locator('main').waitFor();await page.waitForFunction(()=>document.styleSheets.length>0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${fixture} ${width}: page overflow`);
   assert.equal(await page.getByText(/RAW_|Merge-arbetsyta|Dubblett- och mergekontroll/).count(),0);
   if(fixture==='customer-sites-company') {
    assert.equal(await page.getByText('Anläggning two',{exact:true}).isVisible(),true);
    assert.equal(await page.getByText('735888meter2',{exact:true}).isVisible(),true);
    assert.equal(await page.getByText('2026-12-01',{exact:true}).count(),2);
    assert.equal(await page.locator('form').count(),0);
   }
   if(fixture==='duplicates-reader-company') assert.equal(await page.locator('form').count(),0);
   if(fixture==='duplicates-writer-company') {
    const button=page.getByRole('button',{name:'Slå ihop markerade kunder',exact:true});assert.equal(await button.isVisible(),false);
    await page.getByText('Slå ihop kunder',{exact:true}).click();assert.equal(await button.isVisible(),true);
    const primary=page.getByRole('radio',{name:'Behåll Syntetisk kund one som huvudkund',exact:true});assert.equal(await primary.isChecked(),true);
    assert.equal(await page.getByRole('checkbox',{name:'Slå ihop Syntetisk kund two med huvudkunden',exact:true}).isChecked(),true);
    await page.getByRole('radio',{name:'Behåll Syntetisk kund two som huvudkund',exact:true}).check();
    await page.getByRole('textbox',{name:'Orsak till sammanslagningen',exact:true}).fill('Syntetisk kontroll utan inskick');
    assert.equal(await page.locator('[name=primaryCustomerId]:checked').inputValue(),'two');
   }
   if(fixture==='customer-sites-long-company'||fixture==='duplicates-long-company') {
    const region=page.getByRole('region',{name:fixture==='customer-sites-long-company'?'Kundens anläggningar':'Möjliga kunddubbletter',exact:true});
    assert.equal(await region.evaluate(e=>e.scrollHeight>e.clientHeight),true);await region.focus();await page.keyboard.press('End');await page.waitForTimeout(150);assert.equal(await region.evaluate(e=>e.scrollTop>0),true);
   }
   if(fixture==='duplicates-long-company') {
    assert.equal(await page.getByRole('region',{name:'Kunder i grupp 1: Samma e-post',exact:true}).count(),1);
    assert.equal(await page.getByRole('region',{name:'Kunder i grupp 8: Samma e-post',exact:true}).count(),1);
   }
   const violations=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}));
   if(width===390)await page.screenshot({path:`quality/customer-ui-20261115/${fixture}-390.png`,fullPage:true});
   results.push({fixture,width,overflow:false,violations});await context.close();
  }
 }
 fs.writeFileSync('quality/customer-ui-20261115/pass7-browser-results.json',JSON.stringify(results,null,2)+'\n');
 const violations=results.flatMap(r=>r.violations);assert.equal(violations.length,0,'WCAG violations');
 console.log(JSON.stringify({states:results.length,wcagViolations:0,passed:true}));
}finally{await browser.close()}
