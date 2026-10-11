/* Shared browser/Node numerical model. Units: MW, MWh, seconds, SoC fraction. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GTGModel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const defaults = Object.freeze({gtgMW:8.2,training:60,fineTuning:30,inference:10,averageMW:8,
    fluctuation:1,capacityMWh:132,powerMW:12,etaCharge:.95,etaDischarge:.95,initialSoc:.8,
    hours:24,dtSeconds:5,seed:20261011});
  function checked(input) {
    const p={...defaults,...input};
    for(const [key,v] of Object.entries(p)) if(!Number.isFinite(v)) throw Error(`${key} must be finite`);
    for(const key of ['training','fineTuning','inference']) if(p[key]<0 || p[key]>100) throw Error('Workload proportions must be 0–100%');
    if(Math.abs(p.training+p.fineTuning+p.inference-100)>1e-6) throw Error('Workload proportions must sum to 100%');
    if(p.gtgMW<1||p.gtgMW>12) throw Error('GTG output must be 1–12 MW');
    if(p.averageMW<=0||p.averageMW>12||p.fluctuation<0||p.fluctuation>3) throw Error('Demand mean must be >0 to 12 MW; fluctuation intensity 0–3');
    if(p.capacityMWh<=0||p.powerMW<=0) throw Error('Storage energy and power ratings must be positive');
    if(p.etaCharge<=0||p.etaCharge>1||p.etaDischarge<=0||p.etaDischarge>1) throw Error('Efficiencies must be >0 and ≤100%');
    if(p.initialSoc<0||p.initialSoc>1) throw Error('Initial SoC must be 0–100%');
    if(p.hours<=0||p.hours>168||p.dtSeconds<1||p.dtSeconds>60) throw Error('Duration must be >0 to 168 hours; timestep 1–60 seconds');
    if(!Number.isInteger(p.seed)||p.seed<0||p.seed>4294967295) throw Error('Seed must be an integer from 0 to 4294967295');
    const n=p.hours*3600/p.dtSeconds;
    if(Math.abs(n-Math.round(n))>1e-7) throw Error('Duration must contain a whole number of timesteps');
    return p;
  }
  function demandKey(p){return JSON.stringify([p.training,p.fineTuning,p.inference,p.averageMW,p.fluctuation,p.hours,p.dtSeconds,p.seed]);}
  function rng(seed){let a=seed>>>0;return function(){a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
  function generateDemand(input){
    const p=checked(input), random=rng(p.seed), n=Math.round(p.hours*3600/p.dtSeconds);
    const it=new Float64Array(n),aux=new Float64Array(n),load=new Float64Array(n);
    // Independent semi-Markov node phases; shorter phases are selected more often.
    const duration=[600,180,30],shares=[p.training,p.fineTuning,p.inference].map(x=>x/100);
    const weights=shares.map((s,i)=>s/duration[i]);
    function select(w){let r=random()*w.reduce((a,b)=>a+b,0);for(let i=0;i<3;i++){r-=w[i];if(r<0)return i;}return 2;}
    const phase=new Int8Array(48),remaining=new Float64Array(48),noise=new Float64Array(48);
    for(let j=0;j<48;j++){phase[j]=select(shares);remaining[j]=Math.max(p.dtSeconds,random()*duration[phase[j]]);}
    const alpha=Math.exp(-p.dtSeconds/30);let sum=0;
    for(let k=0;k<n;k++){
      let total=0;
      for(let j=0;j<48;j++){
        if(remaining[j]<=0){phase[j]=select(weights);remaining[j]=duration[phase[j]];}
        remaining[j]-=p.dtSeconds;
        noise[j]=alpha*noise[j]+Math.sqrt(1-alpha*alpha)*(2*random()-1);
        const i=phase[j],base=[1,.75,.35][i],amp=[.04,.14,.30][i];
        const activity=Math.max(.05,Math.min(1.25,base+p.fluctuation*amp*noise[j]));
        total+=.04+.114*activity;
      }
      it[k]=total;aux[k]=.4+.25*total;load[k]=it[k]+aux[k];sum+=load[k];
    }
    // Calibrate the whole synthetic facility trace to the requested mean.
    const scale=p.averageMW/(sum/n);
    for(let k=0;k<n;k++){it[k]*=scale;aux[k]*=scale;load[k]*=scale;}
    return {load,it,aux,key:demandKey(p),parameters:p};
  }
  function evaluate(load,input,includeSeries=true){
    const p=checked(input),n=load.length;
    if(!n)throw Error('Demand trace cannot be empty');
    const dt=p.dtSeconds/3600,soc=includeSeries?new Float64Array(n+1):null;
    const storage=includeSeries?new Float64Array(n):null;
    let energy=p.initialSoc*p.capacityMWh,minSoc=p.initialSoc,maxSoc=p.initialSoc,sumSoc=0;
    let transitions=0,previousSign=0,chargeSteps=0,charged=0,discharged=0,powerViolations=0,socViolations=0,physicalViolations=0,peakPower=0,balanceError=0;
    if(soc)soc[0]=p.initialSoc;
    function violation(s){if(s<.2-1e-12||s>.9+1e-12)socViolations++;if(s<0-1e-12||s>1+1e-12)physicalViolations++;}
    violation(p.initialSoc);
    for(let k=0;k<n;k++){
      if(!Number.isFinite(load[k])||load[k]<0)throw Error('Demand must be finite and nonnegative');
      sumSoc+=energy/p.capacityMWh;
      const delta=load[k]-p.gtgMW; // Positive = required discharge to the AC bus.
      const ch=Math.max(-delta,0),dis=Math.max(delta,0),sign=Math.abs(delta)<1e-10?0:Math.sign(delta);
      // Idle samples are not extra cycles: count changes between nonzero modes.
      if(sign){if(previousSign&&sign!==previousSign)transitions++;previousSign=sign;}
      if(ch>1e-10)chargeSteps++;
      charged+=ch*dt;discharged+=dis*dt;
      energy+=(p.etaCharge*ch-dis/p.etaDischarge)*dt;
      const s=energy/p.capacityMWh;minSoc=Math.min(minSoc,s);maxSoc=Math.max(maxSoc,s);violation(s);
      const power=Math.abs(delta);peakPower=Math.max(peakPower,power);if(power>p.powerMW+1e-10)powerViolations++;
      balanceError=Math.max(balanceError,Math.abs(p.gtgMW+dis-load[k]-ch));
      if(soc){soc[k+1]=s;storage[k]=delta;}
    }
    const averageSoc=sumSoc/n;
    return {soc,storage,metrics:{transitions,chargingTimePct:chargeSteps/n*100,averageSocPct:averageSoc*100,
      socDeviationPP:Math.abs(averageSoc-.8)*100,chargedMWh:charged,dischargedMWh:discharged,
      movementMWh:charged+discharged,minSocPct:minSoc*100,maxSocPct:maxSoc*100,finalSocPct:energy/p.capacityMWh*100,
      peakPowerMW:peakPower,powerViolationSteps:powerViolations,socViolationSamples:socViolations,physicalViolationSamples:physicalViolations,
      balanceErrorMW:balanceError,feasible:powerViolations===0&&socViolations===0}};
  }
  function sweep(load,input){const rows=[];for(let i=0;i<101;i++){const gtgMW=1+11*i/100;rows.push({gtgMW,...evaluate(load,{...input,gtgMW},false).metrics});}return rows;}
  return {defaults,checked,demandKey,generateDemand,evaluate,sweep};
});
