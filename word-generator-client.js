/**
 * ============================================================================
 * مولد تقارير Word الشاملة للعميل والمحل يعمل مباشرة داخل المتصفح
 * متوافق 100% مع GitHub Pages وجميع الأجهزة (موبايل، تابلت، كمبيوتر)
 * ============================================================================
 */

(function (window) {
  "use strict";

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

  function createCell(docx, text, options = {}) {
    const { TableCell, Paragraph, TextRun, WidthType, AlignmentType, ShadingType } = docx;
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

  async function generateAndDownloadClientWordReport(data, customFilename = null) {
    if (!window.docx) {
      throw new Error("مكتبة توليد الوورد لم تُحمّل بعد في المتصفح");
    }

    const { Document, Packer, Paragraph, TextRun, Table, TableRow, WidthType, AlignmentType } = window.docx;

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

    // 1. الحسابات المالية
    const deposits = orders.reduce((s, o) => s + num(o.deposit), 0);
    const directPayments = payments.reduce((s, p) => s + num(p.amount), 0);
    const totalCashCollected = deposits + directPayments;
    const totalSuppliesSpent = supplies.reduce((s, x) => s + num(x.totalPrice), 0);
    const netProfit = totalCashCollected - totalSuppliesSpent;
    const totalOrdersAmount = orders.reduce((s, o) => s + num(o.price), 0);

    const customerAccounts = customers.map((c) => {
      const custOrders = orders.filter((o) => o.customerId === c.id);
      const orderTotal = custOrders.reduce((s, o) => s + num(o.price), 0);
      const orderDeposits = custOrders.reduce((s, o) => s + num(o.deposit), 0);
      const custPayments = payments.filter((p) => p.customerId === c.id).reduce((s, p) => s + num(p.amount), 0);
      const totalPaid = orderDeposits + custPayments;
      const remaining = Math.max(0, orderTotal - totalPaid);
      return { customer: c, orders: custOrders, orderTotal, totalPaid, remaining };
    });

    const debtAccounts = customerAccounts.filter((x) => x.remaining > 0);
    const totalRemainingDebt = debtAccounts.reduce((s, x) => s + x.remaining, 0);

    const activeOrdersCount = orders.filter((o) => o.status !== "تم التسليم").length;
    const deliveredOrdersCount = orders.length - activeOrdersCount;

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

    // 1. جدول ما يخص المحل
    const shopFinanceTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            createCell(window.docx, "البيان المالي لحسابات المحل (حق المحل)", { isHeader: true, width: 60 }),
            createCell(window.docx, "القيمة بالجنيه المصري", { isHeader: true, width: 40 })
          ]
        }),
        new TableRow({
          children: [
            createCell(window.docx, "💵 إجمالي المحصّل نقداً في الخزينة والدرج (عربين + دفعات)", { bold: true }),
            createCell(window.docx, money(totalCashCollected), { bold: true, color: "168575" })
          ]
        }),
        new TableRow({
          children: [
            createCell(window.docx, "📦 إجمالي مصروف مشتريات البضاعة والخامات (أقمشة ومستلزمات)", { bold: true }),
            createCell(window.docx, money(totalSuppliesSpent), { bold: true, color: "C15160" })
          ]
        }),
        new TableRow({
          children: [
            createCell(window.docx, "🏆 صافي ربح المحل الفعلي المحقق (المحصّل − مشتريات البضاعة)", { bold: true, bg: "E8F5F1" }),
            createCell(window.docx, money(netProfit), { bold: true, color: netProfit >= 0 ? "168575" : "C15160", bg: "E8F5F1", size: 21 })
          ]
        }),
        new TableRow({
          children: [
            createCell(window.docx, "⏳ إجمالي الشكك والديون المعلقة على الزبائن (حقوق المحل في السوق)", { bold: true, bg: "FFF8E7" }),
            createCell(window.docx, money(totalRemainingDebt), { bold: true, color: "B58527", bg: "FFF8E7", size: 21 })
          ]
        }),
        new TableRow({
          children: [
            createCell(window.docx, "📊 إجمالي القيمة الإنتاجية لأعمال المحل (شغل كاش + شكك)", {}),
            createCell(window.docx, money(totalOrdersAmount), { bold: true })
          ]
        }),
        new TableRow({
          children: [
            createCell(window.docx, "📋 حركة الطلبات في المحل", {}),
            createCell(window.docx, `${orders.length.toLocaleString("ar-EG")} طلب (${activeOrdersCount} قيد التنفيذ · ${deliveredOrdersCount} مسلّم)`, {})
          ]
        })
      ]
    });

    // 2. جدول الشكك والديون
    const shakakRows = [
      new TableRow({
        children: [
          createCell(window.docx, "#", { isHeader: true, width: 5, bg: "C15160" }),
          createCell(window.docx, "اسم العميل المدين", { isHeader: true, width: 25, bg: "C15160" }),
          createCell(window.docx, "رقم الهاتف / العنوان", { isHeader: true, width: 22, bg: "C15160" }),
          createCell(window.docx, "إجمالي حسابه", { isHeader: true, width: 16, bg: "C15160" }),
          createCell(window.docx, "المسدد كاش", { isHeader: true, width: 16, bg: "C15160" }),
          createCell(window.docx, "المتبقي (الشكك المطلوب)", { isHeader: true, width: 16, bg: "C15160" })
        ]
      })
    ];

    if (debtAccounts.length > 0) {
      debtAccounts.forEach((da, idx) => {
        const c = da.customer;
        shakakRows.push(
          new TableRow({
            children: [
              createCell(window.docx, String(idx + 1), { align: AlignmentType.CENTER }),
              createCell(window.docx, c.name, { bold: true }),
              createCell(window.docx, `${c.phone || "بدون هاتف"}${c.address ? " · " + c.address : ""}`),
              createCell(window.docx, money(da.orderTotal)),
              createCell(window.docx, money(da.totalPaid), { color: "168575" }),
              createCell(window.docx, money(da.remaining), { bold: true, color: "C15160", bg: "FFF0F0" })
            ]
          })
        );
      });
      shakakRows.push(
        new TableRow({
          children: [
            createCell(window.docx, "المجموع", { bold: true, align: AlignmentType.CENTER, bg: "FFF0F0" }),
            createCell(window.docx, `إجمالي عدد الزبائن المدينين: ${debtAccounts.length.toLocaleString("ar-EG")}`, { bold: true, bg: "FFF0F0" }),
            createCell(window.docx, "-", { align: AlignmentType.CENTER, bg: "FFF0F0" }),
            createCell(window.docx, money(debtAccounts.reduce((s, x) => s + x.orderTotal, 0)), { bold: true, bg: "FFF0F0" }),
            createCell(window.docx, money(debtAccounts.reduce((s, x) => s + x.totalPaid, 0)), { bold: true, color: "168575", bg: "FFF0F0" }),
            createCell(window.docx, money(totalRemainingDebt), { bold: true, color: "C15160", bg: "FFF0F0", size: 21 })
          ]
        })
      );
    } else {
      shakakRows.push(
        new TableRow({
          children: [
            createCell(window.docx, "✅ لا توجد أي مبالغ شكك أو ديون معلقة على الزبائن (كافة الحسابات مسددة بالكامل والحمد لله)", {
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

    // 3. جدول العملاء والمقاسات
    const customerRows = [
      new TableRow({
        children: [
          createCell(window.docx, "#", { isHeader: true, width: 4 }),
          createCell(window.docx, "اسم العميل", { isHeader: true, width: 18 }),
          createCell(window.docx, "الهاتف / العنوان", { isHeader: true, width: 18 }),
          createCell(window.docx, "الحساب المالي (المسدد / الباقي)", { isHeader: true, width: 22 }),
          createCell(window.docx, "المقاسات والأطوال المسجلة (طول، خزنه، سفرة، كم، حجر...)", { isHeader: true, width: 38 })
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
          : `إجمالي: ${money(ca.orderTotal)}\nمسدد: ${money(ca.totalPaid)}\n(خالص الحساب)`;

      customerRows.push(
        new TableRow({
          children: [
            createCell(window.docx, String(idx + 1), { align: AlignmentType.CENTER }),
            createCell(window.docx, c.name, { bold: true }),
            createCell(window.docx, `${c.phone || "بدون هاتف"}${c.address ? "\n" + c.address : ""}`),
            createCell(window.docx, financialText, {
              bold: ca.remaining > 0,
              color: ca.remaining > 0 ? "C15160" : "168575",
              bg: ca.remaining > 0 ? "FFFDFC" : "FFFFFF"
            }),
            createCell(window.docx, measureText)
          ]
        })
      );
    });

    const customersTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: customerRows.length > 1 ? customerRows : [
        customerRows[0],
        new TableRow({
          children: [createCell(window.docx, "لا يوجد عملاء مسجلين حتى الآن", { width: 100, align: AlignmentType.CENTER })]
        })
      ]
    });

    // 4. جدول الطلبات
    const orderRows = [
      new TableRow({
        children: [
          createCell(window.docx, "#", { isHeader: true, width: 5 }),
          createCell(window.docx, "العميل", { isHeader: true, width: 20 }),
          createCell(window.docx, "نوع القطعة والمواصفات", { isHeader: true, width: 28 }),
          createCell(window.docx, "السعر / العربون / الباقي", { isHeader: true, width: 22 }),
          createCell(window.docx, "موعد التسليم", { isHeader: true, width: 13 }),
          createCell(window.docx, "الحالة", { isHeader: true, width: 12 })
        ]
      })
    ];

    orders.forEach((o, idx) => {
      const custName = customers.find((c) => c.id === o.customerId)?.name || "عميل غير مسجل";
      const remainingOnOrder = Math.max(0, num(o.price) - num(o.deposit));
      orderRows.push(
        new TableRow({
          children: [
            createCell(window.docx, String(idx + 1), { align: AlignmentType.CENTER }),
            createCell(window.docx, custName, { bold: true }),
            createCell(window.docx, `${o.type || "تفصيل"}${o.desc ? " - " + o.desc : ""}`),
            createCell(window.docx, `السعر: ${money(o.price)}\nالعربون: ${money(o.deposit)}${remainingOnOrder > 0 ? `\nالباقي: ${money(remainingOnOrder)}` : "\n(مسدد)"}`),
            createCell(window.docx, o.dueDate || "-"),
            createCell(window.docx, o.status || "تحت التنفيذ", {
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
          children: [createCell(window.docx, "لا توجد طلبات مسجلة حتى الآن", { width: 100, align: AlignmentType.CENTER })]
        })
      ]
    });

    // 5. جدول مشتريات البضاعة
    const supplyRows = [
      new TableRow({
        children: [
          createCell(window.docx, "#", { isHeader: true, width: 5 }),
          createCell(window.docx, "اسم البضاعة / الخامة", { isHeader: true, width: 25 }),
          createCell(window.docx, "التصنيف", { isHeader: true, width: 14 }),
          createCell(window.docx, "الكمية والوحدة", { isHeader: true, width: 14 }),
          createCell(window.docx, "سعر الوحدة", { isHeader: true, width: 14 }),
          createCell(window.docx, "الإجمالي ككل", { isHeader: true, width: 14 }),
          createCell(window.docx, "تاريخ الشراء والمورد", { isHeader: true, width: 14 })
        ]
      })
    ];

    supplies.forEach((s, idx) => {
      supplyRows.push(
        new TableRow({
          children: [
            createCell(window.docx, String(idx + 1), { align: AlignmentType.CENTER }),
            createCell(window.docx, `${s.name}${s.notes ? " (" + s.notes + ")" : ""}`, { bold: true }),
            createCell(window.docx, s.category || "أقمشة"),
            createCell(window.docx, `${s.quantity || 1} ${s.unit || "متر"}`),
            createCell(window.docx, money(s.unitPrice)),
            createCell(window.docx, money(s.totalPrice), { bold: true, color: "C15160" }),
            createCell(window.docx, `${s.date || "-"}${s.supplier ? "\n" + s.supplier : ""}`)
          ]
        })
      );
    });

    const suppliesTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: supplyRows.length > 1 ? supplyRows : [
        supplyRows[0],
        new TableRow({
          children: [createCell(window.docx, "لا توجد فواتير مشتريات بضاعة مسجلة حتى الآن", { width: 100, align: AlignmentType.CENTER })]
        })
      ]
    });

    // 6. جدول الدفعات
    const paymentRows = [
      new TableRow({
        children: [
          createCell(window.docx, "#", { isHeader: true, width: 5 }),
          createCell(window.docx, "العميل", { isHeader: true, width: 30 }),
          createCell(window.docx, "المبلغ المستلم نقداً", { isHeader: true, width: 25 }),
          createCell(window.docx, "تاريخ الاستلام", { isHeader: true, width: 20 }),
          createCell(window.docx, "ملاحظات الدفعة", { isHeader: true, width: 20 })
        ]
      })
    ];

    payments.forEach((p, idx) => {
      const custName = customers.find((c) => c.id === p.customerId)?.name || "عميل غير مسجل";
      paymentRows.push(
        new TableRow({
          children: [
            createCell(window.docx, String(idx + 1), { align: AlignmentType.CENTER }),
            createCell(window.docx, custName, { bold: true }),
            createCell(window.docx, money(p.amount), { bold: true, color: "168575" }),
            createCell(window.docx, p.date || "-"),
            createCell(window.docx, p.notes || "-")
          ]
        })
      );
    });

    const paymentsTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: paymentRows.length > 1 ? paymentRows : [
        paymentRows[0],
        new TableRow({
          children: [createCell(window.docx, "لا توجد دفعات نقدية مسجلة حتى الآن", { width: 100, align: AlignmentType.CENTER })]
        })
      ]
    });

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
            new Paragraph({
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
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              bidirectional: true,
              spacing: { after: 200 },
              children: [
                new TextRun({
                  text: `التقرير المالي والإداري الشامل - ${monthName}`,
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
            }),

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
            paymentsTable
          ]
        }
      ]
    });

    const blob = await Packer.toBlob(doc);
    const fileName = customFilename || `تقرير_محل_الخياطة_شهر_${now.getMonth() + 1}_${now.getFullYear()}.docx`;

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(a.href);
    }, 1500);

    return true;
  }

  window.generateAndDownloadClientWordReport = generateAndDownloadClientWordReport;
})(window);
