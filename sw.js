/* ===== Service Worker: التخزين للعمل بدون إنترنت + التنبيهات ===== */
const CACHE = "tailor-v5.9";
const FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./firebase-app.js",
  "./firebase-firestore.js",
  "./firebase-sync.js",
  "./docx.iife.js",
  "./word-generator-client.js",
  "./manifest.json",
  "./widget-template.json",
  "./widget-data.json",
  "./icon-180-v5.8.png",
  "./icon-192-v5.8.png",
  "./icon-512-v5.8.png",
  "./screenshot-mobile-v5.4.png",
  "./screenshot-desktop-v5.4.png",
  "./icon-192-v5.8.png",
  "./icon-512-v5.8.png"
];
const REMINDERS_URL = "./__reminders.json";

// التثبيت: حفظ ملفات التطبيق بشكل مرن لا ينهار عند تعثر أي ملف
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      for (const file of FILES) {
        try {
          await c.add(file);
        } catch (err) {
          console.warn("[SW] تعذر تخزين الملف مسبقاً:", file);
        }
      }
    })
  );
  self.skipWaiting();
});

// التفعيل: حذف النسخ القديمة واستلام التحكم فوراً
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith("tailor-") && k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// الطلبات: تجاهل طلبات إضافات المتصفح (chrome-extension) وتجاهل الـ API
self.addEventListener("fetch", (e) => {
  // 1. استبعاد أي طلبات غير GET
  if (e.request.method !== "GET") return;

  // 2. استبعاد مسارات الـ API لتظل البيانات المالية طازجة ومباشرة من السيرفر
  if (e.request.url.includes("/api/")) return;

  // 3. التحقق من البروتوكول والمصدر (تجاهل chrome-extension:// وأي إضافات خارجية)
  try {
    const url = new URL(e.request.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    if (url.origin !== self.location.origin) return;
  } catch {
    return;
  }

  const requestUrl = new URL(e.request.url);
  const isNavigation = e.request.mode === "navigate";
  const isCoreAsset = ["index.html", "style.css", "app.js", "manifest.json"].some((name) => requestUrl.pathname.endsWith(name));

  if (isNavigation || isCoreAsset) {
    e.respondWith(
      fetch(e.request, { cache: "no-store" })
        .then((res) => {
          if (res && res.status === 200) {
            caches.open(CACHE).then((c) => c.put(e.request, res.clone()).catch(() => {})).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(e.request).then((match) => match || caches.match("./index.html")))
    );
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => {
            c.put(e.request, copy).catch(() => {});
          }).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((match) => match || caches.match("./index.html")))
  );
});

// فحص المواعيد: أي طلب تسليمه غداً أو متأخر -> إشعار فوري
async function checkReminders() {
  try {
    const cache = await caches.open("tailor-data");
    const res = await cache.match(REMINDERS_URL);
    if (!res) return;
    const data = await res.json();
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const notified = new Set(data.notified || []);

    for (const o of data.orders || []) {
      if (o.dueDate <= tomorrow && !notified.has(o.id)) {
        await self.registration.showNotification("موعد تسليم خياطة ⏰", {
          body: `${o.type} - ${o.name} (تاريخ التسليم: ${o.dueDate})`,
          icon: "icon-192-v5.8.png",
          badge: "icon-192-v5.8.png",
          tag: "order-" + o.id,
          dir: "rtl",
          lang: "ar"
        });
        notified.add(o.id);
      }
    }
    data.notified = [...notified];
    await cache.put(REMINDERS_URL, new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } }));
  } catch (e) {
    console.warn("[SW] فحص المواعيد:", e);
  }
}

// رسالة من التطبيق لطلب الفحص فوراً
self.addEventListener("message", (e) => {
  if (e.data === "check-reminders") {
    e.waitUntil(checkReminders());
  }
  if (e.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// فحص دوري في الخلفية (متاح في Chrome/Android عند تثبيت التطبيق)
self.addEventListener("periodicsync", (e) => {
  if (e.tag === "check-reminders") {
    e.waitUntil(checkReminders());
  }
});

// مزامنة عند عودة الاتصال بالشبكة
self.addEventListener("sync", (e) => {
  if (e.tag === "tailor-background-sync") {
    e.waitUntil(checkReminders());
  }
});

// دعم الإشعارات الواردة من مزود خارجي دون الاعتماد على بيانات حساسة
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = {}; }
  const title = data.title || "المعلم للخياطة";
  const options = {
    body: data.body || "هناك تحديث جديد في تطبيق المعلم للخياطة",
    icon: "./icon-192-v5.8.png",
    badge: "./icon-192-v5.8.png",
    data: { url: data.url || "./" },
    tag: data.tag || "tailor-update",
    renotify: true
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// الضغط على الإشعار يفتح التطبيق
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window" }).then((list) =>
      list.length ? list[0].focus() : self.clients.openWindow("./index.html")
    )
  );
});
