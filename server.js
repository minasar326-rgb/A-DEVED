/**
 * ============================================================================
 * خادم إدارة محل الخياطة (Tailor PWA Server)
 * خادم محلي خفيف فائق السرعة وموثوق لحفظ أموال وبيانات المحل بدون أي مخاطرة
 * ============================================================================
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { autoSaveMonthlyWordReport, generateWordReport, REPORTS_DIR } = require("./word-report");

const DEFAULT_PORT = 3333;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const BACKUPS_DIR = path.join(DATA_DIR, "backups");
const DB_FILE = path.join(DATA_DIR, "database.json");
const AUDIT_FILE = path.join(DATA_DIR, "audit_log.jsonl");

// التأكد من وجود مجلدات البيانات والنسخ الاحتياطية
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

// تهيئة قاعدة البيانات إذا لم تكن موجودة
function initDatabase() {
  if (!fs.existsSync(DB_FILE)) {
    const initialData = {
      customers: [],
      orders: [],
      payments: [],
      cheques: [],
      supplies: [],
      measureTypes: ["طول الشخص", "خزنه", "سفرة", "طول كم", "وسع كم", "حجر", "قبه", "بشليق"],
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString()
    };
    saveDataAtomic(initialData, "INITIALIZATION");
    console.log("تم إنشاء قاعدة البيانات بنجاح في:", DB_FILE);
  }
}

// قراءة قاعدة البيانات بأمان
function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, "utf-8");
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.customers)) return data;
    }
  } catch (err) {
    console.error("خطأ أثناء قراءة قاعدة البيانات الرئيسية، جاري البحث عن آخر نسخة احتياطية...", err);
    const restored = restoreLatestBackup();
    if (restored) return restored;
  }
  return { customers: [], orders: [], payments: [], cheques: [], supplies: [], measureTypes: ["طول الشخص", "خزنه", "سفرة", "طول كم", "وسع كم", "حجر", "قبه", "بشليق"], lastModified: new Date().toISOString() };
}

// حفظ ذري (Atomic Write) مع كتابة مؤقتة ومزامنة للقرص لمنع تلف الملفات نهائياً
function saveDataAtomic(data, actionType = "UPDATE") {
  const tmpFile = DB_FILE + ".tmp." + Date.now();
  data.lastModified = new Date().toISOString();
  const jsonStr = JSON.stringify(data, null, 2);

  // 1. الكتابة في ملف مؤقت
  const fd = fs.openSync(tmpFile, "w");
  fs.writeSync(fd, jsonStr);
  fs.fsyncSync(fd); // إجبار القرص على كتابة كل البيانات
  fs.closeSync(fd);

  // 2. استبدال ذري آمن للملف الأصلي
  fs.renameSync(tmpFile, DB_FILE);

  // 3. إنشاء نسخة احتياطية دورية فورية
  createTimestampedBackup(data);

  // 4. تسجيل العملية في سجل التدقيق المالي
  logAudit(actionType, data);

  // 5. تحديث تقرير الوورد الشهري تلقائياً على جهاز الكمبيوتر
  try {
    autoSaveMonthlyWordReport(data);
  } catch (err) {
    console.warn("[Word Report] خطأ في الحفظ التلقائي:", err.message);
  }

  return true;
}

// إنشاء نسخة احتياطية دورية مع الحفاظ على آخر 50 نسخة
function createTimestampedBackup(data) {
  try {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const filename = `backup_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.json`;
    const dest = path.join(BACKUPS_DIR, filename);

    fs.writeFileSync(dest, JSON.stringify(data, null, 2), "utf-8");

    // تنظيف النسخ القديمة الزائدة عن 50
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter((f) => f.startsWith("backup_") && f.endsWith(".json"))
      .sort();

    while (files.length > 50) {
      const oldest = files.shift();
      try { fs.unlinkSync(path.join(BACKUPS_DIR, oldest)); } catch {}
    }
  } catch (e) {
    console.error("فشل إنشاء نسخة احتياطية:", e);
  }
}

// استعادة آخر نسخة احتياطية في حال تلف الملف
function restoreLatestBackup() {
  try {
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter((f) => f.startsWith("backup_") && f.endsWith(".json"))
      .sort();
    if (files.length > 0) {
      const latest = path.join(BACKUPS_DIR, files[files.length - 1]);
      const content = fs.readFileSync(latest, "utf-8");
      const parsed = JSON.parse(content);
      fs.writeFileSync(DB_FILE, content, "utf-8");
      console.log("تمت استعادة قاعدة البيانات بنجاح من النسخة الاحتياطية:", latest);
      return parsed;
    }
  } catch (e) {
    console.error("فشل استعادة آخر نسخة احتياطية:", e);
  }
  return null;
}

// سجل التدقيق المالي (Audit Trail)
function logAudit(action, data) {
  try {
    const orders = data.orders || [];
    const payments = data.payments || [];
    const cheques = data.cheques || [];

    const totalOrders = orders.reduce((s, o) => s + (Number(o.price) || 0), 0);
    const totalDeposits = orders.reduce((s, o) => s + (Number(o.deposit) || 0), 0);
    const totalPayments = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const totalCheques = cheques.filter((c) => c.status !== "مرتجع").reduce((s, c) => s + (Number(c.amount) || 0), 0);

    const logEntry = {
      timestamp: new Date().toISOString(),
      action,
      stats: {
        customersCount: (data.customers || []).length,
        ordersCount: orders.length,
        paymentsCount: payments.length,
        chequesCount: cheques.length,
        totalOrdersValue: totalOrders,
        collectedCash: totalDeposits + totalPayments,
        chequesValue: totalCheques
      }
    };
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(logEntry) + "\n", "utf-8");
  } catch {}
}

// أنواع الملفات المدعومة (MIME Types)
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

// قراءة جسم الطلب بصيغة JSON
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) { // حد أقصى 50MB
        req.destroy();
        reject(new Error("حجم البيانات كبير جداً"));
      }
    });
    req.on("end", () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        resolve(parsed);
      } catch (e) {
        reject(new Error("بيانات JSON غير صالحة"));
      }
    });
    req.on("error", reject);
  });
}

// دالة الرد بـ JSON
function sendJSON(res, status, obj) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-cache, no-store, must-revalidate"
  });
  res.end(JSON.stringify(obj));
}

// استخراج عناوين IP للشبكة المحلية لتمكين فتح التطبيق من الهاتف
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name in interfaces) {
    for (const net of interfaces[name]) {
      if (net.family === "IPv4" && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

// إنشاء خادم HTTP
const server = http.createServer(async (req, res) => {
  // تفعيل CORS للطلبات المسبقة (Preflight)
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // ==================== مسارات الـ API ====================

  // 1. جلب البيانات الحالية
  if (pathname === "/api/data" && req.method === "GET") {
    const data = loadDatabase();
    return sendJSON(res, 200, { success: true, data, serverTime: new Date().toISOString() });
  }

  // 2. حفظ البيانات بأمان مع تحقق كامل
  if (pathname === "/api/save" && req.method === "POST") {
    try {
      const incoming = await parseRequestBody(req);
      if (!incoming || !Array.isArray(incoming.customers) || !Array.isArray(incoming.orders)) {
        return sendJSON(res, 400, { success: false, error: "صيغة البيانات غير صحيحة" });
      }

      const cleanData = {
        customers: incoming.customers || [],
        orders: incoming.orders || [],
        payments: incoming.payments || [],
        cheques: incoming.cheques || [],
        supplies: incoming.supplies || [],
        measureTypes: incoming.measureTypes || ["طول الشخص", "خزنه", "سفرة", "طول كم", "وسع كم", "حجر", "قبه", "بشليق"],
        settings: incoming.settings || {},
        lastSavedBy: req.socket.remoteAddress || "local"
      };

      saveDataAtomic(cleanData, "SAVE_DATA");
      return sendJSON(res, 200, { success: true, timestamp: Date.now() });
    } catch (err) {
      console.error("خطأ أثناء حفظ البيانات:", err);
      return sendJSON(res, 500, { success: false, error: err.message });
    }
  }

  // 3. قائمة النسخ الاحتياطية المتوفرة على القرص
  if (pathname === "/api/backups" && req.method === "GET") {
    try {
      const list = fs.readdirSync(BACKUPS_DIR)
        .filter((f) => f.startsWith("backup_") && f.endsWith(".json"))
        .sort()
        .reverse()
        .map((filename) => {
          const fullPath = path.join(BACKUPS_DIR, filename);
          const stats = fs.statSync(fullPath);
          return {
            filename,
            size: stats.size,
            createdAt: stats.mtime.toISOString()
          };
        });
      return sendJSON(res, 200, { success: true, backups: list });
    } catch (err) {
      return sendJSON(res, 500, { success: false, error: err.message });
    }
  }

  // 4. استعادة نسخة احتياطية محددة
  if (pathname === "/api/restore" && req.method === "POST") {
    try {
      const body = await parseRequestBody(req);
      const targetFilename = body.filename;
      if (!targetFilename || typeof targetFilename !== "string" || targetFilename.includes("..") || targetFilename.includes("/") || targetFilename.includes("\\")) {
        return sendJSON(res, 400, { success: false, error: "اسم ملف غير صالح" });
      }

      const filePath = path.join(BACKUPS_DIR, targetFilename);
      if (!fs.existsSync(filePath)) {
        return sendJSON(res, 404, { success: false, error: "الملف غير موجود" });
      }

      // أخذ نسخة أمان للحالة الحالية قبل الاسترجاع
      const current = loadDatabase();
      createTimestampedBackup({ ...current, _preRestore: true });

      const targetData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      saveDataAtomic(targetData, "RESTORE_BACKUP: " + targetFilename);

      return sendJSON(res, 200, { success: true, data: targetData });
    } catch (err) {
      return sendJSON(res, 500, { success: false, error: err.message });
    }
  }

  // 5. تحميل ملف نسخة احتياطية كامل للتنزيل المباشر
  if (pathname === "/api/export" && req.method === "GET") {
    try {
      const data = loadDatabase();
      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `tailor-backup-${dateStr}.json`;
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`
      });
      res.end(JSON.stringify(data, null, 2));
      return;
    } catch (err) {
      return sendJSON(res, 500, { success: false, error: err.message });
    }
  }

  // 6. تحميل تقرير Word (.docx) فوري للموقع كامل
  if (pathname === "/api/export-word" && req.method === "GET") {
    try {
      const data = loadDatabase();
      const now = new Date();
      const filename = `تقرير_محل_الخياطة_شهر_${now.getMonth() + 1}_${now.getFullYear()}.docx`;
      const buffer = await generateWordReport(data);

      res.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
        "Content-Length": buffer.length,
        "Access-Control-Allow-Origin": "*"
      });
      return res.end(buffer);
    } catch (err) {
      console.error("خطأ أثناء تصدير ملف الوورد:", err);
      return sendJSON(res, 500, { success: false, error: err.message });
    }
  }

  // 7. فتح مجلد التقارير الشهرية في Windows Explorer
  if (pathname === "/api/open-reports-folder" && req.method === "GET") {
    try {
      const cp = require("child_process");
      if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
      cp.exec(`explorer "${REPORTS_DIR}"`);
      return sendJSON(res, 200, { success: true, folder: REPORTS_DIR });
    } catch (err) {
      return sendJSON(res, 500, { success: false, error: err.message });
    }
  }

  // 8. قائمة تقارير الوورد الشهرية المتوفرة
  if (pathname === "/api/reports" && req.method === "GET") {
    try {
      let list = [];
      if (fs.existsSync(REPORTS_DIR)) {
        list = fs.readdirSync(REPORTS_DIR)
          .filter((f) => f.endsWith(".docx"))
          .map((f) => {
            const stats = fs.statSync(path.join(REPORTS_DIR, f));
            return { filename: f, size: stats.size, modified: stats.mtime.toISOString() };
          });
      }
      return sendJSON(res, 200, { success: true, reports: list, folder: REPORTS_DIR });
    } catch (err) {
      return sendJSON(res, 500, { success: false, error: err.message });
    }
  }

  // 6. استيراد ملف خارجي
  if (pathname === "/api/import" && req.method === "POST") {
    try {
      const incoming = await parseRequestBody(req);
      if (!incoming || !Array.isArray(incoming.customers)) {
        return sendJSON(res, 400, { success: false, error: "ملف غير صالح، يجب أن يحتوي على مصفوفة العملاء" });
      }

      const cleanData = {
        customers: incoming.customers || [],
        orders: incoming.orders || [],
        payments: incoming.payments || [],
        cheques: incoming.cheques || []
      };

      saveDataAtomic(cleanData, "IMPORT_EXTERNAL_FILE");
      return sendJSON(res, 200, { success: true, data: cleanData });
    } catch (err) {
      return sendJSON(res, 500, { success: false, error: err.message });
    }
  }

  // 7. حالة السيرفر
  if (pathname === "/api/status" && req.method === "GET") {
    const stats = fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE) : { size: 0, mtime: new Date() };
    const backupsCount = fs.readdirSync(BACKUPS_DIR).filter((f) => f.endsWith(".json")).length;
    return sendJSON(res, 200, {
      success: true,
      status: "online",
      dbSize: stats.size,
      lastModified: stats.mtime,
      backupsCount,
      localIPs: getLocalIPs(),
      uptime: Math.floor(process.uptime())
    });
  }

  // ==================== تقديم الملفات الثابتة (Static Files) ====================
  let filePath = path.join(ROOT_DIR, pathname === "/" ? "index.html" : pathname);

  // حماية من مسارات Directory Traversal
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  // إذا كان المطلوب مجلداً، ابحث عن index.html بداخله
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>404 - الصفحة غير موجودة</h1>");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  // ترويسات التخزين المؤقت وحماية PWA
  const headers = {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
    "Permissions-Policy": "unload=*"
  };

  if (pathname === "/sw.js") {
    headers["Service-Worker-Allowed"] = "/";
    headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
  } else if (pathname === "/manifest.json" || pathname.endsWith(".html")) {
    headers["Cache-Control"] = "no-cache, must-revalidate";
  } else {
    headers["Cache-Control"] = "public, max-age=3600";
  }

  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
});

// بدء الخادم
initDatabase();

// تشغيل الحفظ التلقائي لتقرير الوورد الشهري فور بدء تشغيل السيرفر
try {
  autoSaveMonthlyWordReport(loadDatabase());
} catch (err) {
  console.warn("[Word Report] خطأ في التوليد الأولي:", err.message);
}

// فحص دوري كل 6 ساعات لتوليد وحفظ تقرير أول كل شهر تلقائياً بدون أي تدخل من المستخدم
setInterval(() => {
  try {
    autoSaveMonthlyWordReport(loadDatabase());
  } catch (err) {
    console.warn("[Word Report] خطأ في الفحص الدوري للتقارير:", err.message);
  }
}, 6 * 3600 * 1000);

function startServer(port) {
  server.listen(port, "0.0.0.0", () => {
    const localIPs = getLocalIPs();
    try {
      fs.writeFileSync(path.join(DATA_DIR, "server_url.txt"), `http://localhost:${port}`, "utf-8");
    } catch {}
    console.log("\n============================================================");
    console.log("🧵 خادم إدارة محل الخياطة يعمل بنجاح وبأعلى درجات الأمان!");
    console.log("============================================================");
    console.log(`💻 على هذا الجهاز (الكمبيوتر):  http://localhost:${port}`);
    if (localIPs.length > 0) {
      localIPs.forEach((ip) => {
        console.log(`📱 من الهاتف أو شبكة المحل:  http://${ip}:${port}`);
      });
    }
    console.log(`💾 ملف قاعدة البيانات الرئيسي:  ${DB_FILE}`);
    console.log(`🛡️ مجلد النسخ الاحتياطية:       ${BACKUPS_DIR}`);
    console.log(`📄 تقارير الوورد الشهرية الآلية: ${REPORTS_DIR}`);
    console.log("============================================================\n");
  }).on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`[تنبيه] المنفذ ${port} مشغول، جاري الانتقال للمنفذ ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error("خطأ أثناء تشغيل السيرفر:", err);
    }
  });
}

const initialPort = parseInt(process.env.PORT, 10) || DEFAULT_PORT;
startServer(initialPort);
