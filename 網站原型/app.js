const accounts = {
  hq: {
    password: "demo123",
    name: "總公司管理者",
    role: "總公司權限",
    roleKey: "hq",
    avatar: "總",
    scope: "全台灣",
    intro: "可查看全台區域與所有分校",
    active: true,
  },
  north: {
    password: "demo123",
    name: "北區區域主管",
    role: "區域主管",
    roleKey: "region",
    avatar: "北",
    scope: "北區",
    intro: "可查看北區所有分校",
    active: true,
  },
  tracy: {
    password: "demo123",
    name: "郭婉宜 Tracy",
    role: "分校輔導員",
    roleKey: "counselor",
    avatar: "T",
    scope: "GN26058 新北八里分校",
    intro: "可查看本人負責分校",
    active: true,
  },
  admin: {
    password: "demo123",
    name: "系統管理員",
    role: "系統管理",
    roleKey: "admin",
    avatar: "管",
    scope: "系統設定",
    intro: "管理帳號、角色與資料範圍",
    active: true,
  },
};

const demoAccountIds = ["hq", "north", "tracy", "admin"];
const savedAccounts = JSON.parse(localStorage.getItem("advisoryCustomAccounts") || "{}");
Object.assign(accounts, savedAccounts);

const navItems = [
  { id: "dashboard", label: "決策總覽", icon: "◫", group: "分析中心", roles: ["hq", "region", "counselor"] },
  { id: "school", label: "分校分析", icon: "⌂", group: "分析中心", roles: ["hq", "region", "counselor"] },
  { id: "coaching", label: "輔導追蹤", icon: "✓", group: "管理工具", roles: ["hq", "region", "counselor"] },
  { id: "upload", label: "新增與上傳", icon: "＋", group: "管理工具", roles: ["hq", "region", "counselor"] },
  { id: "sources", label: "資料中心", icon: "▤", group: "管理工具", roles: ["hq", "region", "counselor"] },
  { id: "reports", label: "報表中心", icon: "⇩", group: "管理工具", roles: ["hq", "region", "counselor"] },
  { id: "roles", label: "帳號與權限", icon: "♙", group: "系統設定", roles: ["hq", "admin"] },
];

const school = {
  code: "GN26058",
  name: "新北八里分校",
  region: "北區",
  principal: "林承業",
  tenure: "15 年 6 個月",
  contract: "2027.06.30",
  classes: 14,
  students: 152,
  teachers: "3 張教師卡",
  rooms: 3,
  scores: [
    { year: 2023, score: 80.48 },
    { year: 2024, score: 76.21 },
    { year: 2025, score: 79.07 },
  ],
  dimensions: [
    { name: "教學力", value: 30.99, max: 35 },
    { name: "品學力", value: 19.82, max: 30 },
    { name: "經營力", value: 26.85, max: 30 },
    { name: "素養力", value: 0, max: 5 },
  ],
};

const initialSchools = [{
  code: "GN26058",
  name: "新北八里分校",
  region: "北區",
  assignedTo: "tracy",
  createdBy: "tracy",
  status: "assigned",
}];
const savedSchools = JSON.parse(localStorage.getItem("advisorySchools") || "[]");
let managedSchools = [...initialSchools, ...savedSchools.filter(item => !initialSchools.some(base => base.code === item.code))];
let uploadHistory = JSON.parse(localStorage.getItem("advisoryUploadHistory") || "[]");
let currentUserId = null;
let selectedSchoolCode = "GN26058";
let currentExistingFiles = [];
let currentNewSchoolFiles = [];
let backendAvailable = false;

let currentUser = null;
let currentPage = "dashboard";

const $ = (selector) => document.querySelector(selector);
const loginView = $("#loginView");
const appView = $("#appView");
const content = $("#content");

function demoAccountButtons() {
  $("#demoAccounts").innerHTML = demoAccountIds.map(id => [id, accounts[id]]).map(([id, user]) => `
    <button class="demo-account" type="button" data-account="${id}">
      <strong>${user.role}</strong><small>${id} · ${user.intro}</small>
    </button>
  `).join("");
  document.querySelectorAll(".demo-account").forEach(button => {
    button.addEventListener("click", () => {
      $("#username").value = button.dataset.account;
      $("#password").value = "demo123";
      login(accounts[button.dataset.account]);
    });
  });
}

function login(user) {
  currentUser = user;
  currentUserId = Object.keys(accounts).find(key => accounts[key] === user);
  sessionStorage.setItem("demoUser", currentUserId);
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
  $("#userName").textContent = user.name;
  $("#userRole").textContent = user.role;
  $("#userAvatar").textContent = user.avatar;
  $("#scopeFilters").style.display = user.roleKey === "admin" ? "none" : "";
  buildScopeFilters();
  buildNav();
  navigate(user.roleKey === "admin" ? "roles" : "dashboard");
}

function visibleSchoolsForUser() {
  if (currentUser.roleKey === "hq") return managedSchools;
  if (currentUser.roleKey === "region") return managedSchools.filter(item => item.region === currentUser.scope);
  if (currentUser.roleKey === "counselor") return managedSchools.filter(item => item.assignedTo === currentUserId);
  return [];
}

function selectedManagedSchool() {
  return visibleSchoolsForUser().find(item => item.code === selectedSchoolCode) || visibleSchoolsForUser()[0] || null;
}

function buildScopeFilters() {
  if (currentUser.roleKey === "admin") return;
  const regionSelect = $("#regionSelect");
  const schoolSelect = $("#schoolSelect");
  const accessible = visibleSchoolsForUser();
  const regions = [...new Set(accessible.map(item => item.region))];
  const preferredRegion = accessible.find(item => item.code === selectedSchoolCode)?.region || regions[0] || currentUser.scope;

  regionSelect.innerHTML = regions.map(region => `<option value="${escapeHTML(region)}" ${region === preferredRegion ? "selected" : ""}>${escapeHTML(region)}</option>`).join("");
  regionSelect.disabled = currentUser.roleKey !== "hq";

  const refreshSchoolOptions = () => {
    const scoped = accessible.filter(item => item.region === regionSelect.value);
    if (!scoped.some(item => item.code === selectedSchoolCode)) selectedSchoolCode = scoped[0]?.code || "";
    schoolSelect.innerHTML = scoped.map(item => `<option value="${escapeHTML(item.code)}" ${item.code === selectedSchoolCode ? "selected" : ""}>${escapeHTML(item.code)} ${escapeHTML(item.name)}</option>`).join("");
  };

  refreshSchoolOptions();
  regionSelect.onchange = () => {
    refreshSchoolOptions();
    navigate(currentPage);
  };
  schoolSelect.onchange = () => {
    selectedSchoolCode = schoolSelect.value;
    navigate(currentPage);
  };
}

function buildNav() {
  const allowed = navItems.filter(item => item.roles.includes(currentUser.roleKey));
  let activeGroup = "";
  $("#mainNav").innerHTML = allowed.map(item => {
    const group = item.group !== activeGroup ? `<p class="nav-label">${item.group}</p>` : "";
    activeGroup = item.group;
    return `${group}<button class="nav-button" data-page="${item.id}"><span class="nav-icon">${item.icon}</span>${item.label}</button>`;
  }).join("");
  document.querySelectorAll(".nav-button").forEach(button => {
    button.addEventListener("click", () => navigate(button.dataset.page));
  });
}

function navigate(page) {
  currentPage = page;
  document.querySelectorAll(".nav-button").forEach(button => button.classList.toggle("active", button.dataset.page === page));
  const meta = {
    dashboard: ["全台總覽", currentUser.roleKey === "counselor" ? "我的輔導儀表板" : "營運決策儀表板"],
    school: [selectedManagedSchool() ? `${selectedManagedSchool().region} / ${selectedManagedSchool().code}` : "分校", "分校深度分析"],
    coaching: ["輔導管理", "輔導追蹤與改善"],
    upload: ["資料管理", currentUser.roleKey === "counselor" ? "新增分校與資料上傳" : "資料上傳與分校指派"],
    sources: ["資料管理", "分校資料中心"],
    reports: ["管理工具", "報表輸出中心"],
    roles: ["系統設定", currentUser.roleKey === "admin" ? "帳號與權限管理" : "角色與資料權限"],
  };
  $("#breadcrumb").textContent = meta[page][0];
  $("#pageTitle").textContent = meta[page][1];
  const renderer = { dashboard: renderDashboard, school: renderSchool, coaching: renderCoaching, upload: renderUpload, sources: renderSources, reports: renderReports, roles: renderRoles }[page];
  renderer();
  $(".sidebar").classList.remove("open");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function pageIntro(title, description, actions = "") {
  return `<div class="page-intro"><div><h3>${title}</h3><p>${description}</p></div><div class="page-actions">${actions}</div></div>`;
}

function kpiCard(label, value, unit, icon, delta, warn = false) {
  return `<article class="kpi-card">
    <div class="kpi-top"><span class="kpi-label">${label}</span><span class="kpi-icon">${icon}</span></div>
    <div class="kpi-value"><strong>${value}</strong><small>${unit}</small></div>
    <span class="delta ${warn ? "warn" : ""}">${delta}</span>
  </article>`;
}

function lineChart() {
  const points = "60,116 230,150 400,130";
  return `<svg class="line-chart" viewBox="0 0 460 220" role="img" aria-label="2023到2025校評總分趨勢">
    <defs><linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f58220" stop-opacity=".3"/><stop offset="1" stop-color="#f58220" stop-opacity="0"/></linearGradient></defs>
    <line class="axis-line" x1="45" y1="40" x2="430" y2="40"/><line class="axis-line" x1="45" y1="90" x2="430" y2="90"/><line class="axis-line" x1="45" y1="140" x2="430" y2="140"/><line class="axis-line" x1="45" y1="190" x2="430" y2="190"/>
    <text class="chart-label" x="14" y="43">90</text><text class="chart-label" x="14" y="93">80</text><text class="chart-label" x="14" y="143">70</text><text class="chart-label" x="14" y="193">60</text>
    <path class="trend-area" d="M60 116 L230 150 L400 130 L400 190 L60 190 Z"/><polyline class="trend-line" points="${points}"/>
    <circle class="trend-dot" cx="60" cy="116" r="5"/><circle class="trend-dot" cx="230" cy="150" r="5"/><circle class="trend-dot" cx="400" cy="130" r="5"/>
    <text class="chart-value" x="46" y="101">80.48</text><text class="chart-value" x="216" y="135">76.21</text><text class="chart-value" x="386" y="115">79.07</text>
    <text class="chart-label" x="45" y="211">2023</text><text class="chart-label" x="215" y="211">2024</text><text class="chart-label" x="385" y="211">2025</text>
  </svg>`;
}

function statusList() {
  return `<div class="renewal-period"><span>本約期</span><strong>2026.07.01–2027.06.30</strong><small>本期數據重新累計</small></div><div class="status-list">
    <div class="status-item"><span class="status-symbol">會</span><div><strong>研討活動出席</strong><small>本約期 0 次／標準 ＞ 12 次</small></div><span class="status-pill bad">尚未達標</span></div>
    <div class="status-item"><span class="status-symbol">材</span><div><strong>教材使用點數</strong><small>本約期 0 點／標準 ＞ 480 點</small></div><span class="status-pill bad">尚未達標</span></div>
    <div class="status-item"><span class="status-symbol">器</span><div><strong>年度器材採購</strong><small>本約期 0 元／標準 ＞ 60,000 元</small></div><span class="status-pill bad">尚未達標</span></div>
    <div class="status-item"><span class="status-symbol">檢</span><div><strong>GNEPT 檢定人數</strong><small>本約期 0 人／標準 ≥ 50 人</small></div><span class="status-pill bad">尚未達標</span></div>
  </div>`;
}

function taskTable() {
  return `<table class="task-table">
    <thead><tr><th>改善事項</th><th>來源</th><th>負責人</th><th>期限</th><th>狀態</th></tr></thead>
    <tbody>
      <tr><td><span class="task-title"><i></i>補上傳教職員英文證照</span></td><td>校務評鑑</td><td><span class="owner-chip"><i class="mini-avatar">T</i>Tracy</span></td><td>2026.07.15</td><td><span class="status-pill warn">進行中</span></td></tr>
      <tr><td><span class="task-title"><i></i>完成「一校一故事」影片</span></td><td>05/29 輔導</td><td><span class="owner-chip"><i class="mini-avatar">林</i>林主任</span></td><td>2026.07.31</td><td><span class="status-pill warn">待追蹤</span></td></tr>
      <tr><td><span class="task-title"><i></i>補登校內週會紀錄</span></td><td>行政管理</td><td><span class="owner-chip"><i class="mini-avatar">林</i>林主任</span></td><td>2026.07.10</td><td><span class="status-pill bad">逾期風險</span></td></tr>
      <tr><td><span class="task-title"><i></i>提升拼字達人練習率</span></td><td>品學力</td><td><span class="owner-chip"><i class="mini-avatar">T</i>Tracy</span></td><td>2026.Q3</td><td><span class="status-pill good">已規劃</span></td></tr>
    </tbody>
  </table>`;
}

function applyDashboardMetrics(data) {
  const metrics = data.metrics || {};
  const summary = data.summary || {};
  const setText = (selector, value, fallback = "待補資料") => {
    const element = document.querySelector(selector);
    if (element) element.textContent = value ?? fallback;
  };
  setText("[data-metric='students']", metrics.students);
  setText("[data-metric='evaluation']", metrics.schoolEvaluationScore);
  setText("[data-metric='analysis-progress']", `${summary.completionPercent || 0}%`);
  setText("[data-metric='gnept']", metrics.gneptTotal);
  setText("[data-metric='market-share']", metrics.marketShare == null ? null : `${metrics.marketShare}%`);
  setText("[data-metric='main-material']", metrics.mainMaterialRate == null ? null : `${metrics.mainMaterialRate}%`);
  setText("[data-metric='contract']", metrics.contractEnd);

  const scorePill = $("#dynamicEvaluationPill");
  if (scorePill && metrics.schoolEvaluationScore != null) {
    const passed = Number(metrics.schoolEvaluationScore) >= 70;
    scorePill.textContent = passed ? "合格" : "未達標";
    scorePill.className = `status-pill ${passed ? "good" : "bad"}`;
  }
  const scoreTotal = $("#dynamicEvaluationTotal");
  if (scoreTotal) scoreTotal.textContent = metrics.schoolEvaluationScore ?? "待補";
  const dimensions = $("#dynamicEvaluationDimensions");
  if (dimensions) {
    const items = metrics.evaluationDimensions || [];
    dimensions.innerHTML = items.length
      ? items.map(item => `<div class="score-row"><span>${escapeHTML(item.key)}、${escapeHTML(item.label)}（${escapeHTML(item.weight)}%）</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, Number(item.rawScore) || 0))}%"></div></div><strong>${escapeHTML(Number(item.weightedScore).toFixed(2))}</strong></div>`).join("")
      : ["向度壹", "向度貳", "向度參", "向度肆", "向度伍"].map(name => `<div class="score-row"><span>${name}</span><div class="bar-track"><div class="bar-fill" style="width:0"></div></div><strong>待原檔</strong></div>`).join("");
  }

  const trend = $("#dynamicStudentTrend");
  if (trend) {
    const points = metrics.studentTrend || [];
    const max = Math.max(...points.map(item => Number(item.value)), 1);
    trend.innerHTML = points.length
      ? `<div class="metric-trend">${points.map(item => `<div><strong>${escapeHTML(item.value)}</strong><span style="height:${Math.max(18, Number(item.value) / max * 130)}px"></span><small>${escapeHTML(item.year)}</small></div>`).join("")}</div>`
      : `<div class="empty-state compact"><strong>待補歷年學生數</strong><p>上傳人數報表後會自動產生趨勢。</p></div>`;
  }

  const insights = $("#dynamicInsights");
  if (insights) {
    const findings = data.findings || [];
    insights.innerHTML = findings.map((item, index) => `<div class="insight ${index ? "warn" : ""}"><strong>${index ? "資料待辦" : "系統摘要"}</strong><p>${escapeHTML(item)}</p></div>`).join("");
  }

  const tracking = $("#dynamicTracking");
  if (tracking) {
    const pending = data.pendingItems || [];
    tracking.innerHTML = pending.length
      ? `<table class="task-table"><thead><tr><th>改善事項</th><th>來源</th><th>狀態</th></tr></thead><tbody>${pending.slice(0, 6).map(item => `<tr><td>${escapeHTML(item.reason)}</td><td>${escapeHTML(item.filename)}</td><td><span class="status-pill warn">${escapeHTML(item.status)}</span></td></tr>`).join("")}</tbody></table>`
      : `<div class="empty-state compact"><strong>目前沒有待補項目</strong></div>`;
  }

  const summaryStrip = $("#dynamicSummaryStrip");
  if (summaryStrip) summaryStrip.innerHTML = `<span class="dot"></span><strong>累積摘要</strong> 已解析 ${summary.parsedFiles || 0}／${summary.totalFiles || 0} 個項目，內容完成度 ${summary.completionPercent || 0}%；尚未取得的欄位以「待補資料」呈現。`;
}

async function loadSchoolAnalysis(code) {
  const container = $("#schoolAnalysisResult");
  if (!container) return;
  try {
    const response = await fetch(`/api/schools/${encodeURIComponent(code)}/analysis`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "尚無分析結果");
    const summary = data.summary || {};
    const pending = data.pendingItems || [];
    const evidence = (data.evidence || []).slice(0, 12);
    applyDashboardMetrics(data);
    container.innerHTML = `
      <div class="panel-head"><div><h4>自動內容分析</h4><p>彙整該分校全部歷史上傳資料；仍需輔導員覆核原始證據</p></div><span class="status-pill ${summary.completionPercent === 100 ? "good" : "warn"}">${summary.completionPercent || 0}% 已解析</span></div>
      <section class="kpi-grid analysis-result-kpis">
        ${kpiCard("上傳項目", summary.totalFiles || 0, "個", "▤", data.uploadCount ? `累積 ${data.uploadCount} 批次` : "累積資料")}
        ${kpiCard("成功解析", summary.parsedFiles || 0, "個", "✓", "已取得文字或數據")}
        ${kpiCard("待補／待處理", pending.length, "個", "!", pending.length ? "需要補檔或進一步處理" : "目前無待辦", pending.length > 0)}
        ${kpiCard("內容完成度", summary.completionPercent || 0, "%", "◇", "不等同人工覆核完成", summary.completionPercent < 100)}
      </section>
      <div class="analysis-result-grid">
        <div><h5>系統發現</h5><ul class="analysis-list">${(data.findings || []).map(item => `<li>${escapeHTML(item)}</li>`).join("")}</ul></div>
        <div><h5>管理要求</h5><ul class="analysis-list">${(data.managementRequirements || []).map(item => `<li>${escapeHTML(item)}</li>`).join("")}</ul></div>
      </div>
      ${evidence.length ? `<div class="table-scroll"><table class="task-table"><thead><tr><th>來源檔案</th><th>擷取證據</th></tr></thead><tbody>${evidence.map(item => `<tr><td>${escapeHTML(item.file)}</td><td>${escapeHTML(item.text)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${pending.length ? `<div class="pending-analysis"><strong>待處理項目</strong>${pending.map(item => `<p><span class="status-pill warn">${escapeHTML(item.status)}</span> ${escapeHTML(item.filename)}：${escapeHTML(item.reason)}</p>`).join("")}</div>` : ""}`;
  } catch (error) {
    container.innerHTML = `<div class="empty-state"><span>◇</span><strong>${escapeHTML(error.message)}</strong><p>分析工作可能仍在背景執行，稍後重新整理即可更新。</p></div>`;
  }
}

function renderDashboard() {
  const selected = selectedManagedSchool();
  if (!selected) {
    content.innerHTML = `${pageIntro("我的分校概況", `${currentUser.name} · 目前尚無指派分校`)}<section class="panel"><div class="empty-state"><span>⌂</span><strong>等待區域主管指派</strong><p>主管完成指派後，分校會自動出現在上方選單與分析頁。</p></div></section>`;
    return;
  }
  if (selected && selected.code !== school.code) {
    const assignedName = accounts[selected.assignedTo]?.name || "待主管指派";
    const relatedUploads = uploadHistory.filter(item => item.schoolCode === selected.code);
    const latestUpload = relatedUploads[0];
    content.innerHTML = `
      ${pageIntro(currentUser.roleKey === "hq" ? "全台營運概況" : currentUser.roleKey === "region" ? `${escapeHTML(selected.region)}營運概況` : "我的分校概況", `${currentUser.name} · 資料視野：${escapeHTML(selected.name)}`, `<button class="secondary-button" data-action="print">列印畫面</button><button class="primary-button" data-page-jump="reports">輸出報表</button>`)}
      <div id="dynamicSummaryStrip" class="summary-strip"><span class="dot"></span><strong>累積摘要</strong> 正在讀取 ${escapeHTML(selected.name)} 的分析結果。</div>
      <section class="kpi-grid">
        ${kpiCard("納管分校", "1", "間", "⌂", `${escapeHTML(selected.region)} · 已指派`)}
        ${kpiCard("目前學生人數", "<span data-metric='students'>待補資料</span>", "人", "♙", "依最新可確認資料")}
        ${kpiCard("最新校評總分", "<span data-metric='evaluation'>待補資料</span>", "分", "◆", "合格線 70")}
        ${kpiCard("資料解析度", "<span data-metric='analysis-progress'>0%</span>", "", "✓", latestUpload ? "累積解析進度" : "尚無資料", true)}
      </section>
      <section class="dashboard-grid">
        <article class="panel">
          <div class="panel-head"><div><h4>學生人數趨勢</h4><p>依歷年人數報表自動彙整</p></div><div class="legend"><span><i></i>${escapeHTML(selected.name)}</span></div></div>
          <div id="dynamicStudentTrend" class="chart-wrap"><div class="empty-state compact"><strong>正在讀取趨勢</strong></div></div>
        </article>
        <article class="panel">
          <div class="panel-head"><div><h4>2025 評鑑向度</h4><p>與新北八里使用相同呈現結構</p></div><span id="dynamicEvaluationPill" class="status-pill warn">待分析</span></div>
          <div id="dynamicEvaluationDimensions" class="score-bars">
            ${["向度壹", "向度貳", "向度參", "向度肆", "向度伍"].map(name => `<div class="score-row"><span>${name}</span><div class="bar-track"><div class="bar-fill" style="width:0"></div></div><strong>待原檔</strong></div>`).join("")}
          </div>
          <div class="score-total"><span>評鑑總分</span><strong id="dynamicEvaluationTotal">待補</strong></div>
        </article>
      </section>
      <section class="dashboard-grid">
        <article class="panel"><div class="panel-head"><div><h4>續約條件檢核</h4><p>合約到期：<span data-metric="contract">待補資料</span></p></div></div>
          <div class="status-list">
            <div class="status-item"><span class="status-symbol">會</span><div><strong>研討活動出席</strong><small>本約期資料待補</small></div><span class="status-pill warn">待確認</span></div>
            <div class="status-item"><span class="status-symbol">材</span><div><strong>主幹教材使用</strong><small>近一年比例 <span data-metric="main-material">待補資料</span></small></div><span class="status-pill warn">待覆核</span></div>
            <div class="status-item"><span class="status-symbol">器</span><div><strong>年度器材採購</strong><small>已收到歷年品項，金額待補</small></div><span class="status-pill warn">待確認</span></div>
            <div class="status-item"><span class="status-symbol">檢</span><div><strong>GNEPT 檢定人數</strong><small>已擷取歷史合計 <span data-metric="gnept">待補資料</span> 人</small></div><span class="status-pill warn">待確認期間</span></div>
          </div>
        </article>
        <article class="panel"><div class="panel-head"><div><h4>重點觀察</h4><p>系統依校評與上傳資料彙整</p></div></div><div id="dynamicInsights" class="insight-list"><div class="insight"><strong>正在分析</strong><p>讀取檔案內容與待補項目。</p></div></div></article>
      </section>
      <article class="panel"><div class="panel-head"><div><h4>近期改善追蹤</h4><p>由待補檔案與分析結果建立</p></div><button class="text-button" data-page-jump="coaching">全部項目 →</button></div><div id="dynamicTracking"><div class="empty-state compact"><strong>正在整理待辦</strong></div></div></article>
      <section id="schoolAnalysisResult" class="panel empty-school-panel"><div class="empty-state"><span>◇</span><strong>正在讀取分析結果</strong><p>系統正在整理檔案內容與待處理項目。</p></div></section>`;
    bindContentActions();
    loadSchoolAnalysis(selected.code);
    return;
  }
  const title = currentUser.roleKey === "hq" ? "全台營運概況" : currentUser.roleKey === "region" ? "北區營運概況" : currentUser.roleKey === "admin" ? "系統資料概況" : "我的分校概況";
  const description = `${currentUser.name} · 資料視野：${visibleSchoolsForUser().map(item => item.name).join("、") || "尚無指派分校"}`;
  content.innerHTML = `
    ${pageIntro(title, description, `<button class="secondary-button" data-action="print">列印畫面</button><button class="primary-button" data-page-jump="reports">輸出報表</button>`)}
    <div class="summary-strip"><span class="dot"></span><strong>本期摘要</strong> 新北八里分校已於 2026.07.01 進入新約期，四項續約指標皆須重新累計，目前均尚未達標。</div>
    <section class="kpi-grid">
      ${kpiCard("納管分校", "1", "間", "⌂", "北區 · 營運中")}
      ${kpiCard("目前學生人數", "152", "人", "♙", "較去年同期 +3")}
      ${kpiCard("最新校評總分", "79.07", "分", "◆", "年增 +2.86")}
      ${kpiCard("續約指標", "0 / 4", "項達標", "✓", "本約期剛開始累計", true)}
    </section>
    <section class="dashboard-grid">
      <article class="panel">
        <div class="panel-head"><div><h4>校務評鑑總分趨勢</h4><p>2023–2025 年度評鑑結果</p></div><div class="legend"><span><i></i>新北八里</span><span><i class="gray"></i>合格線 70</span></div></div>
        <div class="chart-wrap">${lineChart()}</div>
      </article>
      <article class="panel">
        <div class="panel-head"><div><h4>2025 評鑑向度</h4><p>各向度加權分數</p></div><span class="status-pill good">合格</span></div>
        <div class="score-bars">${school.dimensions.map(item => `<div class="score-row"><span>${item.name}</span><div class="bar-track"><div class="bar-fill" style="width:${item.value / item.max * 100}%"></div></div><strong>${item.value.toFixed(2)}</strong></div>`).join("")}</div>
        <div class="score-total"><span>評鑑總分</span><strong>79.07</strong></div>
      </article>
    </section>
    <section class="dashboard-grid">
      <article class="panel"><div class="panel-head"><div><h4>續約條件檢核</h4><p>本約期 2026.07.01–2027.06.30</p></div><button class="text-button" data-action="renewal-details">查看詳情 →</button></div>${statusList()}</article>
      <article class="panel"><div class="panel-head"><div><h4>重點觀察</h4><p>系統依校評與輔導紀錄彙整</p></div></div>
        <div class="insight-list">
          <div class="insight"><strong>經營力維持優勢</strong><p>市佔率與續費率表現穩定，2025 經營力為 26.85 分。</p></div>
          <div class="insight warn"><strong>素養力需優先改善</strong><p>連續兩年為 0 分，建議追蹤英檢教材、GEPT Express 與成果揭露。</p></div>
          <div class="insight warn"><strong>資料口徑需要確認</strong><p>基本資料顯示 69.99，評鑑 PDF 顯示 79.07，正式分析前需確認換算版本。</p></div>
        </div>
      </article>
    </section>
    <article class="panel"><div class="panel-head"><div><h4>近期改善追蹤</h4><p>依期限排序的待辦事項</p></div><button class="text-button" data-page-jump="coaching">全部項目 →</button></div>${taskTable()}</article>`;
  bindContentActions();
}

function renderSchool() {
  const selected = selectedManagedSchool();
  if (!selected) {
    content.innerHTML = `${pageIntro("尚無可查看分校", "目前帳號尚未被指派分校")}<section class="panel"><div class="empty-state"><span>⌂</span><strong>等待區域主管指派</strong><p>主管完成指派後，分校會自動出現在上方選單。</p></div></section>`;
    return;
  }
  if (selected.code !== school.code) {
    const assignedName = accounts[selected.assignedTo]?.name || "待主管指派";
    const relatedUploads = uploadHistory.filter(item => item.schoolCode === selected.code);
    content.innerHTML = `
      ${pageIntro(`${escapeHTML(selected.code)} ${escapeHTML(selected.name)}`, "分校已建立並完成權限指派；詳細分析等待上傳資料完成分類", `<button class="secondary-button" data-page-jump="upload">補充資料</button>`)}
      <section class="school-hero">
        <div><p class="eyebrow">${escapeHTML(selected.region)} · NEW SCHOOL</p><h3>${escapeHTML(selected.name)}</h3><p>分校代碼 ${escapeHTML(selected.code)} · 已納入輔導清單</p></div>
        <div class="school-meta"><div><span>所屬區域</span><strong>${escapeHTML(selected.region)}</strong></div><div><span>負責輔導員</span><strong>${escapeHTML(assignedName)}</strong></div><div><span>上傳批次</span><strong>${relatedUploads.length} 批</strong></div></div>
      </section>
      <section id="schoolAnalysisResult" class="panel"><div class="empty-state"><span>▤</span><strong>正在讀取分析結果</strong><p>系統正在整理文件、表格、圖片與待處理項目。</p></div></section>`;
    bindContentActions();
    loadSchoolAnalysis(selected.code);
    return;
  }
  content.innerHTML = `
    ${pageIntro("GN26058 新北八里分校", "分校基本資料、營運表現、校評與續約條件整合檢視", `<button class="secondary-button" data-action="print">列印摘要</button><button class="primary-button" data-page-jump="reports">產生分校報告</button>`)}
    <section class="school-hero">
      <div><p class="eyebrow">NORTH REGION · ACTIVE</p><h3>新北八里分校</h3><p>分校代碼 GN26058 · 資料基準日 2026.07.02</p></div>
      <div class="school-meta"><div><span>負責人</span><strong>林承業</strong></div><div><span>分校年資</span><strong>15 年 6 個月</strong></div><div><span>合約到期</span><strong>2027.06.30</strong></div></div>
    </section>
    <section class="kpi-grid">
      ${kpiCard("學生人數", "152", "人", "♙", "與上月持平")}
      ${kpiCard("班級數", "14", "班", "▦", "近一年 TQC 30 本")}
      ${kpiCard("教室數", "3", "間", "⌂", "空間資料完整")}
      ${kpiCard("教師資料", "3", "張教師卡", "◇", "另有 47 小時培訓")}
    </section>
    <section class="dashboard-grid">
      <article class="panel"><div class="panel-head"><div><h4>校評歷年趨勢</h4><p>總分與合格線比較</p></div></div>${lineChart()}</article>
      <article class="panel"><div class="panel-head"><div><h4>續約條件檢核</h4><p>本約期 2026.07.01–2027.06.30</p></div><button class="text-button" data-action="renewal-details">查看詳情 →</button></div>${statusList()}</article>
    </section>
    <section class="info-grid">
      <article class="panel"><div class="panel-head"><div><h4>分校基本資訊</h4><p>目前最新資料快照</p></div></div>
        <div class="detail-list">
          <div class="detail-item"><span>所屬區域</span><strong>北區</strong></div><div class="detail-item"><span>營運狀態</span><strong>營運中</strong></div>
          <div class="detail-item"><span>近一年學生範圍</span><strong>149–155 人</strong></div><div class="detail-item"><span>最新月學生數</span><strong>152 人</strong></div>
          <div class="detail-item"><span>最近輔導日期</span><strong>2026.06.09</strong></div><div class="detail-item"><span>續費率</span><strong>99.83%</strong></div>
        </div>
      </article>
      <article class="panel"><div class="panel-head"><div><h4>管理建議</h4><p>依現有資料產生的優先次序</p></div></div>
        <div class="insight-list">
          <div class="insight warn"><strong>P1 · 補齊行政證據</strong><p>教師英文證照、校內週會紀錄與公益活動欄位會直接影響評鑑。</p></div>
          <div class="insight warn"><strong>P1 · 拉升素養力</strong><p>推動全民英檢教材、GEPT Express 與風雲榜成果揭露。</p></div>
          <div class="insight"><strong>P2 · 放大在地品牌</strong><p>運用 15 年在地基礎完成「一校一故事」與校友案例影片。</p></div>
        </div>
      </article>
    </section>`;
  bindContentActions();
}

function coachingTabs(active) {
  return `<div class="section-tabs" role="tablist" aria-label="輔導追蹤檢視">
    <button class="${active === "tracking" ? "active" : ""}" data-coaching-tab="tracking" role="tab" aria-selected="${active === "tracking"}">追蹤總覽</button>
    <button class="${active === "analysis" ? "active" : ""}" data-coaching-tab="analysis" role="tab" aria-selected="${active === "analysis"}">綜合分析</button>
  </div>`;
}

function bindCoachingTabs() {
  document.querySelectorAll("[data-coaching-tab]").forEach(button => {
    button.addEventListener("click", () => renderCoaching(button.dataset.coachingTab));
  });
}

function renderCoaching(view = "tracking") {
  if (view === "analysis") {
    content.innerHTML = `
      ${pageIntro("分校綜合分析", "整合校評、營運數據、輔導文件與錄音轉錄，形成具體管理要求", `<button class="secondary-button" data-action="toast">送主管覆核</button><button class="primary-button" data-action="print">輸出管理要求</button>`)}
      ${coachingTabs("analysis")}
      <section class="analysis-hero">
        <div>
          <p class="eyebrow">MANAGEMENT ASSESSMENT · GN26058</p>
          <h3>整體營運穩定，但行政證據與素養力形成明確風險</h3>
          <p>建議列為「限期改善」層級。分校經營力與續費表現穩定，但若未補齊系統紀錄並改善數位學習及英檢推動，下一期校評仍可能失分。</p>
        </div>
        <div class="risk-seal"><span>管理風險</span><strong>中高</strong><small>限期改善</small></div>
      </section>
      <section class="kpi-grid">
        ${kpiCard("高優先問題", "3", "項", "!", "需於 30 日內改善", true)}
        ${kpiCard("現有分析來源", "15", "份", "▤", "另有 4 份錄音待轉錄")}
        ${kpiCard("資料完整度", "92", "%", "◆", "器材金額仍待確認")}
        ${kpiCard("下次管理複核", "07.31", "2026", "✓", "須提交驗收證據", true)}
      </section>
      <section class="dashboard-grid">
        <article class="panel">
          <div class="panel-head"><div><h4>綜合問題判定</h4><p>依影響程度與重複發生情形排序</p></div><span class="status-pill warn">4 項需管理</span></div>
          <div class="issue-stack">
            <div class="issue-row"><span class="priority high">P1</span><div><strong>素養力連續兩年為 0 分</strong><p>全民英檢教材、GEPT Express 與成果揭露皆未形成常態機制。</p></div><span class="status-pill bad">高風險</span></div>
            <div class="issue-row"><span class="priority high">P1</span><div><strong>行政執行有做、系統證據未留存</strong><p>教師英文證照、週會紀錄、問卷與公益活動欄位缺漏，直接造成評鑑失分。</p></div><span class="status-pill bad">反覆發生</span></div>
            <div class="issue-row"><span class="priority medium">P2</span><div><strong>數位學習工具使用不完整</strong><p>拼字達人、MOT／千里傳音及 My G-Book 使用率偏低或無資料。</p></div><span class="status-pill warn">需改善</span></div>
            <div class="issue-row"><span class="priority medium">P2</span><div><strong>管理資料口徑尚未一致</strong><p>2025 校評同時出現 69.99 與 79.07，器材採購金額亦待確認。</p></div><span class="status-pill warn">需釐清</span></div>
          </div>
        </article>
        <article class="panel">
          <div class="panel-head"><div><h4>分析證據來源</h4><p>所有結論均需能回查原始資料</p></div></div>
          <div class="evidence-grid">
            <div><strong>3</strong><span>年度校評報告</span><small>2023–2025</small></div>
            <div><strong>7</strong><span>2026 輔導文件</span><small>最近 06.09</small></div>
            <div><strong>4</strong><span>訪校錄音</span><small class="pending-text">待轉錄，不納入結論</small></div>
            <div><strong>5</strong><span>營運與續約資料</span><small>跨年度資料</small></div>
          </div>
          <div class="analysis-note"><strong>證據原則</strong><p>錄音完成轉錄與人工覆核後，才會加入問題判定；每一項結論將附檔案來源及音檔時間戳。</p></div>
        </article>
      </section>
      <article class="panel directive-panel">
        <div class="panel-head"><div><h4>總部管理要求草案</h4><p>由區域主管確認後正式發布給分校</p></div><span class="status-pill warn">待主管核定</span></div>
        <div class="table-scroll">
          <table class="task-table directive-table">
            <thead><tr><th>優先</th><th>管理要求</th><th>負責人</th><th>期限</th><th>驗收標準</th><th>未完成處置</th></tr></thead>
            <tbody>
              <tr><td><span class="priority high">P1</span></td><td><strong>補齊行政與評鑑證據</strong><small>教師英文證照、校內週會表一／三／九、主任與教師問卷、公益活動欄位。</small></td><td>林主任</td><td>2026.07.15</td><td>後台截圖及上傳清單完整</td><td>列入區主管複核</td></tr>
              <tr><td><span class="priority high">P1</span></td><td><strong>提出素養力改善計畫</strong><small>包含英檢教材、GEPT Express、成果榜與每月執行人數。</small></td><td>林主任／Tracy</td><td>2026.07.22</td><td>書面計畫＋首月執行數據</td><td>加開專案輔導會議</td></tr>
              <tr><td><span class="priority high">P1</span></td><td><strong>完成管理數據口徑確認</strong><small>釐清 69.99／79.07 評鑑分數及年度器材採購金額。</small></td><td>Tracy</td><td>2026.07.10</td><td>主管簽認的單一正式數據</td><td>暫停正式報表引用</td></tr>
              <tr><td><span class="priority medium">P2</span></td><td><strong>提升數位學習落實率</strong><small>建立拼字達人、MOT／千里傳音、My G-Book 的班級月追蹤表。</small></td><td>教學主管</td><td>2026.08.31</td><td>全班級納管且連續兩月成長</td><td>下次訪校現場抽查</td></tr>
              <tr><td><span class="priority medium">P2</span></td><td><strong>完成「一校一故事」品牌素材</strong><small>以 15 年在地經營、校友成果與教學科技為核心。</small></td><td>林主任</td><td>2026.07.31</td><td>60–90 秒影片及發布連結</td><td>納入 Q3 行銷檢討</td></tr>
            </tbody>
          </table>
        </div>
      </article>
      <section class="dashboard-grid">
        <article class="panel">
          <div class="panel-head"><div><h4>錄音整合流程</h4><p>讓訪校對話成為可稽核的輔導紀錄</p></div></div>
          <ol class="process-steps">
            <li><span>1</span><div><strong>語音轉文字</strong><p>保留原音檔、日期及逐句時間戳。</p></div></li>
            <li><span>2</span><div><strong>說話者與議題辨識</strong><p>區分輔導員／分校回應，標記問題與承諾。</p></div></li>
            <li><span>3</span><div><strong>跨資料比對</strong><p>與同日輔導表、校評、目標及歷史紀錄交叉驗證。</p></div></li>
            <li><span>4</span><div><strong>人工確認後入庫</strong><p>確認責任人、期限與原意，再併入正式紀錄。</p></div></li>
          </ol>
        </article>
        <article class="panel">
          <div class="panel-head"><div><h4>主管發布原則</h4><p>有力度，也要有證據與可執行性</p></div></div>
          <div class="insight-list">
            <div class="insight"><strong>問題必須具體</strong><p>指出哪個指標、哪份資料、連續多久未改善，不使用模糊評語。</p></div>
            <div class="insight"><strong>要求必須可驗收</strong><p>每項要求均有負責人、日期、成果格式及達標標準。</p></div>
            <div class="insight warn"><strong>逾期必須有後續處置</strong><p>依風險安排主管複核、專案會議或現場抽查，不讓要求停在文字上。</p></div>
          </div>
        </article>
      </section>`;
    bindContentActions();
    bindCoachingTabs();
    return;
  }

  content.innerHTML = `
    ${pageIntro("輔導追蹤與改善", "整合訪校紀錄、改善事項、負責人與完成期限", `<button class="secondary-button" data-action="toast">新增追蹤事項</button><button class="primary-button" data-action="print">輸出追蹤表</button>`)}
    ${coachingTabs("tracking")}
    <section class="kpi-grid">
      ${kpiCard("待追蹤事項", "4", "項", "✓", "1 項有逾期風險", true)}
      ${kpiCard("2026 輔導紀錄", "7", "份", "▤", "最近更新 06.09")}
      ${kpiCard("訪校錄音", "4", "個", "◉", "共屬 05.09 訪校")}
      ${kpiCard("完成率", "62", "%", "◆", "本季較上季 +8%")}
    </section>
    <section class="dashboard-grid">
      <article class="panel"><div class="panel-head"><div><h4>改善事項清單</h4><p>依期限與風險排序</p></div></div>${taskTable()}</article>
      <article class="panel"><div class="panel-head"><div><h4>近期輔導歷程</h4><p>2026 年訪校與文件紀錄</p></div></div>
        <div class="timeline">
          <div class="timeline-item"><time>2026.06.09</time><h5>教務輔導紀錄</h5><p>追蹤續約後續、校評補件與下半年活動規劃。</p></div>
          <div class="timeline-item"><time>2026.05.29</time><h5>訪校輔導與重點摘要</h5><p>聚焦校評低分項目、一校一故事、檢定及人力配置。</p></div>
          <div class="timeline-item"><time>2026.05.09</time><h5>分校親訪</h5><p>留存 4 份訪校錄音，待後續轉錄與議題標記。</p></div>
          <div class="timeline-item"><time>2026.04.10</time><h5>季度輔導</h5><p>檢視第一季目標與招生、教學活動進度。</p></div>
          <div class="timeline-item"><time>2026.01.20</time><h5>年度首次輔導</h5><p>完成兩頁輔導表並啟動年度追蹤。</p></div>
        </div>
      </article>
    </section>`;
  bindContentActions();
  bindCoachingTabs();
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function persistSchoolData() {
  const customSchools = managedSchools.filter(item => !initialSchools.some(base => base.code === item.code));
  localStorage.setItem("advisorySchools", JSON.stringify(customSchools));
  localStorage.setItem("advisoryUploadHistory", JSON.stringify(uploadHistory.slice(0, 30)));
}

async function syncBackendState() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error("後端狀態讀取失敗");
    const data = await response.json();
    managedSchools = data.schools;
    uploadHistory = data.uploads;
    backendAvailable = true;
    return true;
  } catch (error) {
    backendAvailable = false;
    return false;
  }
}

async function apiRequest(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "後端處理失敗");
  return data;
}

function userRegion() {
  if (currentUser.roleKey === "hq") return "全台灣";
  if (currentUser.roleKey === "region") return currentUser.scope;
  const assigned = managedSchools.find(item => item.assignedTo === currentUserId);
  return assigned?.region || "北區";
}

function visibleSchoolsForUpload() {
  return visibleSchoolsForUser();
}

function detectSchoolCode(filename) {
  const match = filename.toUpperCase().match(/\b[A-Z]{2}\d{5}\b/);
  return match ? match[0] : "";
}

function classifyUploadFile(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  const categories = {
    pdf: "PDF 文件", doc: "Word 文件", docx: "Word 文件", xls: "Excel 資料", xlsx: "Excel 資料",
    xltx: "Excel 範本", jpg: "圖片掃描", jpeg: "圖片掃描", png: "圖片掃描",
    m4a: "訪校錄音", mp3: "訪校錄音", wav: "訪校錄音",
  };
  return categories[extension] || "其他附件";
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function uploadTabs(active) {
  const tabs = [{ id: "existing", label: "既有分校上傳" }];
  if (currentUser.roleKey === "counselor") tabs.push({ id: "new", label: "新增分校" });
  if (["region", "hq"].includes(currentUser.roleKey)) tabs.push({ id: "assignment", label: "分校指派" });
  return `<div class="section-tabs upload-tabs" role="tablist" aria-label="新增與上傳功能">
    ${tabs.map(tab => `<button class="${active === tab.id ? "active" : ""}" data-upload-tab="${tab.id}" role="tab" aria-selected="${active === tab.id}">${tab.label}</button>`).join("")}
  </div>`;
}

function historyMarkup() {
  const visibleHistory = uploadHistory.filter(item => currentUser.roleKey === "hq" || item.region === userRegion()).slice(0, 5);
  if (!visibleHistory.length) return `<div class="empty-state"><span>◫</span><strong>尚無上傳紀錄</strong><p>完成第一批資料確認後，處理進度會顯示在這裡。</p></div>`;
  return `<div class="upload-history">${visibleHistory.map(item => {
    const schoolRecord = managedSchools.find(schoolItem => schoolItem.code === item.schoolCode);
    const status = item.status === "待主管指派" && schoolRecord?.assignedTo ? "已指派 · 待分析" : item.status;
    return `<div class="history-row"><span class="file-type">↑</span><div><strong>${escapeHTML(item.schoolName)}</strong><small>${item.fileCount} 份檔案 · ${escapeHTML(item.year)} · ${escapeHTML(item.createdBy)}</small></div><span>${escapeHTML(item.createdAt)}</span><span class="status-pill ${status === "分析完成" ? "good" : "warn"}">${escapeHTML(status)}</span></div>`;
  }).join("")}</div>`;
}

function renderUpload(view = "existing") {
  if (view === "new" && currentUser.roleKey !== "counselor") view = "existing";
  if (view === "assignment" && !["region", "hq"].includes(currentUser.roleKey)) view = "existing";
  const region = userRegion();

  if (view === "new") {
    content.innerHTML = `
      ${pageIntro("新增分校", "由輔導員建立新分校並上傳首次資料；負責輔導員由區域主管另行指派")}
      ${uploadTabs("new")}
      <div class="upload-layout">
        <section class="panel upload-form-panel">
          <div class="panel-head"><div><h4>1. 填寫分校與首次資料</h4><p>區域依登入帳號自動帶入；分校代碼可由系統辨識或手動補填</p></div><span class="status-pill warn">建立後待主管指派</span></div>
          <div class="upload-fields upload-fields--new">
            <label>所屬區域<input value="${escapeHTML(region)}" disabled></label>
            <label>分校名稱<input id="newSchoolName" placeholder="請輸入完整分校名稱" required></label>
            <label>分校代碼<input id="newSchoolCode" placeholder="上傳後自動帶入，或手動輸入" autocomplete="off"></label>
            <label>資料年度<select id="newSchoolYear"><option>2026</option><option>2025</option><option>2024</option><option>跨年度</option></select></label>
          </div>
          <div class="dropzone" id="newSchoolDropzone" tabindex="0">
            <input id="newSchoolFiles" type="file" multiple hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.xltx,.jpg,.jpeg,.png,.m4a,.mp3,.wav">
            <input id="newSchoolFolderFiles" type="file" multiple webkitdirectory hidden>
            <span class="drop-icon">＋</span><strong>拖曳首次資料到這裡</strong><p>若資料中含有分校代碼，系統會自動帶入；沒有代碼時可在判讀後手動補填。</p>
            <button class="secondary-button" type="button" data-choose-files="new">選擇檔案</button>
            <button class="secondary-button" type="button" data-choose-folder="new">選擇資料夾</button>
          </div>
          <div id="newSchoolFilePreview" class="file-preview"></div>
          <div class="upload-confirm-bar"><div><strong>確認後的處理</strong><p>建立分校、保存首次上傳紀錄，並送交區域主管指派。</p></div><button id="createSchoolButton" class="primary-button" type="button" disabled>建立分校並送出</button></div>
        </section>
        <aside class="panel upload-guide"><div class="panel-head"><div><h4>建立規則</h4><p>避免錯校與重複建立</p></div></div>
          <div class="process-steps">
            <li><span>1</span><div><strong>區域自動帶入</strong><p>目前登入者屬於 ${escapeHTML(region)}，不可自行改區。</p></div></li>
            <li><span>2</span><div><strong>代碼自動帶入或補填</strong><p>辨識到例如 GN26058 時會自動帶入；未辨識到時再由輔導員手動補上。</p></div></li>
            <li><span>3</span><div><strong>先建立、後指派</strong><p>建立者可完成首次上傳，但長期歸屬由區域主管決定。</p></div></li>
          </div>
        </aside>
      </div>`;
    bindUploadCommon("new");
    return;
  }

  if (view === "assignment") {
    const scopedSchools = currentUser.roleKey === "hq" ? managedSchools : managedSchools.filter(item => item.region === region);
    const counselors = Object.entries(accounts).filter(([, user]) => user.roleKey === "counselor" && user.active !== false);
    const pending = scopedSchools.filter(item => !item.assignedTo);
    content.innerHTML = `
      ${pageIntro("分校指派", currentUser.roleKey === "hq" ? "查看全台待指派分校並設定負責輔導員" : `管理 ${escapeHTML(region)} 分校與輔導員歸屬`)}
      ${uploadTabs("assignment")}
      <section class="kpi-grid">
        ${kpiCard("待指派分校", pending.length, "間", "!", pending.length ? "需要主管處理" : "目前沒有待辦", pending.length > 0)}
        ${kpiCard("區域分校", scopedSchools.length, "間", "⌂", region)}
        ${kpiCard("可指派輔導員", counselors.length, "人", "♙", "已啟用帳號")}
        ${kpiCard("已完成指派", scopedSchools.filter(item => item.assignedTo).length, "間", "✓", "可隨時調整")}
      </section>
      <section class="panel">
        <div class="panel-head"><div><h4>分校與負責輔導員</h4><p>待指派項目優先顯示，也可調整既有分校負責人</p></div></div>
        <div class="table-scroll"><table class="task-table assignment-table"><thead><tr><th>分校</th><th>區域</th><th>建立者</th><th>目前負責人</th><th>指派／轉移</th><th>操作</th></tr></thead>
        <tbody>${scopedSchools.map(item => {
          const creator = accounts[item.createdBy]?.name || item.createdBy || "—";
          const assignedName = accounts[item.assignedTo]?.name || "待主管指派";
          return `<tr><td><strong>${escapeHTML(item.name)}</strong><small>${escapeHTML(item.code)}</small></td><td>${escapeHTML(item.region)}</td><td>${escapeHTML(creator)}</td><td><span class="status-pill ${item.assignedTo ? "good" : "warn"}">${escapeHTML(assignedName)}</span></td>
            <td><select data-assignment-select="${escapeHTML(item.code)}"><option value="">請選擇輔導員</option>${counselors.map(([id, user]) => `<option value="${id}" ${item.assignedTo === id ? "selected" : ""}>${escapeHTML(user.name)}</option>`).join("")}</select></td>
            <td><button class="account-action" type="button" data-assign-school="${escapeHTML(item.code)}">${item.assignedTo ? "更新指派" : "確認指派"}</button></td></tr>`;
        }).join("") || `<tr><td colspan="6">目前沒有可管理的分校。</td></tr>`}</tbody></table></div>
      </section>`;
    bindUploadTabs();
    document.querySelectorAll("[data-assign-school]").forEach(button => button.addEventListener("click", async () => {
      const code = button.dataset.assignSchool;
      const select = document.querySelector(`[data-assignment-select="${code}"]`);
      if (!select.value) {
        showToast("請先選擇負責輔導員");
        return;
      }
      button.disabled = true;
      button.textContent = "處理中…";
      try {
        if (!backendAvailable) throw new Error("本機後端尚未啟動");
        await apiRequest(`/api/schools/${encodeURIComponent(code)}/assign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ counselor_id: select.value }),
        });
        await syncBackendState();
        const target = managedSchools.find(item => item.code === code);
        showToast(`${target.name} 已指派給 ${accounts[select.value].name}`);
        renderUpload("assignment");
      } catch (error) {
        showToast(error.message);
        button.disabled = false;
        button.textContent = "重新嘗試";
      }
    }));
    return;
  }

  const schools = visibleSchoolsForUpload();
  content.innerHTML = `
    ${pageIntro("既有分校資料上傳", "選擇分校後批次上傳；資料含有分校代碼時，系統會協助比對")}
    ${uploadTabs("existing")}
    <div class="upload-layout">
      <section class="panel upload-form-panel">
        <div class="panel-head"><div><h4>1. 選擇分校與資料年度</h4><p>清單只顯示目前權限可管理的分校</p></div><span class="scope-chip">${escapeHTML(region)}</span></div>
        <div class="summary-strip upload-prototype-note"><span class="dot"></span><strong>${backendAvailable ? "本機後端已連線" : "本機後端未連線"}</strong> ${backendAvailable ? "上傳檔案會實際寫入分校資料夾，並建立批次分析清冊。" : "目前只能展示流程，請先啟動本機後端。"}</div>
        <div class="upload-fields upload-fields--existing">
          <label>分校名稱<select id="existingSchoolSelect">${schools.map(item => `<option value="${escapeHTML(item.code)}">${escapeHTML(item.code)} ${escapeHTML(item.name)}</option>`).join("")}</select></label>
          <label>資料年度<select id="existingUploadYear"><option>2026</option><option>2025</option><option>2024</option><option>跨年度</option></select></label>
          <label>資料分類<select id="existingUploadCategory"><option>由系統自動判讀</option><option>經營數據</option><option>續約指標數據</option><option>校務評鑑</option><option>輔導紀錄</option><option>續約管理</option></select></label>
        </div>
        <div class="dropzone" id="existingDropzone" tabindex="0">
          <input id="existingFiles" type="file" multiple hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.xltx,.jpg,.jpeg,.png,.m4a,.mp3,.wav">
          <input id="existingFolderFiles" type="file" multiple webkitdirectory hidden>
          <span class="drop-icon">↑</span><strong>拖曳檔案到這裡</strong><p>支援 PDF、Word、Excel、圖片及錄音；可一次選擇多個檔案。</p>
          <button class="secondary-button" type="button" data-choose-files="existing">選擇檔案</button>
          <button class="secondary-button" type="button" data-choose-folder="existing">選擇資料夾</button>
        </div>
        <div id="existingFilePreview" class="file-preview"></div>
        <div class="upload-confirm-bar"><div><strong>確認入庫前檢查</strong><p>有代碼時協助比對；沒有代碼則依目前選取的分校入庫。</p></div><button id="confirmExistingUpload" class="primary-button" type="button" disabled>確認上傳</button></div>
      </section>
      <aside class="panel upload-guide"><div class="panel-head"><div><h4>最近上傳</h4><p>目前資料範圍內的處理紀錄</p></div></div>${historyMarkup()}</aside>
    </div>`;
  bindUploadCommon("existing");
}

function bindUploadTabs() {
  document.querySelectorAll("[data-upload-tab]").forEach(button => button.addEventListener("click", () => renderUpload(button.dataset.uploadTab)));
}

function bindUploadCommon(mode) {
  bindUploadTabs();
  const input = mode === "existing" ? $("#existingFiles") : $("#newSchoolFiles");
  const folderInput = mode === "existing" ? $("#existingFolderFiles") : $("#newSchoolFolderFiles");
  const dropzone = mode === "existing" ? $("#existingDropzone") : $("#newSchoolDropzone");
  document.querySelector(`[data-choose-files="${mode}"]`).addEventListener("click", event => {
    event.stopPropagation();
    input.click();
  });
  document.querySelector(`[data-choose-folder="${mode}"]`).addEventListener("click", event => {
    event.stopPropagation();
    folderInput.click();
  });
  dropzone.addEventListener("click", event => {
    if (!event.target.closest("button")) input.click();
  });
  ["dragenter", "dragover"].forEach(eventName => dropzone.addEventListener(eventName, event => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach(eventName => dropzone.addEventListener(eventName, event => {
    event.preventDefault();
    dropzone.classList.remove("dragging");
  }));
  dropzone.addEventListener("drop", event => updateUploadFiles(mode, event.dataTransfer.files));
  input.addEventListener("change", () => updateUploadFiles(mode, input.files));
  folderInput.addEventListener("change", () => updateUploadFiles(mode, folderInput.files));
  if (mode === "existing") {
    $("#existingSchoolSelect").addEventListener("change", () => renderFilePreview("existing"));
    $("#confirmExistingUpload").addEventListener("click", confirmExistingUpload);
  } else {
    $("#newSchoolName").addEventListener("input", () => renderFilePreview("new"));
    $("#newSchoolCode").addEventListener("input", event => {
      event.target.value = event.target.value.toUpperCase().replace(/\s+/g, "");
      event.target.dataset.source = "manual";
      renderFilePreview("new");
    });
    $("#createSchoolButton").addEventListener("click", createNewSchoolFromUpload);
  }
}

function updateUploadFiles(mode, files) {
  const usableFiles = Array.from(files).filter(file => {
    const relativePath = file.webkitRelativePath || file.name;
    return !relativePath.split("/").some(part => part.startsWith("."));
  });
  if (mode === "existing") currentExistingFiles = usableFiles;
  else {
    currentNewSchoolFiles = usableFiles;
    const codeInput = $("#newSchoolCode");
    if (codeInput) {
      codeInput.value = "";
      codeInput.dataset.source = "";
    }
  }
  renderFilePreview(mode);
}

function renderFilePreview(mode) {
  const files = mode === "existing" ? currentExistingFiles : currentNewSchoolFiles;
  const container = mode === "existing" ? $("#existingFilePreview") : $("#newSchoolFilePreview");
  const actionButton = mode === "existing" ? $("#confirmExistingUpload") : $("#createSchoolButton");
  if (!files.length) {
    container.innerHTML = "";
    actionButton.disabled = true;
    return;
  }
  const selectedCode = mode === "existing" ? $("#existingSchoolSelect").value : "";
  const codes = [...new Set(files.map(file => detectSchoolCode(file.name)).filter(Boolean))];
  const newCodeInput = mode === "new" ? $("#newSchoolCode") : null;
  if (newCodeInput && codes.length === 1 && newCodeInput.dataset.source !== "manual") {
    newCodeInput.value = codes[0];
    newCodeInput.dataset.source = "auto";
  }
  let hasBlockingIssue = false;
  const rows = files.map(file => {
    const code = detectSchoolCode(file.name);
    let state = "辨識成功";
    let stateClass = "good";
    const likelyFolderPlaceholder = !file.type && !file.name.includes(".") && file.size === 16384;
    if (likelyFolderPlaceholder) {
      state = "只有資料夾外殼，請改用「選擇資料夾」";
      stateClass = "bad";
      hasBlockingIssue = true;
    } else if (!code) {
      state = mode === "existing" ? "未含代碼，依所選分校" : "未含代碼，可手動補填";
      stateClass = "warn";
    } else if (mode === "existing" && code !== selectedCode) {
      state = "代碼與分校不符";
      stateClass = "bad";
      hasBlockingIssue = true;
    } else if (mode === "new" && codes.length > 1) {
      state = "同批出現不同代碼";
      stateClass = "bad";
      hasBlockingIssue = true;
    }
    return `<tr><td><strong>${escapeHTML(file.name)}</strong><small>${formatFileSize(file.size)}</small></td><td>${escapeHTML(classifyUploadFile(file))}</td><td><code>${code || "未辨識"}</code></td><td><span class="status-pill ${stateClass}">${state}</span></td></tr>`;
  }).join("");
  container.innerHTML = `<div class="preview-head"><strong>2. 系統判讀預覽</strong><span>${files.length} 份檔案</span></div><div class="table-scroll"><table class="task-table upload-file-table"><thead><tr><th>檔案</th><th>推測類型</th><th>分校代碼</th><th>檢查結果</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const nameReady = mode === "existing" || $("#newSchoolName").value.trim().length > 1;
  const codeReady = mode === "existing" || newCodeInput.value.trim().length > 0;
  actionButton.disabled = hasBlockingIssue || !nameReady || !codeReady;
}

async function confirmExistingUpload() {
  const selectedCode = $("#existingSchoolSelect").value;
  const targetSchool = managedSchools.find(item => item.code === selectedCode);
  const button = $("#confirmExistingUpload");
  const fileCount = currentExistingFiles.length;
  if (!backendAvailable) {
    showToast("本機後端尚未啟動，檔案不會被保存");
    return;
  }
  const form = new FormData();
  form.append("mode", "existing");
  form.append("school_code", selectedCode);
  form.append("school_name", targetSchool.name);
  form.append("region", targetSchool.region);
  form.append("year", $("#existingUploadYear").value);
  form.append("category", $("#existingUploadCategory").value);
  form.append("created_by", currentUserId);
  currentExistingFiles.forEach(file => form.append("files", file, file.name));
  button.disabled = true;
  button.textContent = "正在寫入資料夾…";
  try {
    await apiRequest("/api/uploads", { method: "POST", body: form });
    currentExistingFiles = [];
    await syncBackendState();
    showToast(`${targetSchool.name}：${fileCount} 份檔案已實際入庫`);
    renderUpload("existing");
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
    button.textContent = "重新上傳";
  }
}

async function createNewSchoolFromUpload() {
  const codes = [...new Set(currentNewSchoolFiles.map(file => detectSchoolCode(file.name)).filter(Boolean))];
  const code = $("#newSchoolCode").value.trim().toUpperCase();
  if (!code) {
    showToast("請補上分校代碼");
    return;
  }
  if (codes.length > 1) {
    showToast("同批資料出現不同分校代碼，請先確認檔案");
    return;
  }
  if (managedSchools.some(item => item.code === code)) {
    showToast(`分校代碼 ${code} 已存在，請改用既有分校上傳`);
    return;
  }
  const name = $("#newSchoolName").value.trim();
  if (!backendAvailable) {
    showToast("本機後端尚未啟動，無法建立分校資料夾");
    return;
  }
  const button = $("#createSchoolButton");
  const form = new FormData();
  form.append("mode", "new");
  form.append("school_code", code);
  form.append("school_name", name);
  form.append("region", userRegion());
  form.append("year", $("#newSchoolYear").value);
  form.append("category", "由系統自動判讀");
  form.append("created_by", currentUserId);
  currentNewSchoolFiles.forEach(file => form.append("files", file, file.name));
  button.disabled = true;
  button.textContent = "正在建檔與寫入…";
  try {
    await apiRequest("/api/uploads", { method: "POST", body: form });
    currentNewSchoolFiles = [];
    await syncBackendState();
    buildScopeFilters();
    showToast(`${name} 已建立並完成首次入庫，等待區域主管指派`);
    renderUpload("existing");
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
    button.textContent = "重新送出";
  }
}

function renderSources() {
  const sources = [
    ["XLT", "2024–2026 新北八里人數", "學生人數與區域比較", "跨年度", "已解析"],
    ["PDF", "2025 年校務評鑑指標總表", "校務評鑑", "2025", "已解析"],
    ["DOC", "2026.05.29 輔導重點", "輔導紀錄", "2026", "已解析"],
    ["XLS", "續約管理三步驟檢核表", "續約管理", "2026", "已解析"],
    ["JPG", "主品項器材近三年數據", "續約指標", "跨年度", "待覆核"],
    ["M4A", "05.09 訪校錄音（4 份）", "訪校錄音", "2026", "待轉錄"],
  ];
  content.innerHTML = `
    ${pageIntro("分校資料中心", "顯示已分類的原始資料與處理狀態", `<button class="secondary-button" data-action="toast">重新掃描</button><button class="primary-button" data-page-jump="upload">上傳資料</button>`)}
    <div class="summary-strip"><span class="dot"></span><strong>資料健康度 92%</strong> 已整理 41 份原始檔；目前有器材金額與錄音轉錄等待補充。</div>
    <div class="source-list">${sources.map(item => `<div class="source-row"><span class="file-type">${item[0]}</span><div><strong>${item[1]}</strong><small>${item[2]}</small></div><span>${item[3]}</span><span class="status-pill ${item[4] === "已解析" ? "good" : "warn"}">${item[4]}</span></div>`).join("")}</div>`;
  bindContentActions();
}

function renderReports() {
  const reports = [
    ["分", "單一分校分析報告", "整合基本資料、學生趨勢、校評、續約指標及改善建議。", "PDF / Excel"],
    ["區", "區域分校比較報告", "比較同區分校的重要指標、排名、改善幅度與風險。", "PDF / Excel"],
    ["輔", "輔導追蹤報告", "彙整指定期間的輔導紀錄、改善事項及完成狀態。", "PDF"],
    ["續", "續約資格檢核報告", "依公司規範檢查研討、教材、器材與檢定門檻。", "PDF / Excel"],
  ];
  content.innerHTML = `
    ${pageIntro("報表輸出中心", "依目前登入權限輸出可查看範圍內的分析資料")}
    <section class="report-grid">${reports.map(report => `<article class="report-card"><div class="report-icon">${report[0]}</div><h4>${report[1]}</h4><p>${report[2]}</p><footer><span>${report[3]}</span><button class="secondary-button" data-report="${report[1]}">建立報表 →</button></footer></article>`).join("")}</section>
    <article class="panel" style="margin-top:16px"><div class="panel-head"><div><h4>最近輸出</h4><p>展示版本產生的報表紀錄</p></div></div>
      <table class="task-table"><thead><tr><th>報表名稱</th><th>資料範圍</th><th>建立者</th><th>建立日期</th><th>格式</th></tr></thead>
      <tbody><tr><td>新北八里分校年度分析</td><td>2023–2026</td><td>${currentUser.name}</td><td>2026.07.02</td><td><span class="status-pill good">PDF</span></td></tr></tbody></table>
    </article>`;
  bindContentActions();
}

function renderRoles() {
  const roles = [
    ["總公司", "全台灣", "查看全台與各區總覽", "跨區域及跨分校比較", "查看全部輔導與續約資料", "輸出全台、區域及分校報表"],
    ["區域主管", "所屬區域", "查看區域內所有分校", "指派與轉移負責輔導員", "檢視轄區輔導進度", "輸出區域及分校報表"],
    ["輔導員", "指派分校", "查看本人負責的分校", "新增分校與上傳首次資料", "上傳負責分校新資料", "新增與追蹤輔導事項"],
    ["系統管理員", "系統設定", "建立與停用使用者", "設定角色及資料範圍", "維護帳號安全與登入狀態", "檢視系統處理紀錄"],
  ];
  const accountManagement = currentUser.roleKey === "admin" ? `
    <section class="panel account-management">
      <div class="panel-head"><div><h4>開通使用者帳號</h4><p>設定登入帳密、角色及可查看的資料範圍</p></div><span class="status-pill good">系統管理員專用</span></div>
      <form id="accountCreateForm" class="account-form">
        <label>使用者姓名<input id="newAccountName" required placeholder="例如：王小明"></label>
        <label>登入帳號<input id="newAccountId" required pattern="[A-Za-z0-9._-]+" placeholder="例如：wang01"></label>
        <label>暫時密碼<input id="newAccountPassword" required minlength="6" value="demo123" type="text"></label>
        <label>角色
          <select id="newAccountRole">
            <option value="hq">總公司</option>
            <option value="region">區域主管</option>
            <option value="counselor" selected>輔導員</option>
            <option value="admin">系統管理員</option>
          </select>
        </label>
        <label>資料範圍
          <select id="newAccountScope">
            <option value="全台灣">全台灣</option>
            <option value="北區">北區</option>
            <option value="GN26058 新北八里分校" selected>GN26058 新北八里分校</option>
            <option value="系統設定">系統設定</option>
          </select>
        </label>
        <button class="primary-button account-submit" type="submit">開通帳號</button>
      </form>
      <p class="form-helper">正式版首次登入會強制變更暫時密碼，密碼只儲存在後端加密資料庫。</p>
    </section>
    <section class="panel account-list-panel">
      <div class="panel-head"><div><h4>已開通帳號</h4><p>查看角色、資料範圍及啟用狀態</p></div><span class="account-count">${Object.keys(accounts).length} 個帳號</span></div>
      <div class="table-scroll">
        <table class="task-table account-table">
          <thead><tr><th>使用者</th><th>登入帳號</th><th>角色</th><th>資料範圍</th><th>狀態</th><th>操作</th></tr></thead>
          <tbody>${Object.entries(accounts).map(([id, user]) => `
            <tr>
              <td><span class="owner-chip"><i class="mini-avatar">${user.avatar}</i>${user.name}</span></td>
              <td><code>${id}</code></td><td>${user.role}</td><td>${user.scope}</td>
              <td><span class="status-pill ${user.active === false ? "bad" : "good"}">${user.active === false ? "已停用" : "使用中"}</span></td>
              <td><button class="account-action" type="button" data-account-toggle="${id}" ${accounts[id] === currentUser ? "disabled" : ""}>${user.active === false ? "啟用" : "停用"}</button></td>
            </tr>`).join("")}</tbody>
        </table>
      </div>
    </section>` : "";

  content.innerHTML = `
    ${pageIntro(currentUser.roleKey === "admin" ? "帳號與權限管理" : "角色與資料權限", currentUser.roleKey === "admin" ? "開通使用者帳號並設定角色及可存取的資料範圍" : "前台展示功能；正式版每次讀取與輸出都需由後端驗證")}
    ${accountManagement}
    <div class="summary-strip"><span class="dot"></span><strong>權限原則</strong> 同一套網站依帳號角色限制資料範圍；不能只靠畫面隱藏功能。</div>
    <section class="role-grid">${roles.map(role => `<article class="role-card"><span class="role-badge">資料範圍 · ${role[1]}</span><h4>${role[0]}</h4><p>${role[0] === "總公司" ? "掌握全台營運、區域差異與重大風險。" : role[0] === "區域主管" ? "管理所屬區域分校的績效與輔導進度。" : role[0] === "輔導員" ? "聚焦本人負責分校的改善與日常追蹤。" : "維護帳號、角色、分校與資料授權。"}</p><ul>${role.slice(2).map(feature => `<li>${feature}</li>`).join("")}</ul></article>`).join("")}</section>`;
  if (currentUser.roleKey === "admin") bindAccountManagement();
}

function persistCustomAccounts() {
  const custom = Object.fromEntries(Object.entries(accounts).filter(([id]) => !demoAccountIds.includes(id)));
  localStorage.setItem("advisoryCustomAccounts", JSON.stringify(custom));
}

function bindAccountManagement() {
  const roleNames = {
    hq: ["總公司權限", "全台灣", "總"],
    region: ["區域主管", "北區", "區"],
    counselor: ["分校輔導員", "GN26058 新北八里分校", "輔"],
    admin: ["系統管理", "系統設定", "管"],
  };
  const roleSelect = $("#newAccountRole");
  const scopeSelect = $("#newAccountScope");
  roleSelect.addEventListener("change", () => {
    scopeSelect.value = roleNames[roleSelect.value][1];
  });
  $("#accountCreateForm").addEventListener("submit", event => {
    event.preventDefault();
    const id = $("#newAccountId").value.trim().toLowerCase();
    if (accounts[id]) {
      showToast("此登入帳號已存在，請使用其他帳號");
      return;
    }
    const roleKey = roleSelect.value;
    const [role, defaultScope, avatar] = roleNames[roleKey];
    accounts[id] = {
      password: $("#newAccountPassword").value,
      name: $("#newAccountName").value.trim(),
      role,
      roleKey,
      avatar,
      scope: scopeSelect.value || defaultScope,
      intro: `資料範圍：${scopeSelect.value || defaultScope}`,
      active: true,
    };
    persistCustomAccounts();
    showToast(`帳號 ${id} 已開通`);
    renderRoles();
  });
  document.querySelectorAll("[data-account-toggle]").forEach(button => {
    button.addEventListener("click", () => {
      const user = accounts[button.dataset.accountToggle];
      user.active = user.active === false;
      persistCustomAccounts();
      showToast(`${button.dataset.accountToggle} 已${user.active ? "啟用" : "停用"}`);
      renderRoles();
    });
  });
}

function bindContentActions() {
  document.querySelectorAll("[data-page-jump]").forEach(button => button.addEventListener("click", () => navigate(button.dataset.pageJump)));
  document.querySelectorAll("[data-action='print']").forEach(button => button.addEventListener("click", () => window.print()));
  document.querySelectorAll("[data-action='toast']").forEach(button => button.addEventListener("click", () => showToast("展示版本：此功能將在後台模組完成後啟用")));
  document.querySelectorAll("[data-action='renewal-details']").forEach(button => button.addEventListener("click", openRenewalDetails));
  document.querySelectorAll("[data-report]").forEach(button => button.addEventListener("click", () => {
    showToast(`${button.dataset.report}已建立預覽，正式版可下載 PDF／Excel`);
    setTimeout(() => window.print(), 650);
  }));
}

function openRenewalDetails() {
  const dialog = $("#renewalDialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2800);
}

$("#loginForm").addEventListener("submit", event => {
  event.preventDefault();
  const id = $("#username").value.trim().toLowerCase();
  const password = $("#password").value;
  if (!accounts[id] || accounts[id].password !== password || accounts[id].active === false) {
    $("#loginError").textContent = "帳號或密碼錯誤，展示密碼為 demo123。";
    return;
  }
  $("#loginError").textContent = "";
  login(accounts[id]);
});

$("#togglePassword").addEventListener("click", () => {
  const input = $("#password");
  input.type = input.type === "password" ? "text" : "password";
  $("#togglePassword").textContent = input.type === "password" ? "顯示" : "隱藏";
});

function logout() {
  sessionStorage.removeItem("demoUser");
  currentUser = null;
  currentUserId = null;
  appView.classList.add("hidden");
  loginView.classList.remove("hidden");
}

$("#topLogoutButton").addEventListener("click", logout);
$("#closeRenewalDialog").addEventListener("click", () => $("#renewalDialog").close());
$("#printRenewalDetails").addEventListener("click", () => window.print());
$("#renewalDialog").addEventListener("click", event => {
  if (event.target === $("#renewalDialog")) $("#renewalDialog").close();
});

$("#mobileMenu").addEventListener("click", () => $(".sidebar").classList.toggle("open"));
$("#notificationButton").addEventListener("click", () => showToast("3 項提醒：1 項資料待補、2 項改善事項接近期限"));

async function initializeApp() {
  await syncBackendState();
  demoAccountButtons();
  const remembered = sessionStorage.getItem("demoUser");
  if (remembered && accounts[remembered]) login(accounts[remembered]);
}

initializeApp();
