/* ==========================================================================
   تطبيق إدارة محل الخياطة - النظام المالي والتشغيلي المتكامل
   حفظ آمن مزدوج: السيرفر المحلي (القرص الصلب والنسخ التلقائية) + التخزين المحلي
   ========================================================================== */

const STORAGE_KEY = "tailor-shop-data";
const CURRENCY = "ج.م";
const DEFAULT_MEASURES = [
  "طول الشخص",
  "خزنه",
  "سفرة",
  "طول كم",
  "وسع كم",
  "حجر",
  "قبه",
  "بشليق"
];
const GARMENT_TYPES = ["فستان", "بدلة", "جلابية", "قميص", "بنطلون", "عباية", "تعديل", "أخرى"];
const ORDER_STATUSES = ["تحت التنفيذ", "جاهز", "تم التسليم"];

/* ---------- معالجة وتحويل الأرقام بأعلى دقة وأمان مالي ---------- */
// تحويل الأرقام العربية المشرقية والفارسية (٠١٢٣٤٥٦٧٨٩) إلى أرقام قياسية لمنع تحولها إلى 0 أو NaN
function num(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return isFinite(v) ? Math.max(0, v) : 0;
  const s = String(v)
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[^0-9.-]/g, "");
  const n = parseFloat(s);
  return isFinite(n) ? Math.max(0, n) : 0;
}

const money = (v) => num(v).toLocaleString("ar-EG") + " " + CURRENCY;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (s) => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const today = () => new Date().toISOString().slice(0, 10);

function toast(msg) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2400);
}

/* ---------- إدارة البيانات والحفظ الآمن المزدوج والفايربيز ---------- */
let db = loadLocal();
let isServerOnline = false;
let isFirebaseOnline = false;
let firebaseStatusMessage = "";

function loadLocal() {
  try {
    const d = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (d && Array.isArray(d.customers)) {
      if (!Array.isArray(d.supplies)) d.supplies = [];
      if (!Array.isArray(d.measureTypes) || d.measureTypes.length === 0) {
        d.measureTypes = [...DEFAULT_MEASURES];
      }
      return d;
    }
  } catch {}
  return {
    customers: [],
    orders: [],
    payments: [],
    cheques: [],
    supplies: [],
    measureTypes: [...DEFAULT_MEASURES]
  };
}

// حفظ محلي فوري لتسريع الواجهة + مزامنة لحظية فورية مع الفايربيز والسيرفر
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  syncWithServer();
  if (window.TailorFirebase && typeof window.TailorFirebase.push === "function") {
    window.TailorFirebase.push(db);
  }
  syncReminders();
  render();
}

// إشعار مؤشر حالة المزامنة والفايربيز في القائمة الجانبية
function updateSyncStatusUI() {
  const foot = $("#syncStatusFoot");
  const dot = foot?.querySelector(".local-dot");
  const text = $("#syncStatusText");
  if (!foot || !dot || !text) return;

  if (isFirebaseOnline) {
    dot.style.background = "#168575";
    dot.style.boxShadow = "0 0 8px rgba(22, 133, 117, 0.8)";
    text.textContent = "متصل بالفايربيز (مزامنة فورية بين الأجهزة ⚡)";
  } else if (isServerOnline) {
    dot.style.background = "#185a9d";
    dot.style.boxShadow = "none";
    text.textContent = "متصل بالسيرفر والقرص الصلب";
  } else if (location.protocol === "file:") {
    dot.style.background = "#c15160";
    dot.style.boxShadow = "none";
    text.textContent = "ملف مباشر (شغّل تشغيل_البرنامج.bat لحماية أموالك)";
  } else {
    dot.style.background = "#b58527";
    dot.style.boxShadow = "none";
    text.textContent = firebaseStatusMessage || "يعمل محلياً بأمان (البيانات محفوظة على الجهاز)";
  }
}

// مزامنة البيانات مع السيرفر المحلي
async function syncWithServer() {
  if (location.protocol === "file:") return;
  try {
    const res = await fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(db)
    });
    if (res.ok) {
      isServerOnline = true;
      updateSyncStatusUI();
    } else {
      isServerOnline = false;
      updateSyncStatusUI();
    }
  } catch {
    isServerOnline = false;
    updateSyncStatusUI();
  }
}

// جلب أحدث البيانات من السيرفر عند فتح التطبيق
async function initServerSync() {
  // تفعيل خاصية تخزين المتصفح الدائم لعدم حذف البيانات حتى بدون سيرفر
  if (navigator.storage && navigator.storage.persist) {
    try { await navigator.storage.persist(); } catch {}
  }

  if (location.protocol === "file:") {
    updateSyncStatusUI();
    showFileProtocolNotice();
    return;
  }

  try {
    const res = await fetch("/api/data");
    if (res.ok) {
      const json = await res.json();
      if (json && json.data) {
        const serverDb = json.data;
        const localDb = db;
        const serverHasData = (serverDb.customers && serverDb.customers.length > 0) || (serverDb.orders && serverDb.orders.length > 0);
        const localHasData = (localDb.customers && localDb.customers.length > 0) || (localDb.orders && localDb.orders.length > 0);

        if (serverHasData) {
          // السيرفر يحتوي على بيانات -> نعتمدها كأساس موثوق
          db = serverDb;
          if (!Array.isArray(db.supplies)) db.supplies = [];
          if (!Array.isArray(db.measureTypes) || db.measureTypes.length === 0) {
            db.measureTypes = [...DEFAULT_MEASURES];
          }
          localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
        } else if (localHasData && !serverHasData) {
          // السيرفر فارغ والواجهة بها بيانات سابقة -> نرفعها فوراً للسيرفر للحفظ على القرص
          syncWithServer();
        }
        isServerOnline = true;
      }
    }
  } catch {
    isServerOnline = false;
  }
  updateSyncStatusUI();
  render();

  // تفعيل المزامنة اللحظية الفورية مع Firebase Firestore بين كافة الأجهزة
  if (window.TailorFirebase && typeof window.TailorFirebase.startSync === "function") {
    window.TailorFirebase.startSync(
      () => db,
      (remoteDb) => {
        // تحديث فوري استُلم من جهاز آخر في نفس اللحظة
        db = remoteDb;
        if (!Array.isArray(db.supplies)) db.supplies = [];
        if (!Array.isArray(db.measureTypes) || db.measureTypes.length === 0) {
          db.measureTypes = [...DEFAULT_MEASURES];
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
        syncWithServer(); // حفظ نسخة تلقائية على القرص الصلب فوراً
        syncReminders();
        render();
        toast("⚡ تم استلام تحديث لحظي جديد من جهاز آخر بنجاح!");
      },
      (connected, message) => {
        isFirebaseOnline = connected;
        firebaseStatusMessage = message;
        updateSyncStatusUI();
      }
    );
  }
}

// إشعار تنبيهي أنيق عند تشغيل التطبيق بالضغط المباشر على index.html
function showFileProtocolNotice() {
  if ($(".protocol-alert")) return;
  const alertBox = document.createElement("div");
  alertBox.className = "protocol-alert";
  alertBox.innerHTML = `
    <div>
      <strong>⚠️ تنبيه مهم لحماية أموال وبيانات المحل:</strong>
      أنت تفتح البرنامج حالياً كملف مباشر (file://). لتفعيل حفظ البيانات على القرص الصلب وتشغيل النسخ الاحتياطية وتثبيت البرنامج PWA، يُرجى تشغيل البرنامج بالضغط نقرتين على ملف <b>"تشغيل_البرنامج.bat"</b> في مجلد البرنامج.
    </div>
    <button type="button" onclick="this.parentElement.remove()">فهمت</button>
  `;
  const main = $("main");
  if (main) main.prepend(alertBox);
}

/* ---------- الحسابات المالية للعميل ----------
   المسدد = العرابين + الدفعات النقدية المستلمة
   المتبقي = إجمالي سعر الطلبات - المسدد نقداً */
function accountFor(customerId) {
  const orders = db.orders.filter((o) => o.customerId === customerId);
  const total = orders.reduce((s, o) => s + num(o.price), 0);
  const deposits = orders.reduce((s, o) => s + num(o.deposit), 0);
  const payments = db.payments.filter((p) => p.customerId === customerId).reduce((s, p) => s + num(p.amount), 0);
  const paid = deposits + payments;
  return { total, paid, remaining: Math.max(0, total - paid) };
}

const customerName = (id) => db.customers.find((c) => c.id === id)?.name || "عميل غير مسجل";

/* ---------- أيقونات وواجهة موحدة، مع الحفاظ الكامل على التصميم الأصلي ---------- */
const iconPaths = {
  home: '<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5"/>',
  orders: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v4H9zM9 12h6m-6 4h6"/>',
  wallet: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18m-6 4h6v4h-6z"/>',
  cheque: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h4m-4 5h10m-2-5h2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4"/>',
  arrow: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  package: '<path d="m7.5 4.27 9 5.15M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
  server: '<rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>'
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.orders}</svg>`;
const tabNames = {
  dashboard: "الرئيسية",
  customers: "العملاء والمقاسات",
  orders: "الطلبات",
  supplies: "البضاعة والمستلزمات",
  accounts: "الحسابات والأرباح"
};
const tabIcons = {
  dashboard: "home",
  customers: "users",
  orders: "orders",
  supplies: "package",
  accounts: "wallet"
};

function switchTab(tab) {
  document.querySelectorAll("button[data-tab]").forEach((b) => {
    const active = b.dataset.tab === tab;
    b.classList.toggle("active", active);
    b.setAttribute("aria-current", active ? "page" : "false");
  });
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + tab));
  const topTitle = $(".topbar h1");
  if (topTitle) topTitle.textContent = "محل الخياطة / " + tabNames[tab];
  window.scrollTo(0, 0);
}

function setupInterface() {
  const nav = $(".toptabs");
  if (!nav) return;
  nav.setAttribute("aria-label", "أقسام المحل");

  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";
  sidebar.innerHTML = `
    <div class="brand">
      <img src="icon-192.png" alt="شعار محل الخياطة">
      <div><strong>محل الخياطة</strong><small>العملاء · الطلبات · الحسابات</small></div>
    </div>
    <div class="nav-label">إدارة المحل</div>
  `;
  sidebar.append(nav);
  sidebar.insertAdjacentHTML("beforeend", `
    <div class="sidebar-foot" id="syncStatusFoot">
      <span class="local-dot"></span>
      <span id="syncStatusText">البيانات محفوظة على هذا الجهاز</span>
    </div>
  `);
  document.body.prepend(sidebar);

  const tabbar = $(".tabbar");
  if (tabbar) tabbar.remove();

  nav.querySelectorAll("button").forEach((b) => {
    const tab = b.dataset.tab;
    b.innerHTML = icon(tabIcons[tab]) + `<span>${tabNames[tab]}</span>` + (tab === "customers" || tab === "orders" || tab === "supplies" ? `<span class="nav-count" id="count-${tab}">0</span>` : "");
    b.onclick = () => switchTab(tab);
  });

  const notify = $("#notifyBtn");
  if (notify) notify.innerHTML = icon("bell") + '<span>تفعيل التنبيهات</span>';

  const headerActions = document.createElement("div");
  headerActions.className = "header-actions";
  if (notify) headerActions.append(notify);
  headerActions.insertAdjacentHTML("beforeend", '<span class="avatar" aria-label="محل الخياطة">خ</span>');
  $(".topbar")?.append(headerActions);

  const date = new Date().toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  $(".topbar h1")?.insertAdjacentHTML("afterend", `<span class="header-date">${date}</span>`);

  const headerInfo = document.createElement("div");
  const h1 = $(".topbar h1");
  const hDate = $(".header-date");
  if (h1 && hDate) {
    headerInfo.append(h1, hDate);
    $(".topbar")?.prepend(headerInfo);
  }

  const descriptions = {
    dashboard: "نظرة على حسابات المحل ومواعيد التسليم",
    customers: "بيانات العملاء والأطوال والمقاسات",
    orders: "طلبات التفصيل ومواعيد التسليم",
    supplies: "شراء وتفاصيل الأقمشة والخامات والمستلزمات",
    accounts: "الأرباح، المصروفات، وأرصدة العملاء والديون"
  };

  Object.entries(tabNames).forEach(([tab, name]) => {
    const tabEl = $("#tab-" + tab);
    if (tabEl) {
      tabEl.insertAdjacentHTML(
        "afterbegin",
        `<div class="page-heading">
          <div>
            <h2>${tab === "dashboard" ? "لوحة المتابعة" : name}</h2>
            <p>${descriptions[tab]}</p>
          </div>
          ${tab === "dashboard" ? `
            <div class="heading-actions">
              <button class="btn ghost" data-action="customer">${icon("users")}عميل جديد</button>
              <button class="btn" data-action="order">${icon("plus")}طلب جديد</button>
            </div>` : ""}
        </div>`
      );
    }
  });

  const dash = $("#tab-dashboard");
  if (dash) {
    const headings = dash.querySelectorAll(":scope > h2");
    const upcomingArea = document.createElement("div");
    upcomingArea.innerHTML = `<div class="section-heading"><h2>أقرب مواعيد التسليم</h2><button class="btn small ghost" data-open-tab="orders">كل الطلبات ${icon("arrow")}</button></div>`;
    const upcoming = $("#upcoming");
    if (upcoming) upcomingArea.append(upcoming);

    const side = document.createElement("aside");
    side.className = "dashboard-side";
    side.innerHTML = `
      <h2>إجراءات سريعة</h2>
      <button class="quick-action" data-action="customer">${icon("users")}<span>إضافة عميل</span>${icon("plus")}</button>
      <button class="quick-action" data-action="order">${icon("orders")}<span>إضافة طلب</span>${icon("plus")}</button>
      <button class="quick-action" data-action="supply">${icon("package")}<span>شراء بضاعة</span>${icon("plus")}</button>
      <button class="quick-action" data-action="payment">${icon("wallet")}<span>تسجيل دفعة</span>${icon("plus")}</button>
      <div class="backup-area">
        <h2>النسخ الاحتياطي والأمان</h2>
        <button class="btn small ghost" id="serverBackupsBtn" style="width:100%; margin-bottom:10px;">${icon("server")} استرجاع نسخة احتياطية</button>
      </div>
    `;

    const exportBtn = $("#exportBtn");
    if (exportBtn && exportBtn.parentElement) {
      side.querySelector(".backup-area").append(exportBtn.parentElement);
    }

    headings.forEach((h) => h.remove());
    const layout = document.createElement("div");
    layout.className = "dashboard-layout";
    layout.append(upcomingArea, side);
    dash.append(layout);
  }

  [
    ["addCustomerBtn", "عميل جديد", "plus"],
    ["addOrderBtn", "طلب جديد", "plus"],
    ["addPaymentBtn", "تسجيل دفعة نقدية", "plus"],
    ["exportBtn", "تصدير نسخة JSON", "download"]
  ].forEach(([id, label, symbol]) => {
    const el = $("#" + id);
    if (el) el.innerHTML = icon(symbol) + label;
  });

  const importFile = $("#importFile");
  if (importFile && importFile.parentElement) {
    const importLabel = importFile.parentElement;
    Array.from(importLabel.childNodes).filter((n) => n.nodeType === 3).forEach((n) => n.remove());
    importLabel.insertAdjacentHTML("afterbegin", icon("upload") + "استيراد نسخة");
  }

  $("#customerSearch")?.setAttribute("aria-label", "البحث عن عميل");
  $("#orderFilter")?.setAttribute("aria-label", "تصفية الطلبات حسب الحالة");
  $("#modal")?.setAttribute("aria-labelledby", "modalTitle");

  // تفعيل زر النسخ الاحتياطية للسيرفر
  const serverBackupsBtn = $("#serverBackupsBtn");
  if (serverBackupsBtn) {
    serverBackupsBtn.onclick = openServerBackupsModal;
  }

  switchTab("dashboard");
}

setupInterface();

const emptyState = (symbol, title, action, label) =>
  `<div class="empty">${icon(symbol)}<strong>${title}</strong>${action ? `<button class="btn ghost" data-action="${action}">${icon("plus")}${label}</button>` : ""}</div>`;

document.addEventListener("click", (e) => {
  const button = e.target.closest("button");
  if (!button) return;
  if (button.dataset.openTab) switchTab(button.dataset.openTab);
  const actions = { customer: "addCustomerBtn", order: "addOrderBtn", payment: "addPaymentBtn", supply: "addSupplyBtn" };
  const target = actions[button.dataset.action];
  if (target) $("#" + target)?.click();
});

/* ---------- النافذة المنبثقة العامة ---------- */
let onSave = null;
function openModal(title, html, saveFn) {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = html;
  onSave = saveFn;
  $("#modal").showModal();
}
$("#modalCancel").onclick = () => $("#modal").close();
$("#modalForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  if (onSave && onSave(data) !== false) $("#modal").close();
});

const field = (label, name, value = "", type = "text", extra = "") =>
  `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;

const selectField = (label, name, options, value) =>
  `<label class="field"><span>${label}</span><select name="${name}" required>${options
    .map((o) => {
      const [v, t] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(t)}</option>`;
    })
    .join("")}</select></label>`;

const customerOptions = () => db.customers.map((c) => [c.id, `${c.name} - ${c.phone}`]);

function needCustomers() {
  if (!db.customers.length) {
    toast("يجب إضافة عميل أولاً");
    return false;
  }
  return true;
}

/* =================== إدارة المقاسات والأطوال =================== */
function getMeasureTypes() {
  if (!Array.isArray(db.measureTypes) || db.measureTypes.length === 0) {
    db.measureTypes = [...DEFAULT_MEASURES];
  }
  return db.measureTypes;
}

function manageMeasureTypesModal() {
  const currentTypes = getMeasureTypes();
  const bodyHtml = `
    <div style="margin-bottom:15px; font-size:13px; color:var(--muted); line-height:1.7;">
      يمكنك هنا تعديل أسماء المقاسات والأطوال في المحل (مثل: طول الشخص، خزنه، سفرة، طول كم، وسع كم، حجر، قبه، بشليق)، أو مسح أي مقاس لا تريده، أو إضافة مقاسات جديدة:
    </div>
    <div style="display:flex; gap:8px; margin-bottom:16px;">
      <input type="text" id="newMeasureInput" placeholder="اكتب اسم المقاس الجديد (مثلاً: ركبة، فتحة رقبة...)" style="flex:1;" />
      <button type="button" class="btn small" id="addMeasureTypeBtn">+ إضافة مقاس</button>
    </div>
    <div style="font-weight:700; font-size:14px; margin-bottom:10px;">المقاسات الحالية في المحل (${currentTypes.length}):</div>
    <div id="measureTypesList" style="display:flex; flex-direction:column; gap:8px; max-height:280px; overflow-y:auto; padding:4px;">
      ${currentTypes
        .map(
          (name) => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg); padding:10px 14px; border-radius:6px; border:1px solid var(--border);">
          <span style="font-weight:700; font-size:14px;">📏 ${esc(name)}</span>
          <div style="display:flex; gap:8px;">
            <button type="button" class="btn small ghost" style="padding:4px 10px; min-height:30px; font-size:12px;" data-rename-measure="${esc(name)}">✏️ تعديل الاسم</button>
            <button type="button" class="btn small danger" style="padding:4px 10px; min-height:30px; font-size:12px;" data-del-measure="${esc(name)}">🗑️ مسح</button>
          </div>
        </div>
      `
        )
        .join("")}
    </div>
    <div style="margin-top:16px; border-top:1px solid var(--border); padding-top:14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
      <button type="button" class="btn small ghost" id="resetMeasuresBtn">🔄 استعادة المقاسات الأساسية</button>
      <span style="font-size:11px; color:var(--muted);">التغييرات تُحفظ فوراً في النظام</span>
    </div>
  `;

  openModal("⚙️ إدارة وتعديل أسماء المقاسات والأطوال", bodyHtml, () => {}, true);

  const addBtn = $("#addMeasureTypeBtn");
  const input = $("#newMeasureInput");
  if (addBtn && input) {
    addBtn.onclick = () => {
      const val = input.value.trim();
      if (!val) return;
      if (db.measureTypes.includes(val)) {
        toast("هذا المقاس موجود بالفعل ⚠️");
        return;
      }
      db.measureTypes.push(val);
      save();
      toast("تمت إضافة المقاس بنجاح ✅");
      manageMeasureTypesModal();
    };
    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addBtn.click();
      }
    };
  }

  const listEl = $("#measureTypesList");
  if (listEl) {
    listEl.onclick = (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.dataset.renameMeasure) {
        const oldName = btn.dataset.renameMeasure;
        const newName = prompt(`تعديل اسم المقاس "${oldName}" إلى:`, oldName);
        if (newName && newName.trim() && newName.trim() !== oldName) {
          const idx = db.measureTypes.indexOf(oldName);
          if (idx !== -1) {
            db.measureTypes[idx] = newName.trim();
            db.customers.forEach((c) => {
              if (c.measurements && c.measurements[oldName] !== undefined) {
                c.measurements[newName.trim()] = c.measurements[oldName];
                delete c.measurements[oldName];
              }
            });
            save();
            toast("تم تعديل اسم المقاس بنجاح ✅");
            manageMeasureTypesModal();
          }
        }
      }
      if (btn.dataset.delMeasure) {
        const toDel = btn.dataset.delMeasure;
        if (confirm(`هل أنت متأكد من مسح المقاس "${toDel}" من قائمة مقاسات المحل؟`)) {
          db.measureTypes = db.measureTypes.filter((m) => m !== toDel);
          save();
          toast("تم مسح المقاس ✅");
          manageMeasureTypesModal();
        }
      }
    };
  }

  const resetBtn = $("#resetMeasuresBtn");
  if (resetBtn) {
    resetBtn.onclick = () => {
      if (confirm("هل تريد استعادة المقاسات الأساسية (طول الشخص، خزنه، سفرة، طول كم، وسع كم، حجر، قبه، بشليق)؟")) {
        db.measureTypes = [...DEFAULT_MEASURES];
        save();
        toast("تمت استعادة المقاسات الأساسية ✅");
        manageMeasureTypesModal();
      }
    };
  }
}

/* =================== إدارة العملاء =================== */
function customerForm(c = {}) {
  const m = c.measurements || {};
  const measureTypes = getMeasureTypes();
  const keys = [...new Set([...measureTypes, ...Object.keys(m)])];

  openModal(
    c.id ? "تعديل بيانات العميل والمقاسات" : "إضافة عميل جديد ومقاساته",
    field("الاسم الكامل للعميل", "name", c.name, "text", "required placeholder='اسم العميل'") +
      field("رقم الهاتف", "phone", c.phone, "tel", "required placeholder='01xxxxxxxxx'") +
      field("العنوان (اختياري)", "address", c.address, "text", "placeholder='العنوان أو المنطقة'") +
      `<div style="display:flex; justify-content:space-between; align-items:center; margin-top:20px; margin-bottom:8px;">
        <h3 style="margin:0;">المقاسات والأطوال (بالسنتيمتر)</h3>
        <button type="button" class="btn small ghost" id="formManageMeasuresBtn" style="font-size:11px; padding:4px 8px; min-height:28px;">⚙️ تعديل / إضافة أسماء المقاسات</button>
      </div>` +
      `<div class="grid2">` +
      keys.map((k) => field(k, "m_" + k, m[k], "text", 'inputmode="decimal" placeholder="سم"')).join("") +
      `</div>` +
      field("إضافة مقاس خاص بهذا العميل فقط", "newMeasureName", "", "text", 'placeholder="مثلاً: وسع صدر خاص، كتف مائل..."') +
      field("قيمة المقاس الخاص", "newMeasureValue", "", "text", 'inputmode="decimal" placeholder="سم"') +
      `<label class="field"><span>ملاحظات خاصة بجسم أو ذوق العميل</span><textarea name="notes" placeholder="أي تفاصيل خاصة بالجسم أو طريقة الخياطة...">${esc(c.notes)}</textarea></label>`,
    (d) => {
      const measurements = {};
      for (const k in d) {
        if (k.startsWith("m_") && d[k].trim()) measurements[k.slice(2)] = d[k].trim();
      }
      if (d.newMeasureName && d.newMeasureName.trim()) {
        const customName = d.newMeasureName.trim();
        measurements[customName] = (d.newMeasureValue || "").trim();
        if (!db.measureTypes.includes(customName)) {
          db.measureTypes.push(customName);
        }
      }
      const data = {
        name: d.name.trim(),
        phone: d.phone.trim(),
        address: (d.address || "").trim(),
        notes: (d.notes || "").trim(),
        measurements
      };
      if (c.id) Object.assign(c, data);
      else db.customers.push({ id: uid(), createdAt: today(), ...data });
      save();
      toast("تم حفظ بيانات العميل ومقاساته بنجاح ✅");
    }
  );

  const formManageBtn = $("#formManageMeasuresBtn");
  if (formManageBtn) {
    formManageBtn.onclick = () => {
      manageMeasureTypesModal();
    };
  }
}

$("#addCustomerBtn").onclick = () => customerForm();
const manageMeasuresPageBtn = $("#manageMeasuresBtn");
if (manageMeasuresPageBtn) {
  manageMeasuresPageBtn.onclick = () => manageMeasureTypesModal();
}
$("#customerSearch").oninput = renderCustomers;

function renderCustomers() {
  const q = ($("#customerSearch")?.value || "").trim().toLowerCase();
  const list = db.customers.filter((c) => !q || c.name.toLowerCase().includes(q) || c.phone.includes(q));
  const listEl = $("#customerList");
  if (!listEl) return;

  listEl.innerHTML = list.length
    ? list
        .map((c) => {
          const a = accountFor(c.id);
          const ms = Object.entries(c.measurements || {});
          const activeOrders = db.orders.filter((o) => o.customerId === c.id && o.status !== "تم التسليم");
          const allOrders = db.orders.filter((o) => o.customerId === c.id);

          return `<div class="card customer-card">
            <div class="head">
              <div class="title" style="font-size:17px; display:flex; align-items:center; gap:8px;">
                <span>👤 ${esc(c.name)}</span>
              </div>
              ${
                a.remaining > 0
                  ? `<span class="badge danger" style="font-size:13px; font-weight:700; padding:6px 12px;">🔴 عليه متبقي: ${money(a.remaining)}</span>`
                  : `<span class="badge ok" style="font-size:13px; font-weight:700; padding:6px 12px;">🟢 خالص الحساب (0 ج.م)</span>`
              }
            </div>

            <div class="meta" style="margin-top:6px; font-size:13px;">
              📞 هاتف: <a href="tel:${esc(c.phone)}" style="font-weight:700;">${esc(c.phone)}</a>
              ${c.address ? " · 📍 " + esc(c.address) : ""}
              · 💵 إجمالي طلباته: <b>${money(a.total)}</b> (المسدد نقداً: <b>${money(a.paid)}</b>)
            </div>

            <!-- ملخص الطلبات التي طلبها العميل إذا كان طالب حاجة -->
            <div style="margin-top:12px; background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:10px 14px;">
              ${
                activeOrders.length > 0
                  ? `<div style="font-weight:700; color:var(--text); margin-bottom:6px; font-size:13px;">
                       📋 طالب حالياً (${activeOrders.length} طلب قيد التنفيذ):
                     </div>
                     <div style="display:flex; flex-direction:column; gap:6px;">
                       ${activeOrders
                         .map(
                           (o) => `
                         <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; font-size:13px; border-bottom:1px dashed var(--border); padding-bottom:4px;">
                           <span>✂️ <b>${esc(o.type || "تفصيل")}</b> ${o.desc ? `· ${esc(o.desc)}` : ""}</span>
                           <span style="display:inline-flex; gap:8px; align-items:center;">
                             <span class="badge ${o.status === "جاهز" ? "ok" : "warn"}">${esc(o.status)}</span>
                             <span style="font-weight:700;">${money(o.price)}</span>
                             <span style="color:var(--muted); font-size:11px;">(عربون: ${money(o.deposit)})</span>
                             <span style="color:var(--muted); font-size:11px;">📅 استلام: ${esc(o.dueDate)}</span>
                           </span>
                         </div>
                       `
                         )
                         .join("")}
                     </div>`
                  : `<div style="color:var(--muted); font-size:12px;">
                       ${allOrders.length > 0 ? "✅ جميع طلباته السابقة تم تسليمها ومحاسبتها." : "لا توجد طلبات مسجلة لهذا العميل حالياً."}
                     </div>`
              }
            </div>

            <!-- المقاسات -->
            ${
              ms.length
                ? `<div style="margin-top:12px;">
                     <div style="font-size:12px; font-weight:700; color:var(--muted); margin-bottom:4px;">📏 المقاسات المسجلة للعميل:</div>
                     <div class="measure-grid">${ms.map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(v)} سم</div>`).join("")}</div>
                   </div>`
                : ""
            }

            ${c.notes ? `<div class="meta" style="margin-top:8px;">📝 ملاحظات: ${esc(c.notes)}</div>` : ""}

            <div class="actions">
              <button class="btn small" data-order-for="${c.id}">+ طلب جديد للعميل</button>
              <button class="btn small ghost" data-payment-for="${c.id}">💵 تسجيل دفعة</button>
              <button class="btn small ghost" data-edit-customer="${c.id}">✏️ تعديل ومقاسات</button>
              <button class="btn small danger" data-del-customer="${c.id}">حذف</button>
            </div>
          </div>`;
        })
        .join("")
    : emptyState("users", q ? `لا يوجد عملاء يطابقون البحث: "${q}"` : "لا يوجد عملاء مسجلين حتى الآن", q ? null : "customer", "إضافة أول عميل ومقاساته");
}

/* =================== إدارة الطلبات =================== */
function orderForm(o = {}, presetCustomer) {
  if (!needCustomers()) return;
  openModal(
    o.id ? "تعديل تفاصيل الطلب" : "تسجيل طلب تفصيل جديد",
    selectField("العميل", "customerId", customerOptions(), o.customerId || presetCustomer) +
      selectField("نوع القطعة", "type", GARMENT_TYPES, o.type) +
      `<label class="field"><span>الوصف والمواصفات المطلوبة</span><textarea name="desc">${esc(o.desc)}</textarea></label>` +
      field("تاريخ موعد التسليم", "dueDate", o.dueDate || today(), "date", "required") +
      `<div class="grid2">` +
      field("السعر الإجمالي (ج.م)", "price", o.price, "text", 'inputmode="decimal" required') +
      field("العربون المستلم (ج.م)", "deposit", o.deposit ?? 0, "text", 'inputmode="decimal"') +
      `</div>` +
      selectField("حالة الطلب", "status", ORDER_STATUSES, o.status || "تحت التنفيذ"),
    (d) => {
      const priceVal = num(d.price);
      const depositVal = num(d.deposit);
      if (priceVal <= 0) {
        toast("يرجى إدخال سعر صحيح للطلب ⚠️");
        return false;
      }
      const data = {
        customerId: d.customerId,
        type: d.type,
        desc: (d.desc || "").trim(),
        dueDate: d.dueDate,
        price: priceVal,
        deposit: depositVal,
        status: d.status
      };
      if (o.id) Object.assign(o, data);
      else db.orders.push({ id: uid(), createdAt: today(), ...data });
      save();
      toast("تم حفظ الطلب بنجاح ✅");
    }
  );
}

$("#addOrderBtn").onclick = () => orderForm();
$("#orderFilter").onchange = renderOrders;

const statusBadge = (s) => `<span class="badge ${s === "جاهز" ? "ok" : s === "تم التسليم" ? "" : "warn"}">${s}</span>`;

function orderCard(o) {
  const late = o.status !== "تم التسليم" && o.dueDate < today();
  return `<div class="card">
    <div class="head">
      <div class="title">${esc(o.type)} - ${esc(customerName(o.customerId))}</div>
      ${statusBadge(o.status)}
    </div>
    <div class="meta">📅 التسليم: ${esc(o.dueDate)} ${late ? '<span class="badge danger">متأخر</span>' : ""}</div>
    <div class="meta">💵 السعر: ${money(o.price)} · العربون: ${money(o.deposit)}</div>
    ${o.desc ? `<div class="meta">📝 ${esc(o.desc)}</div>` : ""}
    <div class="actions">
      ${ORDER_STATUSES.filter((s) => s !== o.status).map((s) => `<button class="btn small ghost" data-status="${o.id}|${s}">${s}</button>`).join("")}
      <button class="btn small ghost" data-edit-order="${o.id}">✏️ تعديل</button>
      <button class="btn small danger" data-del-order="${o.id}">حذف</button>
    </div>
  </div>`;
}

function renderOrders() {
  const f = $("#orderFilter").value;
  const list = db.orders.filter((o) => f === "all" || o.status === f).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  $("#orderList").innerHTML = list.length
    ? list.map(orderCard).join("")
    : emptyState("orders", f === "all" ? "لا توجد طلبات حتى الآن" : "لا توجد طلبات بهذه الحالة", "order", "إضافة طلب");
}

/* =================== إدارة البضاعة والمستلزمات (الأقمشة، الخيوط، الزراير) =================== */
const SUPPLY_CATEGORIES = [
  "أقمشة",
  "خيوط",
  "أزرار وإكسسوارات",
  "بطانات وفازلين",
  "أدوات ومستلزمات ورشة",
  "أخرى"
];

const SUPPLY_UNITS = [
  "متر",
  "دستة",
  "بكرة",
  "قطعة",
  "طاقة",
  "لفة",
  "كجم",
  "أخرى"
];

function supplyForm(s = {}) {
  openModal(
    s.id ? "تعديل تفاصيل البضاعة المشتراة" : "تسجيل شراء بضاعة / خامات ومستلزمات جديدة",
    field("اسم البضاعة أو نوع القماش", "name", s.name, "text", "required placeholder='مثلاً: قماش صوف كشمير، خيط حرير، زراير صدفي...'") +
      selectField("نوع / تصنيف البضاعة", "category", SUPPLY_CATEGORIES, s.category || "أقمشة") +
      `<div class="grid2">` +
      field("الكمية المشتراة", "quantity", s.quantity ?? 1, "text", 'inputmode="decimal" id="supplyQtyInput" required') +
      selectField("وحدة القياس", "unit", SUPPLY_UNITS, s.unit || "متر") +
      `</div>` +
      `<div class="grid2">` +
      field("سعر الوحدة الواحد (ج.م)", "unitPrice", s.unitPrice, "text", 'inputmode="decimal" id="supplyUnitPriceInput" placeholder="سعر المتر أو الدستة"') +
      field("السعر الإجمالي للبضاعة ككل (ج.م)", "totalPrice", s.totalPrice, "text", 'inputmode="decimal" id="supplyTotalPriceInput" required placeholder="إجمالي الفاتورة"') +
      `</div>` +
      field("اسم التاجر / المحل المشتري منه (اختياري)", "supplier", s.supplier, "text", "placeholder='اسم محل الأقمشة أو التاجر'") +
      field("تاريخ الشراء", "date", s.date || today(), "date", "required") +
      `<label class="field"><span>ملاحظات وتفاصيل الخامة</span><textarea name="notes" placeholder="اكتب تفاصيل الخامة: اللون، العرض، الجودة...">${esc(s.notes)}</textarea></label>`,
    (d) => {
      const nameVal = d.name.trim();
      const qtyVal = num(d.quantity) || 1;
      const unitPriceVal = num(d.unitPrice);
      let totalVal = num(d.totalPrice);
      if (totalVal <= 0 && unitPriceVal > 0) {
        totalVal = qtyVal * unitPriceVal;
      }
      if (totalVal <= 0) {
        toast("يرجى إدخال سعر صحيح للبضاعة ⚠️");
        return false;
      }

      const data = {
        name: nameVal,
        category: d.category || "أقمشة",
        quantity: qtyVal,
        unit: d.unit || "متر",
        unitPrice: unitPriceVal,
        totalPrice: totalVal,
        supplier: (d.supplier || "").trim(),
        date: d.date || today(),
        notes: (d.notes || "").trim()
      };

      if (!Array.isArray(db.supplies)) db.supplies = [];
      if (s.id) Object.assign(s, data);
      else db.supplies.push({ id: uid(), createdAt: today(), ...data });

      save();
      toast("تم حفظ تفاصيل البضاعة والمشتريات بنجاح ✅");
    }
  );

  const qtyInput = $("#supplyQtyInput");
  const unitPriceInput = $("#supplyUnitPriceInput");
  const totalInput = $("#supplyTotalPriceInput");
  if (qtyInput && unitPriceInput && totalInput) {
    const calc = () => {
      const q = num(qtyInput.value);
      const u = num(unitPriceInput.value);
      if (q > 0 && u > 0) {
        totalInput.value = (q * u).toFixed(2).replace(/\.00$/, "");
      }
    };
    qtyInput.oninput = calc;
    unitPriceInput.oninput = calc;
  }
}

const addSupplyPageBtn = $("#addSupplyBtn");
if (addSupplyPageBtn) addSupplyPageBtn.onclick = () => supplyForm();
const supplySearchEl = $("#supplySearch");
if (supplySearchEl) supplySearchEl.oninput = renderSupplies;
const supplyCatFilterEl = $("#supplyCategoryFilter");
if (supplyCatFilterEl) supplyCatFilterEl.onchange = renderSupplies;

function renderSupplies() {
  if (!Array.isArray(db.supplies)) db.supplies = [];
  const q = ($("#supplySearch")?.value || "").trim().toLowerCase();
  const catFilter = $("#supplyCategoryFilter")?.value || "all";

  const list = db.supplies
    .filter((s) => {
      if (catFilter !== "all" && s.category !== catFilter) return false;
      if (
        q &&
        !s.name.toLowerCase().includes(q) &&
        !(s.supplier || "").toLowerCase().includes(q) &&
        !(s.notes || "").toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const totalSpent = db.supplies.reduce((acc, s) => acc + num(s.totalPrice), 0);
  const totalCount = db.supplies.length;

  const statsEl = $("#supplyStats");
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat">
        <div class="stat-top">
          <div class="label">إجمالي مشتريات البضاعة والخامات</div>
          <span class="stat-icon">${icon("package")}</span>
        </div>
        <div class="value" style="color:var(--danger);">${money(totalSpent)}</div>
        <div class="stat-note">المصروف على الأقمشة والخيوط والزراير والمستلزمات</div>
      </div>
      <div class="stat">
        <div class="stat-top">
          <div class="label">عدد فواتير ومشتريات البضاعة</div>
          <span class="stat-icon">${icon("orders")}</span>
        </div>
        <div class="value">${totalCount.toLocaleString("ar-EG")}</div>
        <div class="stat-note">عمليات شراء مسجلة</div>
      </div>
    `;
  }

  const listEl = $("#supplyList");
  if (!listEl) return;

  listEl.innerHTML = list.length
    ? list
        .map(
          (s) => `
          <div class="card">
            <div class="head">
              <div class="title" style="font-size:16px;">
                <span>📦 ${esc(s.name)}</span>
                <span class="badge" style="margin-inline-start:8px; font-size:11px;">${esc(s.category)}</span>
              </div>
              <span class="badge danger" style="font-size:14px; font-weight:700;">${money(s.totalPrice)}</span>
            </div>
            <div class="meta" style="margin-top:8px; font-size:13px;">
              📏 <b>الكمية:</b> ${esc(s.quantity)} ${esc(s.unit)}
              ${s.unitPrice > 0 ? `· 💰 <b>سعر الـ ${esc(s.unit)}:</b> ${money(s.unitPrice)}` : ""}
              ${s.supplier ? `· 📍 <b>المورد / التاجر:</b> ${esc(s.supplier)}` : ""}
              · 📅 <b>تاريخ الشراء:</b> ${esc(s.date)}
            </div>
            ${s.notes ? `<div class="meta" style="margin-top:6px;">📝 <b>التفاصيل:</b> ${esc(s.notes)}</div>` : ""}
            <div class="actions">
              <button class="btn small ghost" data-edit-supply="${s.id}">✏️ تعديل الفاتورة</button>
              <button class="btn small danger" data-del-supply="${s.id}">حذف</button>
            </div>
          </div>
        `
        )
        .join("")
    : emptyState("package", q ? "لا توجد نتائج بضاعة تطابق بحثك" : "لم يتم تسجيل أي مشتريات بضاعة حتى الآن", "supply", "تسجيل أول عملية شراء بضاعة");
}

/* =================== الحسابات والمالية والشروحات المبسطة =================== */
function paymentForm(preset = {}, presetCustomerId) {
  if (!needCustomers()) return;
  const customerId = preset.customerId || presetCustomerId;
  const customer = customerId ? db.customers.find((c) => c.id === customerId) : null;
  const account = customerId ? accountFor(customerId) : null;
  const hint = account && account.remaining > 0 ? ` (المتبقي عليه: ${money(account.remaining)})` : "";

  openModal(
    "تسجيل دفعة نقدية جديدة" + (customer ? ` - ${customer.name}` : ""),
    selectField("العميل", "customerId", customerOptions(), customerId) +
      field("المبلغ المستلم نقداً (ج.م)" + hint, "amount", preset.amount || (account && account.remaining > 0 ? account.remaining : ""), "text", 'inputmode="decimal" required autofocus') +
      field("تاريخ استلام المبلغ", "date", preset.date || today(), "date", "required") +
      field("ملاحظة أو بيان الدفعة", "note", preset.note || "دفعة تحت الحساب"),
    (d) => {
      const amountVal = num(d.amount);
      if (amountVal <= 0) {
        toast("يرجى إدخال مبلغ دفع صحيح ⚠️");
        return false;
      }
      db.payments.push({
        id: uid(),
        customerId: d.customerId,
        amount: amountVal,
        date: d.date,
        note: (d.note || "").trim()
      });
      save();
      toast("تم تسجيل الدفعة النقدية بنجاح في الخزينة ✅");
    }
  );
}

$("#addPaymentBtn").onclick = () => paymentForm();

function toggleAccountsGuide() {
  const guide = $("#accountsGuide");
  if (!guide) return;
  guide.style.display = guide.style.display === "none" ? "block" : "none";
  if (guide.style.display === "block") {
    guide.scrollIntoView({ behavior: "smooth" });
  }
}

const explainBtn = $("#explainAccountsBtn");
if (explainBtn) explainBtn.onclick = toggleAccountsGuide;

function renderAccounts() {
  const deposits = db.orders.reduce((s, o) => s + num(o.deposit), 0);
  const payments = db.payments.reduce((s, p) => s + num(p.amount), 0);
  const totalCashIn = deposits + payments; // الداخل في الخزينة نقداً

  if (!Array.isArray(db.supplies)) db.supplies = [];
  const totalSupplies = db.supplies.reduce((s, x) => s + num(x.totalPrice), 0); // المصروف في البضاعة والخامات
  const netProfit = totalCashIn - totalSupplies; // صافي الربح الفعلي بعد خصم مشتريات البضاعة

  const debts = db.customers
    .map((c) => ({ c, a: accountFor(c.id) }))
    .filter((x) => x.a.remaining > 0)
    .sort((x, y) => y.a.remaining - x.a.remaining);

  const totalRemaining = debts.reduce((s, x) => s + x.a.remaining, 0); // الباقي على الزباين

  const summaryEl = $("#accountsSummary");
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="stat">
        <div class="stat-top">
          <div class="label">📥 المحصّل نقداً (الخزينة)</div>
          <span class="stat-icon">${icon("wallet")}</span>
        </div>
        <div class="value" style="color:var(--primary); font-size:24px;">${money(totalCashIn)}</div>
        <div class="stat-note">عربين الطلبات + الدفعات المستلمة كاش</div>
      </div>
      <div class="stat">
        <div class="stat-top">
          <div class="label">📦 مشتريات البضاعة والخامات</div>
          <span class="stat-icon">${icon("package")}</span>
        </div>
        <div class="value" style="color:var(--danger); font-size:24px;">${money(totalSupplies)}</div>
        <div class="stat-note">قماش، خيوط، زراير، ومستلزمات ورشة</div>
      </div>
      <div class="stat">
        <div class="stat-top">
          <div class="label">💵 صافي ربح المحل الفعلي</div>
          <span class="stat-icon">${icon("check")}</span>
        </div>
        <div class="value" style="color:${netProfit >= 0 ? "var(--primary)" : "var(--danger)"}; font-size:24px;">${money(netProfit)}</div>
        <div class="stat-note">(المحصّل نقداً - مشتريات البضاعة)</div>
      </div>
      <div class="stat">
        <div class="stat-top">
          <div class="label">⏳ باقي على الزباين (ديون ليك)</div>
          <span class="stat-icon">${icon("clock")}</span>
        </div>
        <div class="value" style="color:var(--warn); font-size:24px;">${money(totalRemaining)}</div>
        <div class="stat-note">فلوس متبقية على العملاء لم يتم تحصيلها</div>
      </div>
    `;
  }

  // قائمة ديون العملاء
  const debtEl = $("#debtList");
  if (debtEl) {
    debtEl.innerHTML = debts.length
      ? debts
          .map(
            ({ c, a }) => `
            <div class="card">
              <div class="head">
                <div class="title" style="font-size:16px;">👤 ${esc(c.name)}</div>
                <span class="badge danger" style="font-size:13px; font-weight:700; padding:6px 12px;">🔴 متبقي عليه: ${money(a.remaining)}</span>
              </div>
              <div class="meta" style="margin-top:6px; font-size:13px;">
                📞 هاتف: <a href="tel:${esc(c.phone)}" style="font-weight:700;">${esc(c.phone)}</a>
                · إجمالي حسابه: <b>${money(a.total)}</b>
                · المسدد نقداً: <b>${money(a.paid)}</b>
              </div>
              <div class="actions">
                <button class="btn small" data-payment-for="${c.id}">💵 تحصيل دفعة الآن</button>
                <button class="btn small ghost" data-edit-customer="${c.id}">✏️ كارت العميل والمقاسات</button>
              </div>
            </div>
          `
          )
          .join("")
      : emptyState("check", "لا توجد أي مبالغ متبقية على العملاء (الحسابات مسددة بالكامل والحمد لله)");
  }
}

/* =================== لوحة التحكم الرئيسية =================== */
function renderDashboard() {
  const deposits = db.orders.reduce((s, o) => s + num(o.deposit), 0);
  const payments = db.payments.reduce((s, p) => s + num(p.amount), 0);
  const totalCash = deposits + payments;

  if (!Array.isArray(db.supplies)) db.supplies = [];
  const totalSupplies = db.supplies.reduce((s, x) => s + num(x.totalPrice), 0);
  const netProfit = totalCash - totalSupplies;

  const remaining = db.customers.reduce((s, c) => s + Math.max(0, accountFor(c.id).remaining), 0);
  const current = db.orders.filter((o) => o.status !== "تم التسليم").length;

  const stat = (l, v, symbol, note, color) => `
    <div class="stat">
      <div class="stat-top">
        <div class="label">${l}</div>
        <span class="stat-icon">${icon(symbol)}</span>
      </div>
      <div class="value" ${color ? `style="color:${color};"` : ""}>${v}</div>
      <div class="stat-note">${note}</div>
    </div>`;

  const statsEl = $("#stats");
  if (statsEl) {
    statsEl.innerHTML =
      stat("المحصّل نقداً (الخزينة)", money(totalCash), "wallet", "العربين والدفعات في الدرج", "var(--primary)") +
      stat("مشتريات البضاعة", money(totalSupplies), "package", "أقمشة وخيوط وزراير ومستلزمات", "var(--danger)") +
      stat("صافي ربح المحل", money(netProfit), "check", "الدرج ناقص مشتريات البضاعة", netProfit >= 0 ? "var(--primary)" : "var(--danger)") +
      stat("باقي على الزباين", money(remaining), "clock", "ديون مستحقة ليك في السوق", "var(--warn)") +
      stat("طلبات قيد العمل", current.toLocaleString("ar-EG"), "orders", "تحت التنفيذ وجاهزة للتسليم");
  }

  const up = db.orders.filter((o) => o.status !== "تم التسليم").sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5);
  const upEl = $("#upcoming");
  if (upEl) {
    upEl.innerHTML = up.length ? up.map(orderCard).join("") : emptyState("clock", "لا توجد مواعيد تسليم قادمة حالياً", "order", "إضافة طلب جديد");
  }
}

/* ---------- إدارة الأحداث والعمليات المالية الحساسة ---------- */
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const d = b.dataset;
  const find = (arr, id) => db[arr].find((x) => x.id === id);

  if (d.editCustomer) customerForm(find("customers", d.editCustomer));
  if (d.orderFor) orderForm({}, d.orderFor);
  if (d.paymentFor) paymentForm({}, d.paymentFor);

  if (d.editSupply) supplyForm(find("supplies", d.editSupply));
  if (d.delSupply) {
    const s = find("supplies", d.delSupply);
    if (confirm(`هل أنت متأكد من حذف فاتورة بضاعة "${s ? s.name : ""}"؟`)) {
      db.supplies = db.supplies.filter((x) => x.id !== d.delSupply);
      save();
      toast("تم حذف فاتورة البضاعة ✅");
    }
  }

  if (d.delCustomer) {
    const cust = find("customers", d.delCustomer);
    const cName = cust ? cust.name : "";
    if (confirm(`⚠️ تحذير مالي مهم:\nهل أنت متأكد تماماً من حذف العميل "${cName}"؟\nسيتم حذف كافة طلباته ومدفوعاته وسجلاته المالية نهائياً!`)) {
      const id = d.delCustomer;
      ["orders", "payments", "cheques"].forEach((k) => (db[k] = db[k].filter((x) => x.customerId !== id)));
      db.customers = db.customers.filter((c) => c.id !== id);
      save();
      toast("تم حذف العميل وسجلاته ✅");
    }
  }

  if (d.editOrder) orderForm(find("orders", d.editOrder));
  if (d.delOrder) {
    if (confirm("هل أنت متأكد من حذف هذا الطلب من الحسابات؟")) {
      db.orders = db.orders.filter((o) => o.id !== d.delOrder);
      save();
      toast("تم حذف الطلب ✅");
    }
  }

  if (d.status) {
    const [id, s] = d.status.split("|");
    const ord = find("orders", id);
    if (ord) {
      ord.status = s;
      save();
      toast(`تم تغيير حالة الطلب إلى "${s}" ✅`);
    }
  }
});

/* ---------- النسخ الاحتياطي وحماية الأموال وتقارير الوورد ---------- */
const exportWordBtn = $("#exportWordBtn");
if (exportWordBtn) {
  exportWordBtn.onclick = () => {
    if (location.protocol === "file:") {
      toast("تنزيل تقرير Word يتطلب تشغيل البرنامج عبر تشغيل_البرنامج.bat");
      return;
    }
    toast("جاري تجهيز تقرير Word الشامل لجميع الحسابات... ⏳");
    window.location.href = "/api/export-word";
    setTimeout(() => {
      toast("تم تجهيز وبدء تنزيل ملف الوورد (.docx) بنجاح 📄✅");
    }, 1200);
  };
}

const openWordFolderBtn = $("#openWordFolderBtn");
if (openWordFolderBtn) {
  openWordFolderBtn.onclick = async () => {
    try {
      if (location.protocol === "file:") {
        toast("المجلد محفوظ على جهازك في المسار: D:\\تقارير_محل_الخياطة_الشهرية");
        return;
      }
      const res = await fetch("/api/open-reports-folder");
      if (res.ok) {
        toast("تم فتح مجلد تقارير الوورد الشهرية في جهازك 📂✅");
      } else {
        toast("مسار المجلد: D:\\تقارير_محل_الخياطة_الشهرية");
      }
    } catch {
      toast("مسار المجلد: D:\\تقارير_محل_الخياطة_الشهرية");
    }
  };
}

$("#exportBtn").onclick = () => {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `tailor-backup-${today()}.json`;
  a.click();
  toast("تم تصدير ملف النسخة الاحتياطية بنجاح 💾");
};

$("#importFile").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const d = JSON.parse(text);
    if (!Array.isArray(d.customers) || !Array.isArray(d.orders)) throw new Error();
    if (!confirm("⚠️ تحذير: استيراد نسخة بديلة سيستبدل كل البيانات الحالية. هل تريد المتابعة؟")) {
      e.target.value = "";
      return;
    }
    db = {
      customers: d.customers || [],
      orders: d.orders || [],
      payments: d.payments || [],
      cheques: d.cheques || [],
      supplies: d.supplies || [],
      measureTypes: d.measureTypes || [...DEFAULT_MEASURES]
    };
    save();
    toast("تم استيراد النسخة بنجاح وتحديث الحسابات ✅");
  } catch {
    toast("الملف غير صالح أو تالف ❌");
  }
  e.target.value = "";
};

// استعراض واستعادة النسخ الاحتياطية المحفوظة تلقائياً على القرص
async function openServerBackupsModal() {
  if (location.protocol === "file:") {
    toast("هذه الميزة تعمل عند تشغيل السيرفر المحلي عبر تشغيل_البرنامج.bat");
    return;
  }
  try {
    const res = await fetch("/api/backups");
    if (!res.ok) throw new Error();
    const json = await res.json();
    const list = json.backups || [];

    if (!list.length) {
      openModal("النسخ الاحتياطية على القرص", "<p style='text-align:center;'>لا توجد نسخ احتياطية محفوظة حالياً على القرص.</p>", null);
      return;
    }

    const html = `
      <p style="font-size:13px; color:var(--muted); margin-bottom:12px;">
        يقوم السيرفر بإنشاء نسخة احتياطية دورية على القرص عند كل تعديل. يمكنك استعادة أي نقطة زمنية سابقة في حال حدوث أي خطأ:
      </p>
      <div class="backup-list-modal">
        ${list
          .map(
            (b) => `
          <div class="backup-card">
            <div class="backup-card-info">
              <strong>${esc(b.filename)}</strong>
              <small>${new Date(b.createdAt).toLocaleString("ar-EG")} · الحجم: ${(b.size / 1024).toFixed(1)} ك.ب</small>
            </div>
            <button type="button" class="btn small ghost" data-restore-backup="${esc(b.filename)}">استرجاع هذه النسخة</button>
          </div>`
          )
          .join("")}
      </div>
    `;

    openModal("النسخ الاحتياطية على القرص الصلب", html, () => false);

    // تفعيل أزرار الاسترجاع داخل المودال
    $("#modalBody").querySelectorAll("button[data-restore-backup]").forEach((btn) => {
      btn.onclick = async () => {
        const fname = btn.dataset.restoreBackup;
        if (confirm(`هل أنت متأكد من استرجاع النسخة "${fname}"؟\nسيتم حفظ نسخة أمان من حالتك الحالية أولاً.`)) {
          try {
            const restoreRes = await fetch("/api/restore", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ filename: fname })
            });
            if (restoreRes.ok) {
              const resJson = await restoreRes.json();
              db = resJson.data;
              localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
              render();
              $("#modal").close();
              toast("تم استرجاع النسخة بنجاح ✅");
            } else {
              toast("فشل استرجاع النسخة ❌");
            }
          } catch {
            toast("تعذر الاتصال بالسيرفر ❌");
          }
        }
      };
    });
  } catch {
    toast("تعذر جلب النسخ الاحتياطية من السيرفر ❌");
  }
}

/* ---------- Service Worker والتنبيهات (مع الحماية من أخطاء البروتوكول) ---------- */
async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;

  // الحماية من الخطأ الشائع: لا يمكن تسجيل Service Worker على بروتوكول file://
  if (location.protocol !== "http:" && location.protocol !== "https:") {
    console.info("[Tailor PWA] تطبيق Service Worker يتطلب تشغيله عبر سيرفر محلي (http://localhost:3000)");
    return null;
  }

  // إذا كانت الصفحة معروضة داخل إطار معاينة، تخطي التسجيل
  if (window.top !== window.self) return null;

  try {
    const reg = await navigator.serviceWorker.register("sw.js");
    if (reg.update) reg.update().catch(() => {});
    try {
      if ("periodicSync" in reg) {
        await reg.periodicSync.register("check-reminders", { minInterval: 12 * 3600 * 1000 });
      }
    } catch {}
    return reg;
  } catch (err) {
    console.warn("[Tailor PWA] ملاحظة تسجيل Service Worker:", err);
    return null;
  }
}

// مزامنة المواعيد مع الكاش ليتعامل معها Service Worker للتنبيهات
async function syncReminders() {
  if (!("caches" in window)) return;
  try {
    const cache = await caches.open("tailor-data");
    const old = await cache.match("./__reminders.json").then((r) => r && r.json()).catch(() => null);
    const orders = db.orders
      .filter((o) => o.status === "تحت التنفيذ" || o.status === "جاهز")
      .map((o) => ({ id: o.id + o.dueDate, name: customerName(o.customerId), type: o.type, dueDate: o.dueDate }));
    await cache.put("./__reminders.json", new Response(JSON.stringify({ orders, notified: old?.notified || [] })));
    navigator.serviceWorker?.controller?.postMessage("check-reminders");
  } catch (err) {
    console.warn("[Tailor PWA] مزامنة المواعيد:", err);
  }
}

$("#notifyBtn").onclick = async () => {
  if (location.protocol === "file:") {
    return toast("شغّل البرنامج عبر السيرفر المحلي (تشغيل_البرنامج.bat) لتفعيل التنبيهات");
  }
  if (!("Notification" in window)) {
    return toast("المتصفح لا يدعم التنبيهات");
  }
  try {
    const p = await Notification.requestPermission();
    if (p === "granted") {
      toast("تم تفعيل التنبيهات بنجاح 🔔");
      syncReminders();
    } else {
      toast("تم رفض التنبيهات - يمكنك تفعيلها من إعدادات المتصفح");
    }
  } catch {
    toast("تعذر طلب إذن التنبيهات");
  }
};

/* ---------- العرض الكامل وتحديث الشاشات ---------- */
function render() {
  const custCount = $("#count-customers");
  if (custCount) custCount.textContent = db.customers.length.toLocaleString("ar-EG");

  const ordCount = $("#count-orders");
  if (ordCount) ordCount.textContent = db.orders.filter((o) => o.status !== "تم التسليم").length.toLocaleString("ar-EG");

  const supCount = $("#count-supplies");
  if (supCount) supCount.textContent = (db.supplies || []).length.toLocaleString("ar-EG");

  renderDashboard();
  renderCustomers();
  renderOrders();
  renderSupplies();
  renderAccounts();
}

/* ---------- التنزيل التلقائي الشهري لتقرير Word في المتصفح ---------- */
function checkAndAutoDownloadMonthlyWordReport() {
  if (location.protocol !== "http:" && location.protocol !== "https:") return;

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${now.getMonth() + 1}`;
  const storageKey = "tailor_auto_downloaded_word_month";

  try {
    const lastDownloaded = localStorage.getItem(storageKey);
    if (lastDownloaded !== monthKey) {
      // انتظر ثانيتين بعد تحميل الصفحة لتنزيل التقرير الشهري تلقائياً بدون إزعاج
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = "/api/export-word";
        a.download = `تقرير_محل_الخياطة_شهر_${now.getMonth() + 1}_${now.getFullYear()}.docx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        localStorage.setItem(storageKey, monthKey);
        toast(`📄 تم تنزيل نسخة تقرير Word الشهري (${now.getMonth() + 1}/${now.getFullYear()}) تلقائياً على جهازك بنجاح! 🎉`);
      }, 2500);
    }
  } catch (err) {
    console.warn("[Auto Word Download]", err);
  }
}

// البدء الفوري
render();
initServerSync();
registerSW().then(() => syncReminders());
checkAndAutoDownloadMonthlyWordReport();
setInterval(checkAndAutoDownloadMonthlyWordReport, 3600 * 1000);
