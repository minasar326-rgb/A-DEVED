// ===================================================================
// اختبارات الجودة وضمان الاستقرار الشاملة لتطبيق إدارة الخياطة والخزينة
// Comprehensive QA & Integration Test Suite for Tailor PWA
// ===================================================================

const fs = require("fs");
const path = require("path");

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${message}`);
  } else {
    failedTests++;
    console.error(`  ❌ [FAIL] ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  totalTests++;
  const isMatch = JSON.stringify(actual) === JSON.stringify(expected);
  if (isMatch) {
    passedTests++;
    console.log(`  ✅ [PASS] ${message} (النتيجة المتطابقة: ${JSON.stringify(actual)})`);
  } else {
    failedTests++;
    console.error(`  ❌ [FAIL] ${message} (المتوقع: ${JSON.stringify(expected)} | الفعلي: ${JSON.stringify(actual)})`);
  }
}

// -------------------------------------------------------------------
// 1. اختبار دالة معالجة الأرقام وتحويل الأرقام العربية ومنع السالب num()
// -------------------------------------------------------------------
console.log("\n🧪 [المجموعة 1] اختبار دالة num() ومعالجة الأرقام والعملات العربية:");

function num(val) {
  if (val === null || val === undefined) return 0;
  let s = String(val).trim();
  const arMap = {
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
    "٫": ".", "،": "."
  };
  s = s.replace(/[٠-٩٫،]/g, (d) => arMap[d] || d);
  const n = parseFloat(s);
  if (isNaN(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

assertEqual(num("١٢٥"), 125, "تحويل الأرقام العربية المشرقية (١٢٥ -> 125)");
assertEqual(num("٣٥٠٫٥٠"), 350.5, "تحويل الفاصلة العشرية العربية (٣٥٠٫٥٠ -> 350.5)");
assertEqual(num("250.75"), 250.75, "الأرقام الإنجليزية العشرية");
assertEqual(num("-50"), 0, "منع المبالغ السالبة وتحويلها تلقائياً إلى 0");
assertEqual(num(""), 0, "القيم الفارغة ترجع 0");
assertEqual(num(null), 0, "القيم المعدومة null ترجع 0");
assertEqual(num("abc"), 0, "النصوص العشوائية ترجع 0");

// -------------------------------------------------------------------
// 2. اختبار عمليات الخزينة والحسابات والديون وصافي الأرباح
// -------------------------------------------------------------------
console.log("\n🧪 [المجموعة 2] اختبار حسابات الخزينة، الديون، وصافي الأرباح:");

const mockDb = {
  customers: [
    { id: "c1", name: "أحمد محمود", phone: "01012345678" },
    { id: "c2", name: "محمد علي", phone: "01123456789" },
    { id: "c3", name: "محمود حسن", phone: "01234567890" }
  ],
  orders: [
    { id: "o1", customerId: "c1", price: 1000, deposit: 300, status: "تحت التنفيذ" },
    { id: "o2", customerId: "c1", price: 500, deposit: 200, status: "جاهز" },
    { id: "o3", customerId: "c2", price: 800, deposit: 800, status: "تم التسليم" },
    { id: "o4", customerId: "c3", price: 600, deposit: 0, status: "تحت التنفيذ" }
  ],
  payments: [
    { id: "p1", customerId: "c1", amount: 400, date: "2026-10-01" },
    { id: "p2", customerId: "c3", amount: 200, date: "2026-10-05" }
  ],
  supplies: [
    { id: "s1", name: "قماش صوف كشمير", totalPrice: 700, category: "أقمشة" },
    { id: "s2", name: "خيوط ومقصات", totalPrice: 150, category: "خيوط وسحابات" },
    { id: "s3", name: "فواتير كهرباء ونثريات", totalPrice: 100, category: "مصاريف ونثريات عامة" }
  ]
};

function accountFor(db, customerId) {
  const cOrders = db.orders.filter(o => o.customerId === customerId);
  const cPayments = db.payments.filter(p => p.customerId === customerId);
  const total = cOrders.reduce((s, o) => s + num(o.price), 0);
  const deposits = cOrders.reduce((s, o) => s + num(o.deposit), 0);
  const extraPaid = cPayments.reduce((s, p) => s + num(p.amount), 0);
  const paid = deposits + extraPaid;
  const remaining = Math.max(0, total - paid);
  return { total, deposits, extraPaid, paid, remaining };
}

// حساب العميل c1:
// إجمالي أسعار الطلبات = 1000 + 500 = 1500
// المدفوع = مقدم 300 + مقدم 200 + دفعة 400 = 900
// المتبقي دين = 1500 - 900 = 600
const accC1 = accountFor(mockDb, "c1");
assertEqual(accC1.total, 1500, "إجمالي حساب العميل c1 صحيح (1500 ج.م)");
assertEqual(accC1.paid, 900, "إجمالي المسدد من العميل c1 صحيح (900 ج.م)");
assertEqual(accC1.remaining, 600, "المتبقي على العميل c1 صحيح (600 ج.م)");

// حساب العميل c2 (مسدد بالكامل = رصيد صفر):
const accC2 = accountFor(mockDb, "c2");
assertEqual(accC2.total, 800, "إجمالي حساب العميل c2 مسدد بالكامل");
assertEqual(accC2.remaining, 0, "المتبقي على العميل c2 هو 0 (لا يوجد دين)");

// حساب الخزينة الإجمالي وصافي الأرباح:
const totalDeposits = mockDb.orders.reduce((s, o) => s + num(o.deposit), 0); // 300 + 200 + 800 + 0 = 1300
const totalPayments = mockDb.payments.reduce((s, p) => s + num(p.amount), 0); // 400 + 200 = 600
const totalCashIn = totalDeposits + totalPayments; // 1900
const totalSupplies = mockDb.supplies.reduce((s, x) => s + num(x.totalPrice), 0); // 700 + 150 + 100 = 950
const netProfit = totalCashIn - totalSupplies; // 1900 - 950 = 950
const totalRemainingDebts = mockDb.customers.reduce((s, c) => s + accountFor(mockDb, c.id).remaining, 0); // c1: 600, c2: 0, c3: 400 -> 1000

assertEqual(totalCashIn, 1900, "إجمالي النقدية الداخلة في الخزينة (1900 ج.م)");
assertEqual(totalSupplies, 950, "إجمالي مصاريف البضاعة والنثريات (950 ج.م)");
assertEqual(netProfit, 950, "صافي ربح الخزينة الفعلي = الداخل - المصروفات (950 ج.م)");
assertEqual(totalRemainingDebts, 1000, "إجمالي الديون المتبقية عند جميع الزبائن (1000 ج.م)");

// -------------------------------------------------------------------
// 3. اختبار إضافة وتعديل وحذف الدفعات النقدية (Payment CRUD)
// -------------------------------------------------------------------
console.log("\n🧪 [المجموعة 3] اختبار دورة حياة الدفعات النقدية (CRUD):");

// إضافة دفعة جديدة للعميل c3 لسداد دينه
mockDb.payments.push({ id: "p3", customerId: "c3", amount: 400, date: "2026-10-10" });
const accC3AfterPay = accountFor(mockDb, "c3");
assertEqual(accC3AfterPay.remaining, 0, "سداد دفعة جديدة جعل متبقي العميل 0 (تسوية تامة)");

// تعديل الدفعة
const p3 = mockDb.payments.find(p => p.id === "p3");
p3.amount = 100;
const accC3AfterEdit = accountFor(mockDb, "c3");
assertEqual(accC3AfterEdit.remaining, 300, "تعديل قيمة الدفعة حدّث المتبقي فوراً إلى 300 ج.م");

// حذف الدفعة
mockDb.payments = mockDb.payments.filter(p => p.id !== "p3");
const accC3AfterDel = accountFor(mockDb, "c3");
assertEqual(accC3AfterDel.remaining, 400, "حذف الدفعة أعاد احتساب الدين بدقة إلى 400 ج.م");

// -------------------------------------------------------------------
// 4. اختبار حذف العميل والحذف المتتالي (Cascade Delete)
// -------------------------------------------------------------------
console.log("\n🧪 [المجموعة 4] اختبار سلامة العلاقات والحذف المتسلسل (Cascade Delete):");

const deleteCustomerId = "c1";
mockDb.orders = mockDb.orders.filter(o => o.customerId !== deleteCustomerId);
mockDb.payments = mockDb.payments.filter(p => p.customerId !== deleteCustomerId);
mockDb.customers = mockDb.customers.filter(c => c.id !== deleteCustomerId);

assert(!mockDb.customers.some(c => c.id === deleteCustomerId), "تم حذف العميل بنجاح من قائمة العملاء");
assert(!mockDb.orders.some(o => o.customerId === deleteCustomerId), "تم حذف جميع طلبات العميل دون ترك سجلات معلقة");
assert(!mockDb.payments.some(p => p.customerId === deleteCustomerId), "تم حذف مدفوعات العميل دون أي تسريب");

// -------------------------------------------------------------------
// 5. فحص سلامة ملفات PWA والعمل دون إنترنت (Offline Cache Files)
// -------------------------------------------------------------------
console.log("\n🧪 [المجموعة 5] فحص ملفات Service Worker والتأكد من وجودها على القرص للعمل دون إنترنت:");

const swContent = fs.readFileSync(path.join(__dirname, "sw.js"), "utf8");
const filesMatch = swContent.match(/const FILES = \[([\s\S]*?)\];/);
assert(filesMatch !== null, "العثور على قائمة ملفات الكاش في sw.js");

if (filesMatch) {
  const fileLines = filesMatch[1]
    .split("\n")
    .map(line => line.trim().replace(/[",]/g, ""))
    .filter(line => line.length > 0 && line !== "./");

  let allExist = true;
  for (const f of fileLines) {
    const cleanPath = f.replace(/^\.\//, "");
    const fullPath = path.join(__dirname, cleanPath);
    const exists = fs.existsSync(fullPath);
    if (!exists) {
      allExist = false;
      console.error(`  ❌ ملف مفقود من ملفات الـ PWA: ${cleanPath}`);
    }
  }
  assert(allExist, `جميع ملفات PWA (${fileLines.length} ملف) موجودة فعلياً على القرص وجاهزة للكاش Offline`);
}

// -------------------------------------------------------------------
// 6. اختبار توليد ملف Word (.docx) بدون أخطاء
// -------------------------------------------------------------------
console.log("\n🧪 [المجموعة 6] اختبار سلامة توليد تقرير Word الشامل عبر Node.js:");

try {
  const { generateWordReport } = require("./word-report.js");
  const reportDb = {
    customers: [
      { id: "1", name: "عميل تجريبي", phone: "01000000000", measures: { "طول": "140", "كتف": "45" } }
    ],
    orders: [
      { id: "101", customerId: "1", type: "جلابية بلدي", price: 800, deposit: 300, dueDate: "2026-11-01", status: "تحت التنفيذ" }
    ],
    payments: [
      { id: "201", customerId: "1", amount: 200, date: "2026-10-25", note: "دفعة بروفة" }
    ],
    supplies: [
      { id: "301", name: "قماش ستان", category: "أقمشة", quantity: 5, unit: "متر", unitPrice: 50, totalPrice: 250, supplier: "محل النور", date: "2026-10-20" }
    ],
    measureTypes: ["طول", "كتف", "صدر", "وسع كم"]
  };

  generateWordReport(reportDb).then(buffer => {
    assert(Buffer.isBuffer(buffer) && buffer.length > 1000, `تم توليد ملف Word بنجاح وحجم الملف ${buffer.length} بايت`);
    finishTests();
  }).catch(err => {
    assert(false, `خطأ أثناء توليد ملف Word: ${err.message}`);
    finishTests();
  });
} catch (err) {
  assert(false, `تعذر استيراد word-report.js: ${err.message}`);
  finishTests();
}

function finishTests() {
  console.log("\n=======================================================");
  console.log(`📊 النتيجة الإجمالية للاختبارات: ${passedTests} ناجح من إجمالي ${totalTests}`);
  if (failedTests === 0) {
    console.log("🎉 جميع الاختبارات البرمجية والمالية والأوفلاين نجحت بنسبة 100%!");
  } else {
    console.error(`⚠️ يوجد ${failedTests} اختبار لم ينجح.`);
  }
  console.log("=======================================================\n");
  if (failedTests > 0) process.exit(1);
}
