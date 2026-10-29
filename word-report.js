/**
 * ============================================================================
 * وحدة توليد تقارير Microsoft Word (.docx) التلقائية لمحل الخياطة
 * تقرير شامل ومنسق بنسبة 100% باللغة العربية يشمل:
 * 1. مالية المحل وما يخص الخزينة والأرباح (حق المحل)
 * 2. كشف الشكك والديون المعلقة على العملاء (الآجل بالتفصيل)
 * 3. كشف حساب جميع العملاء والمقاسات والأطوال
 * 4. سجل طلبات التفصيل وحالات التسليم
 * 5. سجل مشتريات البضاعة والأقمشة والمستلزمات
 * 6. سجل الدفعات النقدية المستلمة
 * ============================================================================
 */

const fs = require("fs");
const path = require("path");
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  ShadingType
} = require("docx");

const REPORTS_DIR = "D:\\تقارير_محل_الخياطة_الشهرية";
const LOCAL_REPORTS_DIR = path.join(__dirname, "reports");

// التأكد من وجود مجلدات التقارير على القرص الصلب
[REPORTS_DIR, LOCAL_REPORTS_DIR].forEach((dir) => {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.warn(`تعذر إنشاء مجلد التقارير ${dir}:`, err.message);
  }
});

// تحويل الأرقام بدقة
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

const money = (v) => num(v).toLocaleString("ar-EG") + " ج.م";

// إعداد خلية جدول منسقة تدعم الأسطر المتعددة وتنسيق اليمين لليسار
function createCell(text, options = {}) {
  const isHeader = options.isHeader || false;
  const bg = options.bg || (isHeader ? "168575" : "FFFFFF");
  const color = options.color || (isHeader ? "FFFFFF" : "243449");
  const bold = options.bold !== undefined ? options.bold : isHeader;
  const align = options.align || AlignmentType.RIGHT;
  const fontSize = options.size || (isHeader ? 21 : 19);

  const lines = String(text ?? "").split("\n");
  const paragraphs = lines.map(
    (line) =>
      new Paragraph({
        alignment: align,
        bidirectional: true,
        spacing: { before: 20, after: 20 },
        children: [
          new TextRun({
            text: line,
            bold,
            color,
            font: "Arial",
            size: fontSize,
            rightToLeft: true
          })
        ]
      })
  );

  return new TableCell({
    width: options.width ? { size: options.width, type: WidthType.PERCENTAGE } : undefined,
    shading: {
      fill: bg,
      type: ShadingType.CLEAR
    },
    margins: {
      top: 100,
      bottom: 100,
      left: 120,
      right: 120
    },
    children: paragraphs.length ? paragraphs : [new Paragraph({})]
  });
}

// دالة توليد التقرير الشامل كـ Buffer
async function generateWordReport(data, customTitle = null) {
  const customers = data.customers || [];
  const orders = data.orders || [];
  const payments = data.payments || [];
  const supplies = data.supplies || [];

  const now = new Date();
  const dateStr = now.toLocaleDateString("ar-EG", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });
  const timeStr = now.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
  const monthName = now.toLocaleDateString("ar-EG", { month: "long", year: "numeric" });

  // 1. الحسابات المالية الأساسية
  const deposits = orders.reduce((s, o) => s + num(o.deposit), 0);
  const directPayments = payments.reduce((s, p) => s + num(p.amount), 0);
  const totalCashCollected = deposits + directPayments; // إجمالي المحصّل نقداً (كاش الدرج والخزينة)

  const totalSuppliesSpent = supplies.reduce((s, x) => s + num(x.totalPrice), 0); // المصروف على البضاعة
  const netProfit = totalCashCollected - totalSuppliesSpent; // صافي الربح الفعلي للمحل
  const totalOrdersAmount = orders.reduce((s, o) => s + num(o.price), 0); // إجمالي قيمة الشغل والمبيعات

  // حساب حسابات كل عميل (الفلوس اللي عليه، اللي دفعه، واللي باقي شكك)
  const customerAccounts = customers.map((c) => {
    const custOrders = orders.filter((o) => o.customerId === c.id);
    const orderTotal = custOrders.reduce((s, o) => s + num(o.price), 0);
    const orderDeposits = custOrders.reduce((s, o) => s + num(o.deposit), 0);
    const custPayments = payments.filter((p) => p.customerId === c.id).reduce((s, p) => s + num(p.amount), 0);
    const totalPaid = orderDeposits + custPayments;
    const remaining = Math.max(0, orderTotal - totalPaid);
    return {
      customer: c,
      orders: custOrders,
      orderTotal,
      totalPaid,
      remaining
    };
  });

  // كشف الشكك (العملاء الذين عليهم مبالغ متبقية لم تسدد)
  const debtAccounts = customerAccounts.filter((x) => x.remaining > 0);
  const totalRemainingDebt = debtAccounts.reduce((s, x) => s + x.remaining, 0); // إجمالي الشكك المعلق في السوق

  const activeOrdersCount = orders.filter((o) => o.status !== "تم التسليم").length;
  const deliveredOrdersCount = orders.length - activeOrdersCount;

  // فقرة العنوان الرئيسي
  const titleParagraph = new Paragraph({
    alignment: AlignmentType.CENTER,
    bidirectional: true,
    spacing: { after: 100 },
    children: [
      new TextRun({
        text: "🧵 نظام إدارة محل الخياطة",
        bold: true,
        size: 34,
        color: "168575",
        font: "Arial",
        rightToLeft: true
      })
    ]
  });

  const subtitleParagraph = new Paragraph({
    alignment: AlignmentType.CENTER,
    bidirectional: true,
    spacing: { after: 200 },
    children: [
      new TextRun({
        text: customTitle || `التقرير المالي والإداري الشامل - ${monthName}`,
        bold: true,
        size: 26,
        color: "243449",
        font: "Arial",
        rightToLeft: true
      }),
      new TextRun({
        text: `\nتاريخ إصدار التقرير: ${dateStr} - الساعة: ${timeStr}`,
        size: 18,
        color: "758194",
        font: "Arial",
        rightToLeft: true
      })
    ]
  });

  const heading = (title, color = "168575") =>
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      bidirectional: true,
      spacing: { before: 260, after: 100 },
      children: [
        new TextRun({
          text: title,
          bold: true,
          size: 24,
          color,
          font: "Arial",
          rightToLeft: true
        })
      ]
    });

  // =========================================================================
  // 1. جدول ما يخص المحل (حسابات الخزينة، الأرباح، والمستحقات)
  // =========================================================================
  const shopFinanceTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          createCell("البيان المالي لحسابات المحل (حق المحل)", { isHeader: true, width: 60 }),
          createCell("القيمة بالجنيه المصري", { isHeader: true, width: 40 })
        ]
      }),
      new TableRow({
        children: [
          createCell("💵 إجمالي المحصّل نقداً في الخزينة والدرج (عربين الطلبات + الدفعات الكاش)", { bold: true }),
          createCell(money(totalCashCollected), { bold: true, color: "168575" })
        ]
      }),
      new TableRow({
        children: [
          createCell("📦 إجمالي مصروف مشتريات البضاعة والخامات (أقمشة، خيوط، زراير، بطانات)", { bold: true }),
          createCell(money(totalSuppliesSpent), { bold: true, color: "C15160" })
        ]
      }),
      new TableRow({
        children: [
          createCell("🏆 صافي ربح المحل الفعلي المحقق (المحصّل نقداً − مشتريات البضاعة)", { bold: true, bg: "E8F5F1" }),
          createCell(money(netProfit), { bold: true, color: netProfit >= 0 ? "168575" : "C15160", bg: "E8F5F1", size: 21 })
        ]
      }),
      new TableRow({
        children: [
          createCell("⏳ إجمالي الشكك والديون المعلقة على الزبائن (حقوق المحل في السوق)", { bold: true, bg: "FFF8E7" }),
          createCell(money(totalRemainingDebt), { bold: true, color: "B58527", bg: "FFF8E7", size: 21 })
        ]
      }),
      new TableRow({
        children: [
          createCell("📊 إجمالي القيمة الإنتاجية لأعمال المحل (إجمالي أسعار كافة الطلبات)", {}),
          createCell(money(totalOrdersAmount), { bold: true })
        ]
      }),
      new TableRow({
        children: [
          createCell("📋 حركة الطلبات في المحل", {}),
          createCell(`${orders.length.toLocaleString("ar-EG")} طلب (${activeOrdersCount} قيد التنفيذ والتسليم · ${deliveredOrdersCount} مسلّم)`, {})
        ]
      })
    ]
  });

  // =========================================================================
  // 2. جدول الشكك والديون المعلقة على العملاء (كشف الآجل التفصيلي)
  // =========================================================================
  const shakakRows = [
    new TableRow({
      children: [
        createCell("#", { isHeader: true, width: 5, bg: "C15160" }),
        createCell("اسم العميل المدين", { isHeader: true, width: 25, bg: "C15160" }),
        createCell("رقم الهاتف / العنوان", { isHeader: true, width: 22, bg: "C15160" }),
        createCell("إجمالي حسابه", { isHeader: true, width: 16, bg: "C15160" }),
        createCell("المسدد كاش", { isHeader: true, width: 16, bg: "C15160" }),
        createCell("المتبقي (الشكك المطلوب)", { isHeader: true, width: 16, bg: "C15160" })
      ]
    })
  ];

  if (debtAccounts.length > 0) {
    debtAccounts.forEach((da, idx) => {
      const c = da.customer;
      shakakRows.push(
        new TableRow({
          children: [
            createCell(String(idx + 1), { align: AlignmentType.CENTER }),
            createCell(c.name, { bold: true }),
            createCell(`${c.phone || "بدون هاتف"}${c.address ? " · " + c.address : ""}`),
            createCell(money(da.orderTotal)),
            createCell(money(da.totalPaid), { color: "168575" }),
            createCell(money(da.remaining), { bold: true, color: "C15160", bg: "FFF0F0" })
          ]
        })
      );
    });

    // سطر الإجمالي للشكك
    shakakRows.push(
      new TableRow({
        children: [
          createCell("المجموع", { bold: true, align: AlignmentType.CENTER, bg: "FFF0F0" }),
          createCell(`إجمالي عدد الزبائن المدينين: ${debtAccounts.length.toLocaleString("ar-EG")}`, { bold: true, bg: "FFF0F0" }),
          createCell("-", { align: AlignmentType.CENTER, bg: "FFF0F0" }),
          createCell(money(debtAccounts.reduce((s, x) => s + x.orderTotal, 0)), { bold: true, bg: "FFF0F0" }),
          createCell(money(debtAccounts.reduce((s, x) => s + x.totalPaid, 0)), { bold: true, color: "168575", bg: "FFF0F0" }),
          createCell(money(totalRemainingDebt), { bold: true, color: "C15160", bg: "FFF0F0", size: 21 })
        ]
      })
    );
  } else {
    shakakRows.push(
      new TableRow({
        children: [
          createCell("✅ لا توجد أي مبالغ شكك أو ديون معلقة على الزبائن (كافة الحسابات مسددة بالكامل والحمد لله)", {
            width: 100,
            align: AlignmentType.CENTER,
            bold: true,
            color: "168575",
            bg: "E8F5F1"
          })
        ]
      })
    );
  }

  const shakakTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: shakakRows
  });

  // =========================================================================
  // 3. جدول جميع العملاء والمقاسات التفصيلية وحساباتهم
  // =========================================================================
  const customerRows = [
    new TableRow({
      children: [
        createCell("#", { isHeader: true, width: 4 }),
        createCell("اسم العميل", { isHeader: true, width: 18 }),
        createCell("الهاتف / العنوان", { isHeader: true, width: 18 }),
        createCell("الحساب المالي (المسدد / الباقي)", { isHeader: true, width: 22 }),
        createCell("المقاسات والأطوال المسجلة (طول، خزنه، سفرة، كم، حجر...)", { isHeader: true, width: 38 })
      ]
    })
  ];

  customerAccounts.forEach((ca, idx) => {
    const c = ca.customer;
    const ms = Object.entries(c.measurements || {});
    const measureText = ms.length
      ? ms.map(([k, v]) => `${k}: ${v}سم`).join(" | ")
      : "لم تسجل مقاسات";

    const financialText =
      ca.remaining > 0
        ? `عليه: ${money(ca.orderTotal)}\nمسدد: ${money(ca.totalPaid)}\nمتبقي (شكك): ${money(ca.remaining)}`
        : `إجمالي: ${money(ca.orderTotal)}\nمسدد بالكامل: ${money(ca.totalPaid)}\n(خالص الحساب)`;

    customerRows.push(
      new TableRow({
        children: [
          createCell(String(idx + 1), { align: AlignmentType.CENTER }),
          createCell(c.name, { bold: true }),
          createCell(`${c.phone || "بدون هاتف"}${c.address ? "\n" + c.address : ""}`),
          createCell(financialText, {
            bold: ca.remaining > 0,
            color: ca.remaining > 0 ? "C15160" : "168575",
            bg: ca.remaining > 0 ? "FFFDFC" : "FFFFFF"
          }),
          createCell(measureText)
        ]
      })
    );
  });

  const customersTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: customerRows.length > 1 ? customerRows : [
      customerRows[0],
      new TableRow({
        children: [createCell("لا يوجد عملاء مسجلين حتى الآن", { width: 100, align: AlignmentType.CENTER })]
      })
    ]
  });

  // =========================================================================
  // 4. جدول طلبات التفصيل ومواعيد التسليم
  // =========================================================================
  const orderRows = [
    new TableRow({
      children: [
        createCell("#", { isHeader: true, width: 5 }),
        createCell("العميل", { isHeader: true, width: 20 }),
        createCell("نوع القطعة والمواصفات", { isHeader: true, width: 28 }),
        createCell("السعر / العربون / الباقي", { isHeader: true, width: 22 }),
        createCell("موعد التسليم", { isHeader: true, width: 13 }),
        createCell("الحالة", { isHeader: true, width: 12 })
      ]
    })
  ];

  orders.forEach((o, idx) => {
    const custName = customers.find((c) => c.id === o.customerId)?.name || "عميل غير مسجل";
    const remainingOnOrder = Math.max(0, num(o.price) - num(o.deposit));
    orderRows.push(
      new TableRow({
        children: [
          createCell(String(idx + 1), { align: AlignmentType.CENTER }),
          createCell(custName, { bold: true }),
          createCell(`${o.type || "تفصيل"}${o.desc ? " - " + o.desc : ""}`),
          createCell(`السعر: ${money(o.price)}\nالعربون: ${money(o.deposit)}${remainingOnOrder > 0 ? `\nالباقي: ${money(remainingOnOrder)}` : "\n(مسدد)"}`),
          createCell(o.dueDate || "-"),
          createCell(o.status || "تحت التنفيذ", {
            bold: true,
            color: o.status === "جاهز" ? "168575" : o.status === "تم التسليم" ? "758194" : "B58527"
          })
        ]
      })
    );
  });

  const ordersTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: orderRows.length > 1 ? orderRows : [
      orderRows[0],
      new TableRow({
        children: [createCell("لا توجد طلبات مسجلة حتى الآن", { width: 100, align: AlignmentType.CENTER })]
      })
    ]
  });

  // =========================================================================
  // 5. جدول مشتريات البضاعة والخامات (الأقمشة والمستلزمات)
  // =========================================================================
  const supplyRows = [
    new TableRow({
      children: [
        createCell("#", { isHeader: true, width: 5 }),
        createCell("اسم البضاعة / الخامة", { isHeader: true, width: 25 }),
        createCell("التصنيف", { isHeader: true, width: 14 }),
        createCell("الكمية والوحدة", { isHeader: true, width: 14 }),
        createCell("سعر الوحدة", { isHeader: true, width: 14 }),
        createCell("الإجمالي ككل", { isHeader: true, width: 14 }),
        createCell("تاريخ الشراء والمورد", { isHeader: true, width: 14 })
      ]
    })
  ];

  supplies.forEach((s, idx) => {
    supplyRows.push(
      new TableRow({
        children: [
          createCell(String(idx + 1), { align: AlignmentType.CENTER }),
          createCell(`${s.name}${s.notes ? " (" + s.notes + ")" : ""}`, { bold: true }),
          createCell(s.category || "أقمشة"),
          createCell(`${s.quantity || 1} ${s.unit || "متر"}`),
          createCell(money(s.unitPrice)),
          createCell(money(s.totalPrice), { bold: true, color: "C15160" }),
          createCell(`${s.date || "-"}${s.supplier ? "\n" + s.supplier : ""}`)
        ]
      })
    );
  });

  const suppliesTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: supplyRows.length > 1 ? supplyRows : [
      supplyRows[0],
      new TableRow({
        children: [createCell("لا توجد فواتير مشتريات بضاعة مسجلة حتى الآن", { width: 100, align: AlignmentType.CENTER })]
      })
    ]
  });

  // =========================================================================
  // 6. جدول الدفعات النقدية المسددة في الخزينة
  // =========================================================================
  const paymentRows = [
    new TableRow({
      children: [
        createCell("#", { isHeader: true, width: 5 }),
        createCell("العميل", { isHeader: true, width: 30 }),
        createCell("المبلغ المستلم نقداً", { isHeader: true, width: 25 }),
        createCell("تاريخ الاستلام", { isHeader: true, width: 20 }),
        createCell("ملاحظات الدفعة", { isHeader: true, width: 20 })
      ]
    })
  ];

  payments.forEach((p, idx) => {
    const custName = customers.find((c) => c.id === p.customerId)?.name || "عميل غير مسجل";
    paymentRows.push(
      new TableRow({
        children: [
          createCell(String(idx + 1), { align: AlignmentType.CENTER }),
          createCell(custName, { bold: true }),
          createCell(money(p.amount), { bold: true, color: "168575" }),
          createCell(p.date || "-"),
          createCell(p.notes || "-")
        ]
      })
    );
  });

  const paymentsTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: paymentRows.length > 1 ? paymentRows : [
      paymentRows[0],
      new TableRow({
        children: [createCell("لا توجد دفعات نقدية مسجلة حتى الآن", { width: 100, align: AlignmentType.CENTER })]
      })
    ]
  });

  // =========================================================================
  // تجميع الوثيقة بالكامل
  // =========================================================================
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1000,
              bottom: 1000,
              left: 1000,
              right: 1000
            }
          }
        },
        children: [
          titleParagraph,
          subtitleParagraph,

          heading("📊 1. كشف حساب ما يخص المحل وحق المحل والخزينة"),
          shopFinanceTable,

          heading("🔴 2. سجل الشكك والديون المعلقة على العملاء (كشف الآجل)", "C15160"),
          shakakTable,

          heading("👥 3. كشف حساب جميع العملاء والمقاسات والأطوال المسجلة"),
          customersTable,

          heading("📋 4. كشف طلبات التفصيل ومواعيد التسليم"),
          ordersTable,

          heading("📦 5. كشف فواتير ومشتريات البضاعة والخامات (الأقمشة والمستلزمات)"),
          suppliesTable,

          heading("💵 6. سجل الدفعات النقدية المستلمة في الخزينة"),
          paymentsTable,

          new Paragraph({
            alignment: AlignmentType.CENTER,
            bidirectional: true,
            spacing: { before: 400 },
            children: [
              new TextRun({
                text: "تم إنشاء وتنسيق هذا التقرير تلقائياً بواسطة نظام إدارة محل الخياطة",
                size: 16,
                color: "758194",
                font: "Arial",
                rightToLeft: true
              })
            ]
          })
        ]
      }
    ]
  });

  return await Packer.toBuffer(doc);
}

// دالة التوليد والحفظ التلقائي الشهري على جهاز الكمبيوتر
async function autoSaveMonthlyWordReport(data, force = false) {
  try {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const monthKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
    const filename = `تقرير_محل_الخياطة_شهر_${now.getMonth() + 1}_${now.getFullYear()}.docx`;

    const destPath = path.join(REPORTS_DIR, filename);
    const localDestPath = path.join(LOCAL_REPORTS_DIR, filename);

    if (!force && fs.existsSync(destPath)) {
      const stats = fs.statSync(destPath);
      const ageHours = (Date.now() - stats.mtimeMs) / (1000 * 3600);
      if (ageHours < 24) return destPath;
    }

    console.log(`[Word Report] جاري توليد نسخة الوورد التلقائية للشهر (${monthKey})...`);
    const buffer = await generateWordReport(data);

    try {
      fs.writeFileSync(destPath, buffer);
      console.log(`[Word Report] تم حفظ التقرير الشهري بنجاح في: ${destPath}`);
    } catch (e) {
      console.warn("تعذر الحفظ في المجلد الخارجي، الحفظ في المجلد المحلي:", e.message);
    }

    try {
      fs.writeFileSync(localDestPath, buffer);
    } catch {}

    return destPath;
  } catch (err) {
    console.error("[Word Report] خطأ أثناء توليد وحفظ تقرير الوورد:", err);
    return null;
  }
}

module.exports = {
  REPORTS_DIR,
  generateWordReport,
  autoSaveMonthlyWordReport
};
