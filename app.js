(function(){
  'use strict';
  const M=window.GTGModel,$=id=>document.getElementById(id);
  let trace=null,result=null,params=null,sweepRows=null,generations=0,timer;
  const charts=new Map(),keys=Object.keys(M.defaults),percent=['etaCharge','etaDischarge','initialSoc'];
  const fmt=(v,d=2)=>Number(v).toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:d});
  function read(){const p={};for(const k of keys)p[k]=Number($(k).value);for(const k of percent)p[k]/=100;return M.checked(p);}
  function setupCanvas(id){const c=$(id),rect=c.getBoundingClientRect(),dpr=window.devicePixelRatio||1;c.width=Math.round(rect.width*dpr);c.height=Math.round(rect.height*dpr);const ctx=c.getContext('2d');ctx.scale(dpr,dpr);return {c,ctx,w:rect.width,h:rect.height};}
  function plot(id,series,{xMax,xMin=0,xLabel='Time (h)',yLabel='',limits=[],selected=null,crosses=null}={}){
    const {c,ctx,w,h}=setupCanvas(id),left=58,right=18,top=18,bottom=38,pw=w-left-right,ph=h-top-bottom;
    let min=Infinity,max=-Infinity;
    for(const s of series)for(const v of s.values){if(v<min)min=v;if(v>max)max=v;}
    for(const v of limits){min=Math.min(min,v.value);max=Math.max(max,v.value);}
    if(!Number.isFinite(min))return;
    const span=max-min||Math.max(1,Math.abs(max)*.05);min-=span*.08;max+=span*.08;
    const X=x=>left+(x-xMin)/(xMax-xMin)*pw,Y=y=>top+(max-y)/(max-min)*ph;
    ctx.font='12px Arial';ctx.textAlign='right';ctx.fillStyle='#555';ctx.strokeStyle='#e5e5eb';ctx.lineWidth=1;
    for(let j=0;j<5;j++){let value=min+(max-min)*j/4,y=Y(value);ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.fillText(fmt(value,Math.abs(max-min)>200?0:1),left-8,y+4);}
    ctx.textAlign='center';for(let j=0;j<5;j++){let x=xMin+(xMax-xMin)*j/4;ctx.fillText(fmt(x,xMax>12?0:1),X(x),h-18);}
    ctx.textAlign='left';ctx.fillStyle='#555';ctx.fillText(yLabel,5,12);ctx.textAlign='right';ctx.fillText(xLabel,w-right,h-2);
    for(const l of limits){ctx.setLineDash([4,4]);ctx.strokeStyle=l.color||'#aaa';ctx.beginPath();ctx.moveTo(left,Y(l.value));ctx.lineTo(w-right,Y(l.value));ctx.stroke();ctx.setLineDash([]);ctx.textAlign='right';ctx.fillStyle=l.color||'#555';ctx.fillText(l.label,w-right-3,Y(l.value)-4);}
    for(const s of series){ctx.strokeStyle=s.color;ctx.lineWidth=1.5;ctx.setLineDash(s.dash||[]);ctx.beginPath();const n=s.values.length,bins=Math.max(1,Math.floor(pw)),step=Math.max(1,Math.ceil(n/bins));let started=false;
      for(let i=0;i<n;i+=step){const end=Math.min(n,i+step);let lo=i,hi=i;for(let k=i+1;k<end;k++){if(s.values[k]<s.values[lo])lo=k;if(s.values[k]>s.values[hi])hi=k;}
        const indices=[...new Set([i,lo,hi,end-1])].sort((a,b)=>a-b);
        for(const k of indices){const x=X(s.x?s.x[k]:k/(s.includeEndpoint?n-1:n)*xMax),y=Y(s.values[k]);if(!started){ctx.moveTo(x,y);started=true;}else ctx.lineTo(x,y);}}
      ctx.stroke();ctx.setLineDash([]);}
    if(crosses){ctx.strokeStyle='#a32626';ctx.lineWidth=1;for(const pt of crosses){const x=X(pt.x),y=Y(pt.y);ctx.beginPath();ctx.moveTo(x-3,y-3);ctx.lineTo(x+3,y+3);ctx.moveTo(x-3,y+3);ctx.lineTo(x+3,y-3);ctx.stroke();}}
    if(selected){const x=X(selected.x);ctx.setLineDash([3,3]);ctx.strokeStyle='#444';ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,top+ph);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#6042b8';ctx.beginPath();ctx.arc(x,Y(selected.y),4,0,Math.PI*2);ctx.fill();}
    charts.set(id,{series,xMax,xMin,X,Y,left,pw});
    c.onpointermove=e=>{const d=charts.get(id),r=c.getBoundingClientRect(),f=Math.max(0,Math.min(1,(e.clientX-r.left-d.left)/d.pw)),x=d.xMin+f*(d.xMax-d.xMin);c.title=`${xLabel}: ${fmt(x)} · `+d.series.map(s=>{const k=Math.min(s.values.length-1,Math.round(f*(s.values.length-1)));return `${s.label}: ${fmt(s.values[k])}`;}).join(' · ');};
  }
  function render(){
    const m=result.metrics;
    $('transitions').textContent=fmt(m.transitions,0);$('chargingTime').textContent=fmt(m.chargingTimePct)+'%';$('socDeviation').textContent=fmt(m.socDeviationPP)+' percentage points';$('movement').textContent=fmt(m.movementMWh)+' MWh';
    $('energyDetails').textContent=`Charged: ${fmt(m.chargedMWh)} MWh · Discharged: ${fmt(m.dischargedMWh)} MWh. Transitions are mode changes, not degradation cycles.`;
    $('socSummary').textContent=`Minimum ${fmt(m.minSocPct)}% · Maximum ${fmt(m.maxSocPct)}% · Final ${fmt(m.finalSocPct)}% · Average ${fmt(m.averageSocPct)}%.`;
    $('status').classList.toggle('invalid',!m.feasible);
    $('status').textContent=m.feasible?'Within modeled power and normal SoC limits. Outage autonomy and dynamic stability are not evaluated.':`Infeasible: ${fmt(m.powerViolationSteps,0)} power-limit intervals; ${fmt(m.socViolationSamples,0)} SoC samples outside 20–90%.${m.physicalViolationSamples?' Physical energy bounds also exceeded; later states are diagnostic only.':''}`;
    const g=new Float64Array(trace.load.length).fill(params.gtgMW);
    plot('powerChart',[{label:'Demand (MW)',values:trace.load,color:'#111'},{label:'GTG (MW)',values:g,color:'#6042b8',dash:[6,4]},{label:'Required storage (MW)',values:result.storage,color:'#2366ac'}],{xMax:params.hours,yLabel:'MW',limits:[{value:params.powerMW,label:'+P limit'},{value:-params.powerMW,label:'−P limit'}]});
    plot('socChart',[{label:'SoC (%)',values:Float64Array.from(result.soc,v=>v*100),color:'#6042b8',includeEndpoint:true}],{xMax:params.hours,yLabel:'SoC (%)',limits:[{value:20,label:'20%'},{value:80,label:'80% target',color:'#2366ac'},{value:90,label:'90%'}]});
    if(sweepRows)renderSweep();
    window.__experiment={params,trace,result,sweepRows,traceGenerations:generations};
  }
  function renderSweep(){
    const x=sweepRows.map(r=>r.gtgMW),spec=[['sweepTransitions','transitions','Count'],['sweepCharging','chargingTimePct','%'],['sweepSoc','socDeviationPP','pp'],['sweepMovement','movementMWh','MWh']];
    for(const [id,key,unit] of spec)plot(id,[{label:unit,values:sweepRows.map(r=>r[key]),x,color:'#6042b8'}],{xMin:1,xMax:12,xLabel:'GTG (MW)',yLabel:unit,selected:{x:params.gtgMW,y:result.metrics[key]},crosses:sweepRows.filter(r=>!r.feasible).map(r=>({x:r.gtgMW,y:r[key]}))});
  }
  function update(){
    try{const p=read(),newDemand=!trace||trace.key!==M.demandKey(p),modelChanged=params&&['capacityMWh','powerMW','etaCharge','etaDischarge','initialSoc'].some(k=>p[k]!==params[k]);
      if(newDemand){trace=M.generateDemand(p);generations++;}
      if(newDemand||modelChanged){sweepRows=null;$('sweepCharts').hidden=true;$('exportSweep').disabled=true;$('sweepStatus').textContent='';}
      params=p;result=M.evaluate(trace.load,p);$('inputError').hidden=true;$('exportTrace').disabled=false;$('exportSettings').disabled=false;$('runSweep').disabled=false;render();
    }catch(e){$('inputError').hidden=false;$('inputError').textContent=e.message;$('status').textContent='Inputs are invalid; graphs and metrics show the last valid run.';for(const id of ['exportTrace','exportSettings','runSweep','exportSweep'])$(id).disabled=true;}
  }
  $('controls').addEventListener('submit',e=>e.preventDefault());
  $('controls').addEventListener('input',e=>{if(e.target.id==='gtgRange')$('gtgMW').value=e.target.value;else if(e.target.id==='gtgMW')$('gtgRange').value=e.target.value;clearTimeout(timer);timer=setTimeout(update,100);});
  $('runSweep').onclick=async()=>{clearTimeout(timer);update();if(!$('inputError').hidden)return;$('runSweep').disabled=true;$('sweepStatus').textContent='Computing 101 candidates…';await new Promise(r=>setTimeout(r,30));
    sweepRows=M.sweep(trace.load,params);$('sweepCharts').hidden=false;$('exportSweep').disabled=false;$('runSweep').disabled=false;$('sweepStatus').textContent=`${sweepRows.filter(r=>r.feasible).length}/101 candidates within modeled limits`;renderSweep();window.__experiment.sweepRows=sweepRows;};
  function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  $('exportTrace').onclick=()=>{const rows=['time_s,it_mw,auxiliary_mw,demand_mw,gtg_mw,required_ldes_mw,soc_start_pct,soc_end_pct'];for(let k=0;k<trace.load.length;k++)rows.push([k*params.dtSeconds,trace.it[k],trace.aux[k],trace.load[k],params.gtgMW,result.storage[k],result.soc[k]*100,result.soc[k+1]*100].join(','));download('gtg-ldes-trace.csv',rows.join('\n'),'text/csv');};
  $('exportSettings').onclick=()=>download('gtg-ldes-settings.json',JSON.stringify({status:'Independent simulation based on P4, not exact reproduction',source:'10.3390/inventions11040081',parameters:params,metrics:result.metrics},null,2),'application/json');
  $('exportSweep').onclick=()=>{const keys=Object.keys(sweepRows[0]);download('gtg-ldes-sweep.csv',[keys.join(','),...sweepRows.map(r=>keys.map(k=>r[k]).join(','))].join('\n'),'text/csv');};
  window.addEventListener('resize',()=>{if(result&&$('inputError').hidden)render();});update();
})();
