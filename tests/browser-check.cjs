const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const out=path.resolve(__dirname,'../test-results');await fs.mkdir(out,{recursive:true});
 const launch={headless:true};if(process.env.BROWSER_EXECUTABLE)launch.executablePath=process.env.BROWSER_EXECUTABLE;
 const browser=await chromium.launch(launch);
 try{
  const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[],network=[];
  page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>window.__experiment);
  const baseline=await page.evaluate(()=>({g:window.__experiment.traceGenerations,first:window.__experiment.trace.load[0],metrics:window.__experiment.result.metrics}));
  assert.equal(baseline.g,1);assert.equal(baseline.metrics.feasible,true);
  await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
  await page.locator('#gtgMW').fill('2');await page.waitForFunction(()=>window.__experiment.params.gtgMW===2);
  const lower=await page.evaluate(()=>({g:window.__experiment.traceGenerations,first:window.__experiment.trace.load[0],m:window.__experiment.result.metrics,slider:document.getElementById('gtgRange').value}));
  assert.equal(lower.g,baseline.g);assert.equal(lower.first,baseline.first);assert.equal(lower.slider,'2');assert.equal(lower.m.feasible,false);assert.ok(lower.m.physicalViolationSamples>0);assert.match(await page.locator('#status').textContent(),/Infeasible/);
  await page.locator('#gtgRange').fill('6');await page.waitForFunction(()=>window.__experiment.params.gtgMW===6);assert.equal(await page.locator('#gtgMW').inputValue(),'6');
  await page.locator('#capacityMWh').fill('150');await page.waitForFunction(()=>window.__experiment.params.capacityMWh===150);assert.equal(await page.evaluate(()=>window.__experiment.traceGenerations),1);
  await page.locator('#seed').fill('42');await page.waitForFunction(()=>window.__experiment.params.seed===42);assert.equal(await page.evaluate(()=>window.__experiment.traceGenerations),2);assert.notEqual(await page.evaluate(()=>window.__experiment.trace.load[0]),baseline.first);
  await page.locator('#training').fill('99');await page.waitForFunction(()=>!document.getElementById('inputError').hidden);assert.match(await page.locator('#inputError').textContent(),/sum to 100/);assert.equal(await page.locator('#runSweep').isDisabled(),true);
  await page.locator('#training').fill('60');await page.waitForFunction(()=>document.getElementById('inputError').hidden);
  await page.locator('#gtgMW').fill('8.2');await page.waitForFunction(()=>window.__experiment.params.gtgMW===8.2);
  await page.locator('#runSweep').click();await page.waitForFunction(()=>window.__experiment.sweepRows?.length===101);
  const sweep=await page.evaluate(()=>window.__experiment.sweepRows);assert.equal(sweep[0].gtgMW,1);assert.equal(sweep[100].gtgMW,12);
  const downloadPromise=page.waitForEvent('download');await page.locator('#exportTrace').click();const download=await downloadPromise;await download.saveAs(path.join(out,'trace.csv'));
  const csv=await fs.readFile(path.join(out,'trace.csv'),'utf8');assert.match(csv,/time_s,it_mw,auxiliary_mw/);assert.equal(csv.trim().split('\n').length,17281);
  const [row]=csv.split('\n').slice(1);const values=row.split(',').map(Number);assert.ok(Math.abs(values[4]+Math.max(values[5],0)-values[3]-Math.max(-values[5],0))<1e-9);
  const sweepDownloadPromise=page.waitForEvent('download');await page.locator('#exportSweep').click();await(await sweepDownloadPromise).saveAs(path.join(out,'sweep.csv'));assert.equal((await fs.readFile(path.join(out,'sweep.csv'),'utf8')).trim().split('\n').length,102);
  const settingsPromise=page.waitForEvent('download');await page.locator('#exportSettings').click();await(await settingsPromise).saveAs(path.join(out,'settings.json'));const settings=JSON.parse(await fs.readFile(path.join(out,'settings.json'),'utf8'));assert.equal(settings.parameters.seed,42);assert.equal(settings.metrics.transitions,await page.evaluate(()=>window.__experiment.result.metrics.transitions));
  // Changing only the selected GTG keeps both the trace and valid sweep cache.
  await page.locator('#gtgMW').fill('5');await page.waitForFunction(()=>window.__experiment.params.gtgMW===5);assert.equal(await page.evaluate(()=>window.__experiment.sweepRows.length),101);
  await page.setViewportSize({width:375,height:900});await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  // Demand change invalidates the sweep until explicitly rerun.
  await page.locator('#averageMW').fill('7');await page.waitForFunction(()=>window.__experiment.params.averageMW===7);assert.equal(await page.locator('#sweepCharts').isHidden(),true);assert.equal(await page.locator('#exportSweep').isDisabled(),true);
  assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
  const report={baseline:baseline.metrics,checks:{setpointAndSlider:true,demandReusedForGtgAndStorage:true,demandRegeneratedForSeed:true,invalidInputHandled:true,sweep101:true,csvTraceAndSweep:true,settingsExport:true,mobileFits:true,noBrowserErrors:true,noExternalNetwork:true}};
  await fs.writeFile(path.join(out,'browser-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
