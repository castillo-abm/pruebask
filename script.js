// Ruta definida manualmente (orden de visita): A→I→H→F→D→B→K→C→E→L→J→G→A
const start = "A";
const customRoute = "AIHFDBKCELJGA".split("");
// Los nodos se acomodan en círculo siguiendo el orden de la ruta (A arriba, sentido horario).
// Son posiciones de un plano abstracto, no GPS.
const order = customRoute.slice(0,-1);
const locations = {};
order.forEach((label,i)=>{
  const ang = (90 - i*360/order.length) * Math.PI/180;
  locations[label] = [
    +(50 + 40*Math.cos(ang)).toFixed(2),
    +(50 + 40*Math.sin(ang)).toFixed(2)
  ];
});
const labels = order;
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
route=customRoute;makeLegs();drawRoute();renderInfo();moveCar();setButtons();
document.getElementById("pauseBtn").disabled=true;
