/**
 * Synai996 Proxy Monitor — 弹出面板
 */

const QUOTA_PER_UNIT = 500000;
const MODEL_COLORS = [
  '#4c6fff','#7c6adc','#f59e0b','#22c55e','#ef4444',
  '#ec4899','#06b6d4','#f97316','#14b8a6','#6366f1',
];

const API_NODES = [
  { id:'main',  name:'主站',       url:'https://synai996.space' },
  { id:'api',   name:'API 节点',   url:'https://api.synai996.space' },
  { id:'backup',name:'备用节点',   url:'https://api.zybulid.xyz' },
];

let usageChart = null;
let modelChart = null;
let currentData = null;
let nodeResults = {};

// ─── 启动 ───

document.addEventListener('DOMContentLoaded', async () => {
  await applyTheme();
  await init();
  bindEvents();
});

async function init() {
  const cfg = await chrome.storage.sync.get(['apiUrl','userId']);

  if (!cfg.userId) {
    showView('loadingView');
    setStep('scan');
    let err = '';
    try {
      const found = await discoverFromTabs();
      if (found) {
        await chrome.storage.sync.set({ apiUrl: found.apiUrl, userId: found.userId });
        setStep('fetch');
        await withTimeout(chrome.runtime.sendMessage({ action:'refresh' }), 10000);
        const d = await chrome.runtime.sendMessage({ action:'getData' });
        if (d?.timestamp) { currentData = d; renderAll(d); showView('mainView'); runNodes(); return; }
      }
    } catch (e) { err = e.message || String(e); console.warn('[Synai996] 自动发现失败:', e); }
    showView('setupView');
    const dbg = document.getElementById('setupDebug');
    if (dbg && err) { dbg.textContent = err; dbg.hidden = false; }
    return;
  }

  showView('loadingView'); setStep('fetch');
  const d = await chrome.runtime.sendMessage({ action:'getData' });
  if (d?.timestamp) { currentData = d; renderAll(d); showView('mainView'); runNodes(); return; }

  try {
    setStep('fetch');
    await withTimeout(chrome.runtime.sendMessage({ action:'refresh' }), 15000);
    const d2 = await chrome.runtime.sendMessage({ action:'getData' });
    if (d2?.timestamp) { currentData = d2; renderAll(d2); showView('mainView'); runNodes(); }
    else showView('setupView');
  } catch { showView('setupView'); }
}

// ─── 步骤指示器 ───

function setStep(s) {
  ['stepScan','stepRead','stepFetch'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active','done');
  });
  const hint = document.getElementById('loadingHint');
  if (s === 'scan')  { mark('stepScan','active'); if (hint) hint.textContent = '正在检测已登录的页面...'; }
  if (s === 'read')  { mark('stepScan','done'); mark('stepRead','active'); if (hint) hint.textContent = '正在读取登录信息...'; }
  if (s === 'fetch') { mark('stepScan','done'); mark('stepRead','done'); mark('stepFetch','active'); if (hint) hint.textContent = '正在获取数据...'; }
}
function mark(id, cls) { document.getElementById(id)?.classList.add(cls); }

// ─── 自动发现 ───

async function discoverFromTabs() {
  const tabs = await chrome.tabs.query({});
  const targets = ['https://synai996.space','https://api.synai996.space'];
  const matched = tabs.filter(t => { try { return targets.includes(new URL(t.url).origin); } catch { return false; } });
  if (!matched.length) return null;
  setStep('read');

  for (const t of matched) {
    try {
      const r = await tabMsg(t.id, { action:'queryUser' }, 3000);
      if (r?.found) return r;
    } catch {}
  }
  for (const t of matched) {
    try {
      const res = await chrome.scripting.executeScript({
        target:{ tabId:t.id },
        func:() => { try { const u = JSON.parse(localStorage.getItem('user')||'null'); return u?.id ? { found:true, apiUrl:location.origin, userId:u.id, username:u.username, displayName:u.display_name, group:u.group } : null; } catch { return null; } },
      });
      if (res?.[0]?.result?.found) return res[0].result;
    } catch {}
  }
  return null;
}

function tabMsg(id, msg, ms=3000) {
  return new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('超时')), ms);
    chrome.tabs.sendMessage(id, msg, r => { clearTimeout(t); chrome.runtime.lastError ? fail(new Error(chrome.runtime.lastError.message)) : ok(r); });
  });
}

// ─── 视图 ───

function showView(id) { document.querySelectorAll('.view').forEach(v => v.hidden = true); document.getElementById(id).hidden = false; }

// ─── 渲染 ───

function renderAll(d) {
  renderProfile(d.profile);
  renderSubs(d.subscription, d.plans);
  renderStats(d);
  renderUsageChart(d.dailyUsage, 7);
  renderModelChart();
  renderTime(d.timestamp);
  renderSessionExpiry();
}

function renderProfile(r) {
  if (!r?.data) return;
  const u = r.data;
  document.getElementById('username').textContent = u.display_name || u.username;
  document.getElementById('userGroup').textContent = u.group || 'default';

  const q = u.quota||0, used = u.used_quota||0, total = q+used;
  const pct = total > 0 ? q/total*100 : 0;
  document.getElementById('walletBalance').textContent = `$${q2usd(q)}`;
  document.getElementById('walletUsed').textContent = `$${q2usd(used)}`;
  document.getElementById('walletTotal').textContent = `$${q2usd(total)}`;
  const bar = document.getElementById('walletProgress');
  bar.style.width = `${pct}%`;
  if (pct < 20) bar.style.background = 'linear-gradient(90deg,#ef4444,#f87171)';
  else if (pct < 50) bar.style.background = 'linear-gradient(90deg,#f59e0b,#fbbf24)';

  document.getElementById('requestCount').textContent = fmtNum(u.request_count||0);

  chrome.storage.sync.get(['apiUrl']).then(c => {
    const url = (c.apiUrl||'https://api.synai996.space').replace('api.','');
    const a = document.getElementById('openDashboard');
    a.href = url;
    a.onclick = e => { e.preventDefault(); chrome.tabs.create({ url }); };
  });
}

function renderSubs(res, plansRes) {
  const el = document.getElementById('subscriptionsList');
  if (!el) return;
  const list = res?.data?.subscriptions || [];
  if (!list.length) { el.innerHTML = ''; return; }

  // 构建 plan_id -> title 映射
  const planMap = {};
  const planList = plansRes?.data || [];
  planList.forEach(p => {
    const plan = p.plan || p;
    if (plan.id && plan.title) planMap[plan.id] = plan.title;
  });

  el.innerHTML = list.map((item, i) => {
    const s = item.subscription || item;
    const st = s.status||'unknown';
    const stText = st==='active'?'生效中':st==='expired'?'已过期':st==='cancelled'?'已取消':st;
    const stCls = st==='active'?'active':st==='expired'?'expired':'pending';
    const used = s.amount_used||0, total = s.amount_total||0;
    const pct = total>0 ? used/total*100 : 0;
    const remain = total>0 ? total-used : 0;
    let expiry = '';
    if (s.end_time) {
      const endDate = new Date(s.end_time * 1000);
      const dateStr = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}-${String(endDate.getDate()).padStart(2,'0')} ${String(endDate.getHours()).padStart(2,'0')}:${String(endDate.getMinutes()).padStart(2,'0')}`;
      const days = Math.ceil((s.end_time - Date.now()/1000)/86400);
      const color = days<=0?'var(--red)':days<=3?'var(--amber)':'';
      const relText = days>0 ? `（剩余 ${days} 天）` : `（已到期）`;
      expiry = `<div class="sub-expiry"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span${color?` style="color:${color}"`:''}>到期：${dateStr} ${relText}</span></div>`;
    }
    return `<section class="glass-card sub-card" style="animation-delay:${(i+1)*40}ms">
      <div class="card-head"><span class="kicker">${planMap[s.plan_id] || '订阅 #'+(s.id||i+1)}</span><span class="sub-tag ${stCls}">${stText}</span></div>
      <div class="bar"><div class="bar-fill bar-sub" style="width:${Math.min(100,pct)}%"></div></div>
      <div class="quota-row">
        <span>已用 <b>$${q2usd(used)}</b></span>
        <span>额度 <b>${total>0?'$'+q2usd(total):'无限制'}</b></span>
        ${total>0?`<span>剩余 <b>$${q2usd(remain)}</b></span>`:''}
      </div>${expiry}</section>`;
  }).join('');
}

function renderStats(d) {
  if (d.dailyUsage?.data) {
    const today = new Date().toISOString().split('T')[0];
    const td = d.dailyUsage.data.find(x => new Date(x.created_at*1000).toISOString().split('T')[0]===today);
    document.getElementById('todayUsage').textContent = `$${q2usd(td?(td.quota||0):0)}`;
  }
  if (d.ranking?.data) {
    const r = d.ranking.data;
    if (r.my_rank>0) {
      const m = r.my_rank<=3 ? [,'🥇','🥈','🥉'][r.my_rank] : '';
      document.getElementById('myRanking').textContent = `${m}#${r.my_rank}`;
    } else document.getElementById('myRanking').textContent = '—';
  }
}

// ─── 图表 ───

function renderUsageChart(daily, days) {
  const ctx = document.getElementById('usageChart').getContext('2d');
  if (!daily?.data?.length) { if (usageChart) usageChart.destroy(); usageChart=null; return; }

  const now = new Date(), labels=[], vals=[];
  for (let i=days-1;i>=0;i--) {
    const d = new Date(now.getTime()-i*864e5);
    const ds = d.toISOString().split('T')[0];
    labels.push(d.toLocaleDateString('zh-CN',{month:'short',day:'numeric'}));
    const pt = daily.data.find(p => new Date(p.created_at*1000).toISOString().split('T')[0]===ds);
    vals.push(pt?(pt.quota||0)/QUOTA_PER_UNIT:0);
  }
  const dark = isDark();
  if (usageChart) usageChart.destroy();
  usageChart = new Chart(ctx, {
    type:'line',
    data:{ labels, datasets:[{
      data:vals, borderColor:dark?'#88a6ff':'#4c6fff',
      backgroundColor:dark?'rgba(136,166,255,0.06)':'rgba(76,111,255,0.06)',
      borderWidth:2, fill:true, tension:.35,
      pointRadius:days<=7?3:1, pointHoverRadius:5,
      pointBackgroundColor:dark?'#88a6ff':'#4c6fff',
    }]},
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{intersect:false,mode:'index'},
      plugins:{ legend:{display:false},
        tooltip:{
          backgroundColor:dark?'#141e38':'#fff',
          titleColor:dark?'#e8efff':'#18222f',
          bodyColor:dark?'#b0bbd0':'#5f6b7b',
          borderColor:dark?'rgba(157,182,255,0.2)':'rgba(27,31,35,0.08)',
          borderWidth:1, padding:8, displayColors:false,
          callbacks:{label:c=>`$${c.parsed.y.toFixed(2)}`},
        }},
      scales:{
        x:{grid:{display:false},ticks:{color:dark?'#4a5875':'#8e99a8',font:{size:10},maxRotation:0}},
        y:{grid:{color:dark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.04)'},
          ticks:{color:dark?'#4a5875':'#8e99a8',font:{size:10},callback:v=>`$${v}`},
          beginAtZero:true},
      },
    },
  });
}

function renderModelChart() {
  const ctx = document.getElementById('modelChart').getContext('2d');
  const leg = document.getElementById('modelLegend');
  if (!currentData) return;
  fetchModelBreakdown().then(bd => {
    if (!bd?.length) { leg.innerHTML = '<div class="empty">今日暂无数据</div>'; return; }
    const dark = isDark();
    if (modelChart) modelChart.destroy();
    modelChart = new Chart(ctx, {
      type:'doughnut',
      data:{ labels:bd.map(m=>m.name), datasets:[{
        data:bd.map(m=>m.value),
        backgroundColor:bd.map((_,i)=>MODEL_COLORS[i%MODEL_COLORS.length]+'33'),
        borderColor:bd.map((_,i)=>MODEL_COLORS[i%MODEL_COLORS.length]),
        borderWidth:2, hoverBorderWidth:3,
      }]},
      options:{
        responsive:true, maintainAspectRatio:false, cutout:'64%',
        plugins:{ legend:{display:false},
          tooltip:{
            backgroundColor:dark?'#141e38':'#fff',
            titleColor:dark?'#e8efff':'#18222f',
            bodyColor:dark?'#b0bbd0':'#5f6b7b',
            borderColor:dark?'rgba(157,182,255,0.2)':'rgba(27,31,35,0.08)',
            borderWidth:1,
            callbacks:{label:c=>`$${c.parsed.toFixed(2)}`},
          }},
      },
    });
    leg.innerHTML = bd.slice(0,6).map((m,i)=>`
      <div class="legend-item"><span class="legend-dot" style="background:${MODEL_COLORS[i%MODEL_COLORS.length]}"></span>
      <span>${m.name.length>16?m.name.slice(0,14)+'..':m.name}</span>
      <span class="legend-value">$${m.value.toFixed(2)}</span></div>`).join('');
  });
}

async function fetchModelBreakdown() {
  try {
    const cfg = await chrome.storage.sync.get(['apiUrl','accessToken','userId']);
    if (!cfg.userId) return [];
    const base = (cfg.apiUrl||'https://api.synai996.space').replace(/\/+$/,'');
    const now = new Date(), sod = new Date(now.getFullYear(),now.getMonth(),now.getDate());
    const url = `${base}/api/log/self?p=0&size=500&start_timestamp=${Math.floor(sod/1000)}&end_timestamp=${Math.floor(Date.now()/1000)}&type=2`;
    const h = {'Content-Type':'application/json','New-Api-User':String(cfg.userId)};
    if (cfg.accessToken) h.Authorization = cfg.accessToken;
    const r = await fetch(url,{headers:h,credentials:'include'});
    if (!r.ok) return [];
    const d = await r.json();
    if (!d.data?.length) return [];
    const m = {};
    d.data.forEach(l => { const n=l.model_name||'未知'; m[n]=(m[n]||0)+(l.quota||0)/QUOTA_PER_UNIT; });
    return Object.entries(m).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);
  } catch { return []; }
}

// ─── 节点测速 ───

function runNodes() {
  const el = document.getElementById('nodeList');
  if (!el) return;
  el.innerHTML = API_NODES.map(n => `
    <div class="node-row" data-id="${n.id}">
      <span class="node-dot checking"></span>
      <div class="node-info">
        <div class="node-name">${n.name}</div>
        <div class="node-url">${n.url}</div>
      </div>
      <div class="node-stats">
        <span class="node-latency">测速中...</span>
        <a class="node-link" href="${n.url}" target="_blank">访问</a>
      </div>
    </div>`).join('');

  el.querySelectorAll('.node-link').forEach(a => a.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); chrome.tabs.create({url:a.href}); }));
  el.querySelectorAll('.node-row').forEach(row => row.addEventListener('click', () => showNodeDetail(row.dataset.id)));

  API_NODES.forEach(n => testNode(n));
}

async function testNode(n) {
  const row = document.querySelector(`.node-row[data-id="${n.id}"]`);
  if (!row) return;
  const dot = row.querySelector('.node-dot');
  const lat = row.querySelector('.node-latency');
  try {
    const t0 = performance.now();
    const r = await fetch(`${n.url}/api/status`, { method:'GET', signal:AbortSignal.timeout(8000) });
    const ms = Math.round(performance.now()-t0);
    let statusData = null;
    try { statusData = await r.json(); } catch {}
    nodeResults[n.id] = { ok:r.ok, ms, status:r.status, data:statusData };

    if (r.ok) {
      dot.className = 'node-dot ok';
      lat.textContent = `${ms}ms`;
      lat.className = 'node-latency ' + (ms<400?'fast':ms<1200?'medium':'slow');
    } else {
      dot.className = 'node-dot error';
      lat.textContent = `HTTP ${r.status}`;
      lat.className = 'node-latency fail';
    }
  } catch {
    dot.className = 'node-dot error';
    lat.textContent = '不可达';
    lat.className = 'node-latency fail';
    nodeResults[n.id] = { ok:false, ms:null, error:'不可达' };
  }
}

function showNodeDetail(id) {
  const card = document.getElementById('nodeDetailCard');
  const title = document.getElementById('nodeDetailTitle');
  const body = document.getElementById('nodeDetailBody');
  const node = API_NODES.find(n=>n.id===id);
  const result = nodeResults[id];
  if (!card || !node) return;

  title.textContent = node.name + ' — 详情';
  if (!result) { body.innerHTML = '<div class="empty">尚未测速</div>'; card.hidden=false; return; }

  let rows = [
    ['地址', node.url],
    ['状态', result.ok ? '正常' : (result.error || `HTTP ${result.status}`)],
    ['延迟', result.ms != null ? `${result.ms}ms` : '—'],
  ];
  if (result.data) {
    if (result.data.start_time) rows.push(['运行时长', fmtUptime(result.data.start_time)]);
    if (result.data.version) rows.push(['版本', result.data.version]);
  }
  body.innerHTML = rows.map(([l,v]) => `<div class="detail-row"><span class="detail-label">${l}</span><span class="detail-val">${v}</span></div>`).join('');
  card.hidden = false;
}

function fmtUptime(startTime) {
  const sec = Math.floor(Date.now()/1000 - startTime);
  if (sec < 3600) return `${Math.floor(sec/60)} 分钟`;
  if (sec < 86400) return `${Math.floor(sec/3600)} 小时`;
  return `${Math.floor(sec/86400)} 天 ${Math.floor(sec%86400/3600)} 小时`;
}

// ─── 事件 ───

function bindEvents() {
  $('openSettingsBtn')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('settingsBtn')?.addEventListener('click', () => chrome.runtime.openOptionsPage());

  $('retryDiscoverBtn')?.addEventListener('click', async () => {
    const btn = $('retryDiscoverBtn'); btn.disabled=true; btn.textContent='正在检测...';
    try {
      const f = await discoverFromTabs();
      if (f) {
        await chrome.storage.sync.set({ apiUrl:f.apiUrl, userId:f.userId });
        showView('loadingView'); setStep('fetch');
        await chrome.runtime.sendMessage({action:'refresh'});
        const d = await chrome.runtime.sendMessage({action:'getData'});
        if (d?.timestamp) { currentData=d; renderAll(d); showView('mainView'); runNodes(); return; }
      }
      btn.textContent='未检测到'; setTimeout(()=>{btn.textContent='重新检测';btn.disabled=false},2000);
    } catch { btn.textContent='检测失败'; setTimeout(()=>{btn.textContent='重新检测';btn.disabled=false},2000); }
  });

  $('refreshBtn')?.addEventListener('click', async () => {
    const btn = $('refreshBtn'); btn.classList.add('spinning');
    try {
      await chrome.runtime.sendMessage({action:'refresh'});
      const d = await chrome.runtime.sendMessage({action:'getData'});
      if (d?.timestamp) { currentData=d; renderAll(d); }
    } catch(e) { console.error('[Synai996] 刷新失败:',e); }
    btn.classList.remove('spinning');
  });

  $('nodeRefreshBtn')?.addEventListener('click', () => {
    $('nodeDetailCard').hidden = true;
    runNodes();
  });

  $('themeBtn')?.addEventListener('click', async () => {
    const c = await chrome.storage.sync.get(['theme']);
    const cur = c.theme||'system';
    const nxt = cur==='light'?'dark':cur==='dark'?'system':'light';
    await chrome.storage.sync.set({theme:nxt}); applyTheme();
    if (currentData) {
      const days = document.querySelector('.range-btn.active')?.dataset.days||7;
      renderUsageChart(currentData.dailyUsage,parseInt(days));
      renderModelChart();
    }
  });

  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById(`tab-${t.dataset.tab}`).classList.add('active');
    if (t.dataset.tab === 'nodes' && !document.querySelector('.node-row')) runNodes();
  }));

  document.querySelectorAll('.range-btn').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.range-btn').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    if (currentData?.dailyUsage) renderUsageChart(currentData.dailyUsage, parseInt(b.dataset.days));
  }));
}

// ─── 主题 ───

async function applyTheme() {
  const c = await chrome.storage.sync.get(['theme']);
  const t = c.theme||'system';
  if (t==='dark') document.documentElement.setAttribute('data-theme','dark');
  else if (t==='light') document.documentElement.setAttribute('data-theme','light');
  else document.documentElement.removeAttribute('data-theme');
}
function isDark() {
  const e = document.documentElement.getAttribute('data-theme');
  if (e==='dark') return true; if (e==='light') return false;
  return matchMedia('(prefers-color-scheme:dark)').matches;
}

// ─── Session 到期时间 ───

async function renderSessionExpiry() {
  const el = $('sessionExpiry');
  if (!el) return;

  try {
    const cfg = await chrome.storage.sync.get(['apiUrl']);
    const apiUrl = cfg.apiUrl || 'https://synai996.space';

    // 尝试读取 session cookie
    const cookie = await chrome.cookies.get({ url: apiUrl, name: 'session' });
    if (!cookie || !cookie.expirationDate) {
      el.hidden = true;
      return;
    }

    const expireTs = cookie.expirationDate; // 秒级时间戳
    const expireDate = new Date(expireTs * 1000);
    const nowTs = Date.now() / 1000;
    const remainDays = Math.ceil((expireTs - nowTs) / 86400);

    // 格式化日期
    const dateStr = `${expireDate.getFullYear()}-${String(expireDate.getMonth()+1).padStart(2,'0')}-${String(expireDate.getDate()).padStart(2,'0')} ${String(expireDate.getHours()).padStart(2,'0')}:${String(expireDate.getMinutes()).padStart(2,'0')}`;

    // 颜色分级
    el.className = 'topbar-session';
    if (remainDays <= 0) el.classList.add('session-danger');
    else if (remainDays <= 7) el.classList.add('session-warn');

    el.textContent = dateStr;
    el.hidden = false;
  } catch (e) {
    console.warn('[Synai996] 获取 session cookie 失败:', e);
    el.hidden = true;
  }
}

// ─── 工具 ───

function $(id) { return document.getElementById(id); }
function q2usd(q) { const u=Math.abs(q)/QUOTA_PER_UNIT; return u>=1e4?`${(u/1e3).toFixed(1)}k`:u>=100?u.toFixed(1):u.toFixed(2); }
function fmtNum(n) { return n>=1e6?`${(n/1e6).toFixed(1)}M`:n>=1e3?`${(n/1e3).toFixed(1)}k`:String(n); }
function fmtDate(ts) { const d=new Date(ts*1000); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function renderTime(ts) {
  const s = Math.floor((Date.now()-ts)/1000);
  $('lastUpdated').textContent = s<60?'刚刚更新':s<3600?`${Math.floor(s/60)} 分钟前`:`${Math.floor(s/3600)} 小时前`;
}
function withTimeout(p, ms) { return Promise.race([p, new Promise((_,r)=>setTimeout(()=>r(new Error('超时')),ms))]); }
