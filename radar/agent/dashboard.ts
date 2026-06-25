// Self-contained operator dashboard (HTML+CSS+JS). Served by agent/serve.ts.
// Live auto-refresh, one-button autonomy, per-lead execute, approve/send, update.

export const DASHBOARD_HTML = `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>RadarPL — panel operatora</title>
<style>
  :root{--brand:#4f46e5;--bg:#0b1220;--card:#151e31;--line:#243049;--txt:#e7ecf5;--mut:#93a1bd;--ok:#22c55e;--warn:#f59e0b;--bad:#ef4444}
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  body{margin:0;font-family:system-ui,sans-serif;background:var(--bg);color:var(--txt)}
  .wrap{max-width:920px;margin:0 auto;padding:16px 16px 56px}
  header{display:flex;align-items:center;gap:10px;padding:6px 0 14px;position:sticky;top:0;background:var(--bg);z-index:5}
  .logo{width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#4f46e5,#06b6d4)}
  h1{font-size:18px;margin:0;flex:1}
  .pill{font-size:12px;color:var(--mut);display:flex;align-items:center;gap:6px}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--ok);animation:pulse 2s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}
  h3{margin:2px 0 12px;font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.06em}
  .big{width:100%;padding:16px;border:0;border-radius:12px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;font-size:17px;font-weight:700}
  .big:active{transform:scale(.99)}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  .stat{background:#0e1626;border:1px solid var(--line);border-radius:11px;padding:12px;text-align:center}
  .stat b{font-size:20px;display:block}.stat span{color:var(--mut);font-size:11px}
  .row{display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--line)}
  .row:last-child{border:0}.row .t{flex:1;min-width:0}.row .t b{font-weight:600}.row .t small{color:var(--mut);display:block}
  .score{min-width:34px;text-align:center;border-radius:7px;padding:3px 6px;font-weight:700;font-size:13px}
  button.act{padding:8px 11px;border:0;border-radius:9px;background:var(--brand);color:#fff;font-size:13px;font-weight:600}
  button.sec{background:#26324b}
  .muted{color:var(--mut);font-size:13px}
  .tag{font-size:11px;padding:2px 7px;border-radius:6px;background:#26324b;color:var(--mut)}
  .tag.ok{background:rgba(34,197,94,.15);color:#86efac}.tag.warn{background:rgba(245,158,11,.15);color:#fcd34d}
  a{color:#7dd3fc;text-decoration:none}
  #toast{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#1e293b;border:1px solid var(--line);padding:10px 16px;border-radius:10px;opacity:0;transition:.2s}
  #toast.show{opacity:1}
</style>
</head>
<body><div class="wrap">
  <header>
    <div class="logo"></div><h1>RadarPL</h1>
    <div class="pill"><span class="dot"></span><span id="ver">—</span> · <a href="#" onclick="upd();return false">aktualizuj</a></div>
  </header>

  <div class="card">
    <button class="big" onclick="auto()">⚡ RÓB ZA MNIE — pełny cykl i wykonanie</button>
    <p class="muted" id="autohint" style="margin:10px 2px 0">Agent znajdzie, oceni, przygotuje oferty i wykona wygrane zlecenia.</p>
  </div>

  <div class="card"><h3>Pulpit</h3><div class="grid">
    <div class="stat"><b id="k-leads">—</b><span>Leady</span></div>
    <div class="stat"><b id="k-rev">—</b><span>Przychód zł</span></div>
    <div class="stat"><b id="k-del">—</b><span>Wykonane</span></div>
  </div></div>

  <div class="card"><h3>Do zrobienia</h3><div id="outbox"><p class="muted">—</p></div></div>
  <div class="card"><h3>Leady wg intencji</h3><div id="leads"><p class="muted">—</p></div></div>
  <div class="card"><h3>Gotowe prace</h3><div id="dels"><p class="muted">—</p></div></div>
  <div class="card"><h3>P&L wg kategorii · Prognoza</h3><div id="pnl"><p class="muted">—</p></div></div>
</div>
<div id="toast"></div>
<script>
const $=s=>document.querySelector(s), H={"Content-Type":"application/json"};
const sc=v=>v>=70?"#16a34a":v>=50?"#ca8a04":"#475569";
let busy=false;
function toast(t){const e=$("#toast");e.textContent=t;e.classList.add("show");setTimeout(()=>e.classList.remove("show"),2200)}
async function post(p,b){const r=await fetch(p,{method:"POST",headers:H,body:JSON.stringify(b||{})});return r.json()}
async function auto(){if(busy)return;busy=true;$("#autohint").textContent="Pracuję…";const r=await post("/api/auto");toast("Cykl: +"+r.newSignals+" sygnałów, "+r.executed+" wykonanych");busy=false;load()}
async function work(id){toast("Wykonuję "+id+"…");const r=await post("/api/work",{leadId:id});toast(r.gate?("Gotowe "+r.confidence+"/100 ("+r.gate+")"):"Błąd");load()}
async function approve(id){await post("/api/approve",{leadId:id});load()}
async function send(){const r=await post("/api/send");toast("Wysłano "+(r.sent||0));load()}
async function mark(id,s){await post("/api/mark",{leadId:id,status:s});load()}
async function upd(){toast("Sprawdzam aktualizacje…");const r=await post("/api/update");toast(r.status==="staged"?"Zaktualizowano":r.status==="up-to-date"?"Masz najnowszą":r.status)}
function load(){fetch("/api/state").then(r=>r.json()).then(render).catch(()=>{})}
function render(s){
  $("#ver").textContent="v"+s.version;
  $("#k-leads").textContent=s.stats.leads;
  $("#k-rev").textContent=s.pnl.totals.revenue;
  $("#k-del").textContent=s.deliverables.length;
  const ob=s.outbox.length?s.outbox.map(l=>'<div class="row"><span class="score" style="background:'+sc(l.score)+'">'+l.score+'</span><div class="t"><b>'+esc(l.title)+'</b><small>'+l.status+'</small></div><button class="act" onclick="approve(\\''+l.id+'\\')">Zatwierdź</button></div>').join("")+'<div style="margin-top:10px"><button class="act" onclick="send()">Wyślij zaakceptowane</button></div>':'<p class="muted">Brak ofert do akceptacji.</p>';
  $("#outbox").innerHTML=ob;
  $("#leads").innerHTML=s.leads.length?s.leads.map(l=>'<div class="row"><span class="score" style="background:'+sc(l.score)+'">'+l.score+'</span><div class="t"><b>'+esc(l.title)+'</b><small>'+l.tenant+(l.budget?" · "+l.budget+" zł":"")+" · "+l.status+'</small></div>'+(l.executed?'<span class="tag ok">wykonane</span>':'<button class="act" onclick="work(\\''+l.id+'\\')">Wykonaj</button> <button class="sec act" onclick="mark(\\''+l.id+'\\',\\'WON\\')">WON</button>')+'</div>').join(""):'<p class="muted">Brak leadów — kliknij RÓB ZA MNIE.</p>';
  $("#dels").innerHTML=s.deliverables.length?s.deliverables.map(d=>'<div class="row"><span class="tag '+(d.gate==="auto"?"ok":"warn")+'">'+(d.gate||"")+'</span><div class="t"><b>'+esc(d.title)+'</b><small>'+(d.capability||"")+" "+(d.confidence||"")+"/100"+(d.outcome?" · "+d.outcome:"")+'</small></div><a href="/api/deliverable?id='+d.id+'" target="_blank">otwórz</a></div>').join(""):'<p class="muted">Brak gotowych prac.</p>';
  $("#pnl").innerHTML='<div class="muted" style="margin-bottom:8px">Marża <b style="color:#86efac">'+s.pnl.totals.margin+' zł</b> · Koszt '+s.pnl.totals.cost+' zł</div>'+
    s.pnl.byCategory.map(c=>'<div class="row"><div class="t"><b>'+c.key+'</b><small>ROI '+c.roi+'x · akcept '+Math.round(c.acceptanceRate*100)+'%</small></div><span class="tag">'+c.margin+' zł</span></div>').join("")+
    '<div style="margin-top:8px" class="muted">Prognoza: '+(s.forecast.map(f=>f.key+" "+(f.trend==="rising"?"▲":f.trend==="declining"?"▼":"→")).join(" · ")||"—")+'</div>';
}
function esc(t){return (t||"").replace(/[<>&]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;"}[c]))}
load();setInterval(load,5000);
</script>
</body></html>`;
