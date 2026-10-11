const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../engine.js');
const close=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
test('one hour charging matches analytical efficiency-adjusted stored energy',()=>{
  const r=M.evaluate(new Float64Array(60).fill(4),{gtgMW:6,dtSeconds:60,hours:1,capacityMWh:100,initialSoc:.5,etaCharge:.9});
  close(r.soc[60],.518);close(r.metrics.chargedMWh,2);close(r.metrics.dischargedMWh,0);
  close(r.metrics.movementMWh,2);close(r.metrics.chargingTimePct,100);assert.equal(r.metrics.transitions,0);
});
test('one hour discharging divides AC energy by discharge efficiency',()=>{
  const r=M.evaluate(new Float64Array(60).fill(6),{gtgMW:4,dtSeconds:60,hours:1,capacityMWh:100,initialSoc:.5,etaDischarge:.8});
  close(r.soc[60],.475);close(r.metrics.dischargedMWh,2);close(r.metrics.chargingTimePct,0);
});
test('unit conversion and one-way loss on a balanced charge/discharge profile',()=>{
  const load=new Float64Array([...new Array(30).fill(4),...new Array(30).fill(6)]);
  const r=M.evaluate(load,{gtgMW:5,dtSeconds:60,hours:1,capacityMWh:100,initialSoc:.5,etaCharge:.9,etaDischarge:.9});
  close(r.soc[60],.5+(.45-.5/.9)/100);assert.equal(r.metrics.transitions,1);close(r.metrics.movementMWh,1);close(r.metrics.balanceErrorMW,0);
});
test('idle samples do not manufacture charge/discharge transitions',()=>{
  const r=M.evaluate([4,5,4,5,6,5,6,4],{gtgMW:5});assert.equal(r.metrics.transitions,2);
  assert.equal(M.evaluate([5,5,5],{gtgMW:5}).metrics.transitions,0);
});
test('unclipped diagnostic trajectory reports power, normal SoC and physical violations',()=>{
  const r=M.evaluate(new Float64Array(60).fill(12),{gtgMW:1,dtSeconds:60,hours:1,capacityMWh:1,powerMW:2});
  assert.ok(r.soc[60]<0);assert.equal(r.metrics.powerViolationSteps,60);assert.ok(r.metrics.socViolationSamples>0);assert.ok(r.metrics.physicalViolationSamples>0);assert.equal(r.metrics.feasible,false);
});
test('average SoC uses interval-start values and reports deviation in percentage points',()=>{
  const r=M.evaluate([4,4],{gtgMW:6,dtSeconds:60,capacityMWh:100,initialSoc:.5,etaCharge:.9});
  close(r.metrics.averageSocPct,50.015);close(r.metrics.socDeviationPP,29.985);
});
test('seeded demand is deterministic, positive and calibrated to requested facility mean',()=>{
  const p={hours:1,dtSeconds:5},a=M.generateDemand(p),b=M.generateDemand(p),c=M.generateDemand({...p,seed:4});
  assert.deepEqual(a.load,b.load);assert.notDeepEqual(a.load,c.load);close(a.load.reduce((a,b)=>a+b,0)/a.load.length,8);
  for(let k=0;k<a.load.length;k++){assert.ok(a.load[k]>=0);close(a.load[k],a.it[k]+a.aux[k]);}
});
test('GTG and storage changes do not affect the demand key or generated demand',()=>{
  const a=M.generateDemand({hours:1}),b=M.generateDemand({hours:1,gtgMW:2,capacityMWh:20,initialSoc:.3});
  assert.equal(a.key,b.key);assert.deepEqual(a.load,b.load);
  const before=a.load.slice();M.evaluate(a.load,{hours:1,gtgMW:2});assert.deepEqual(before,a.load);
});
test('101-point sweep uses exact endpoints, leaves demand unchanged and matches individual evaluation',()=>{
  const p={hours:1},d=M.generateDemand(p),before=d.load.slice(),rows=M.sweep(d.load,p);
  assert.equal(rows.length,101);close(rows[0].gtgMW,1);close(rows[100].gtgMW,12);assert.deepEqual(d.load,before);
  for(const i of [0,30,75,100])assert.deepEqual(rows[i],{gtgMW:rows[i].gtgMW,...M.evaluate(d.load,{...p,gtgMW:rows[i].gtgMW}).metrics});
});
test('invalid inputs fail clearly rather than silently changing assumptions',()=>{
  for(const p of [{training:99},{capacityMWh:0},{etaDischarge:0},{seed:1.5},{hours:169},{dtSeconds:0},{gtgMW:13},{averageMW:NaN}])assert.throws(()=>M.generateDemand(p));
  assert.throws(()=>M.evaluate([],{}));assert.throws(()=>M.evaluate([-1],{}));
});
