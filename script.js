// Coordenadas del problema original. Son posiciones de un plano abstracto, no GPS.
const locations = {
  A:[50,50], B:[12,18], C:[20,75], D:[35,10], E:[42,88], F:[58,22],
  G:[67,63], H:[82,15], I:[90,48], J:[78,85], K:[30,42], L:[55,96]
};
const labels = Object.keys(locations);
const start = "A";
const ratePerKm = 5;
const svgNS = "http://www.w3.org/2000/svg";
const map = document.getElementById("map");
const routeLayer = document.getElementById("routeLayer");
const nodeLayer = document.getElementById("nodeLayer");
const carLayer = document.getElementById("carLayer");
const padding = {x:55,y:48};
const view = {w:900,h:570};
let route = [];
let legs = [];
let totalDistance = 0;
let totalCost = 0;
let currentLeg = 0;
let legProgress = 0;
let running = false;
let raf = null;
let lastTimestamp = null;
let speed = 1;
const durationPerLeg = 1300;

function distance(a,b){
  const p=locations[a], q=locations[b];
  return Math.hypot(q[0]-p[0],q[1]-p[1]);
}
function point(label){
  const [x,y]=locations[label];
  return {
    x:padding.x+x/100*(view.w-padding.x*2),
    y:view.h-padding.y-y/100*(view.h-padding.y*2)
  };
}
function el(tag,attrs={},parent){
  const n=document.createElementNS(svgNS,tag);
  Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));
  if(parent)parent.appendChild(n);
  return n;
}

// Held–Karp exacto: minimiza el recorrido que sale de A, visita todos los nodos y regresa a A.
function heldKarp(){
  const others=labels.filter(x=>x!==start), n=others.length, dp=new Map();
  const key=(mask,last)=>`${mask},${last}`;
  for(let j=0;j<n;j++) dp.set(key(1<<j,j),{cost:distance(start,others[j]),prev:-1});
  for(let mask=1;mask<(1<<n);mask++){
    for(let last=0;last<n;last++){
      const state=dp.get(key(mask,last));
      if(!state || !(mask&(1<<last))) continue;
      for(let next=0;next<n;next++){
        if(mask&(1<<next)) continue;
        const nextMask=mask|(1<<next), nextKey=key(nextMask,next);
        const candidate=state.cost+distance(others[last],others[next]);
        if(!dp.has(nextKey)||candidate<dp.get(nextKey).cost)
          dp.set(nextKey,{cost:candidate,prev:last});
      }
    }
  }
  const full=(1<<n)-1;
  let bestLast=-1,best=Infinity;
  for(let last=0;last<n;last++){
    const candidate=dp.get(key(full,last)).cost+distance(others[last],start);
    if(candidate<best){best=candidate;bestLast=last;}
  }
  const reverse=[];
  let mask=full,last=bestLast;
  while(last!==-1){
    reverse.push(others[last]);
    const prev=dp.get(key(mask,last)).prev;
    mask &= ~(1<<last);
    last=prev;
  }
  return [start,...reverse.reverse(),start];
}
function drawRoute(){
  routeLayer.replaceChildren(); nodeLayer.replaceChildren(); carLayer.replaceChildren();
  const pts=route.map(point);
  const d=pts.map((p,i)=>`${i===0?"M":"L"} ${p.x} ${p.y}`).join(" ");
  el("path",{d,class:"route-path-glow"},routeLayer);
  el("path",{d,class:"route-path"},routeLayer);
  // Flechas pequeñas orientadas a lo largo de cada tramo.
  for(let i=0;i<pts.length-1;i++){
    const a=pts[i],b=pts[i+1],t=.56;
    const x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;
    const angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;
    el("path",{d:"M -5 -5 L 5 0 L -5 5 Z",fill:"#3157d5",opacity:.8,
      transform:`translate(${x} ${y}) rotate(${angle}) scale(.8)`},routeLayer);
  }
  labels.forEach(label=>{
    const p=point(label),g=el("g",{class:`node ${label===start?"start":""}`},nodeLayer);
    el("circle",{cx:p.x,cy:p.y,r:17,filter:"url(#shadow)"},g);
    const t=el("text",{x:p.x,y:p.y+1},g);t.textContent=label;
    if(label===start){
      const sub=el("text",{x:p.x,y:p.y+31,class:"node-label"},g);sub.textContent="INICIO";
    }
  });
  const p=point(start);
  const car=el("text",{x:p.x,y:p.y-27,"text-anchor":"middle",class:"car"},carLayer);
  car.textContent="🚗";
}
function makeLegs(){
  legs=[];
  totalDistance=0;
  for(let i=0;i<route.length-1;i++){
    const km=distance(route[i],route[i+1]);
    legs.push({from:route[i],to:route[i+1],km,cost:km*ratePerKm});
    totalDistance+=km;
  }
  totalCost=totalDistance*ratePerKm;
}
function renderInfo(){
  document.getElementById("distance").textContent=`${totalDistance.toFixed(2)} km`;
  document.getElementById("cost").textContent=`$${totalCost.toFixed(2)}`;
  document.getElementById("nodeCount").textContent=String(labels.length);
  document.getElementById("routeText").textContent=`${totalDistance.toFixed(2)} km`;
  const seq=document.getElementById("routeSequence");seq.replaceChildren();
  route.forEach((label,i)=>{
    const node=document.createElement("span");
    node.className="route-node";node.textContent=label;node.dataset.index=i;
    seq.appendChild(node);
    if(i<route.length-1){const arrow=document.createElement("span");arrow.className="arrow";arrow.textContent="→";seq.appendChild(arrow);}
  });
  const tbody=document.getElementById("legsTable");tbody.replaceChildren();
  legs.forEach((leg,i)=>{
    const tr=document.createElement("tr");tr.dataset.leg=i;
    tr.innerHTML=`<td>${leg.from} → ${leg.to}</td><td>${leg.km.toFixed(2)} km</td><td>$${leg.cost.toFixed(2)}</td>`;
    tbody.appendChild(tr);
  });
  updateProgress();
}
function updateProgress(){
  const bar=document.getElementById("progressBar");
  document.querySelectorAll(".route-node").forEach(n=>n.classList.toggle("active",Number(n.dataset.index)===Math.min(currentLeg,route.length-1)));
  document.querySelectorAll("#legsTable tr").forEach(tr=>tr.classList.toggle("current-leg",Number(tr.dataset.leg)===currentLeg));
  if(currentLeg>=legs.length){
    document.getElementById("stepLabel").textContent="Recorrido completado";
    document.getElementById("stepDistance").textContent=`${totalDistance.toFixed(2)} km`;
    document.getElementById("progressText").textContent="El vehículo regresó al punto A.";
    bar.style.width="100%";
    return;
  }
  const leg=legs[currentLeg];
  document.getElementById("stepLabel").textContent=`${leg.from} → ${leg.to}`;
  document.getElementById("stepDistance").textContent=`${leg.km.toFixed(2)} km`;
  const traveled=legs.slice(0,currentLeg).reduce((s,l)=>s+l.km,0)+leg.km*legProgress;
  bar.style.width=`${Math.min(100,traveled/totalDistance*100)}%`;
  document.getElementById("progressText").textContent=`Avance total: ${traveled.toFixed(2)} de ${totalDistance.toFixed(2)} km · Costo acumulado: $${(traveled*ratePerKm).toFixed(2)}`;
}
function moveCar(){
  const car=carLayer.querySelector(".car");
  if(!car)return;
  if(currentLeg>=legs.length){
    const p=point(start);car.setAttribute("x",p.x);car.setAttribute("y",p.y-27);
    return;
  }
  const leg=legs[currentLeg],a=point(leg.from),b=point(leg.to);
  const t=Math.min(1,legProgress);
  car.setAttribute("x",a.x+(b.x-a.x)*t);
  car.setAttribute("y",a.y+(b.y-a.y)*t-27);
  car.setAttribute("transform",`rotate(${Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI} ${a.x+(b.x-a.x)*t} ${a.y+(b.y-a.y)*t-27})`);
}
function animate(timestamp){
  if(!running)return;
  if(lastTimestamp===null)lastTimestamp=timestamp;
  const delta=timestamp-lastTimestamp;lastTimestamp=timestamp;
  legProgress += delta/(durationPerLeg/speed);
  while(legProgress>=1 && currentLeg<legs.length){
    legProgress-=1;currentLeg++;
  }
  if(currentLeg>=legs.length){
    currentLeg=legs.length;legProgress=0;running=false;lastTimestamp=null;
    document.getElementById("progressText").textContent="¡Recorrido completado! El vehículo regresó a A.";
    updateProgress();moveCar();setButtons();return;
  }
  updateProgress();moveCar();
  raf=requestAnimationFrame(animate);
}
function setButtons(){
  document.getElementById("playBtn").disabled=running||currentLeg>=legs.length;
  document.getElementById("pauseBtn").disabled=!running;
}
function play(){
  if(currentLeg>=legs.length)return;
  if(!running){running=true;lastTimestamp=null;setButtons();raf=requestAnimationFrame(animate);}
}
function pause(){running=false;lastTimestamp=null;if(raf)cancelAnimationFrame(raf);setButtons();}
function reset(){
  pause();currentLeg=0;legProgress=0;drawRoute();renderInfo();moveCar();setButtons();
  document.getElementById("stepLabel").textContent="Listo para iniciar";
  document.getElementById("progressText").textContent="Presiona “Iniciar recorrido” para ver el carro moverse.";
}
document.getElementById("playBtn").addEventListener("click",play);
document.getElementById("pauseBtn").addEventListener("click",pause);
document.getElementById("resetBtn").addEventListener("click",reset);
document.getElementById("speed").addEventListener("change",e=>{speed=Number(e.target.value)||1;});
route=heldKarp();makeLegs();drawRoute();renderInfo();moveCar();setButtons();
document.getElementById("pauseBtn").disabled=true;
