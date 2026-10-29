/**
 * سكربت توليد وحفظ تقرير الوورد الشهري التلقائي لمحل الخياطة
 * يمكن تشغيله مباشرة عبر Node.js أو عبر Windows Task Scheduler
 */

const fs = require("fs");
const path = require("path");
const { autoSaveMonthlyWordReport, REPORTS_DIR } = require("./word-report");

async function main() {
  console.log("====================================================");
  console.log("📄 جاري توليد تقرير Word الشامل لمحل الخياطة...");
  console.log("====================================================");

  const dbFile = path.join(__dirname, "data", "database.json");
  if (!fs.existsSync(dbFile)) {
    console.error("❌ ملف قاعدة البيانات غير موجود في:", dbFile);
    process.exit(1);
  }

  let db;
  try {
    const raw = fs.readFileSync(dbFile, "utf-8");
    db = JSON.parse(raw);
  } catch (err) {
    console.error("❌ فشل قراءة قاعدة البيانات:", err.message);
    process.exit(1);
  }

  try {
    const savedPath = await autoSaveMonthlyWordReport(db, true);
    console.log("✅ تم توليد وحفظ التقرير الشهري بنجاح في جهازك!");
    console.log("📁 المسار:", savedPath || REPORTS_DIR);
    console.log("====================================================");
  } catch (err) {
    console.error("❌ حدث خطأ أثناء التوليد:", err);
    process.exit(1);
  }
}

main();
