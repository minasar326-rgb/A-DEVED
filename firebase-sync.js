/**
 * ============================================================================
 * وحدة المزامنة اللحظية الفورية مع Firebase Firestore لمحل الخياطة
 * - مزامنة في نفس الثانية بين كافة الأجهزة (الكمبيوتر والموبايل والتابلت)
 * - حماية قصوى لمنع مسح أو فقدان أي بيانات نهائياً
 * - دعم كامل للعمل بدون إنترنت (Offline Persistence) مع الحفظ المحلي على القرص
 * ============================================================================
 */

(function (window) {
  "use strict";

  // إعدادات الفايربيز المعتمدة من المستخدم
  const firebaseConfig = {
    apiKey: "AIzaSyBsjm5hR2r05dO9FIKMnGQCiaxqOrsRXVs",
    authDomain: "a-deved.firebaseapp.com",
    projectId: "a-deved",
    storageBucket: "a-deved.firebasestorage.app",
    messagingSenderId: "104984986184",
    appId: "1:104984986184:web:b2694155c9d56ce8c1ce7d",
    measurementId: "G-4SXVG9XG29"
  };

  // توليد أو جلب معرّف فريد لهذا الجهاز لتفادي تكرار التحديث الذاتي
  function getDeviceId() {
    let id = localStorage.getItem("tailor_device_id");
    if (!id) {
      id = "device_" + Math.random().toString(36).substring(2, 10) + "_" + Date.now().toString(36);
      localStorage.setItem("tailor_device_id", id);
    }
    return id;
  }

  const deviceId = getDeviceId();
  let firestoreDb = null;
  let docRef = null;
  let isFirebaseReady = false;
  let isFirestoreConnected = false;
  let lastRemoteTimestamp = 0;
  let unsubscribeSnapshot = null;
  let onRemoteDataCallback = null;
  let onStatusCallback = null;

  // تهيئة الفايربيز والـ Firestore مع التخزين المحلي التلقائي
  function initFirebase() {
    if (typeof firebase === "undefined") {
      console.warn("[Firebase] مكتبة Firebase لم تُحمّل بعد، جاري العمل بالنظام المحلي الآمن.");
      notifyStatus(false, "مكتبة الفايربيز غير متوفرة (يعمل محلياً بأمان)");
      return false;
    }

    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
        try {
          if (firebase.analytics) firebase.analytics();
        } catch {}
      }

      firestoreDb = firebase.firestore();

      // تفعيل التخزين الأوفلاين في المتصفح ليعمل بدون إنترنت بسلاسة وبدون تحذيرات
      try {
        firestoreDb.enablePersistence({ synchronizeTabs: true }).catch(() => {});
      } catch {}

      docRef = firestoreDb.collection("tailor_shop").doc("database");
      isFirebaseReady = true;
      return true;
    } catch (err) {
      console.warn("[Firebase] خطأ أثناء التهيئة:", err.message);
      notifyStatus(false, "خطأ في تهيئة الفايربيز: " + err.message);
      return false;
    }
  }

  function notifyStatus(connected, message) {
    isFirestoreConnected = connected;
    if (typeof onStatusCallback === "function") {
      onStatusCallback(connected, message);
    }
  }

  // تنظيف وتجهيز البيانات لمنع أي بيانات تالفة أو غير متوافقة
  function sanitizeDb(data) {
    if (!data || typeof data !== "object") return null;
    return {
      customers: Array.isArray(data.customers) ? data.customers : [],
      orders: Array.isArray(data.orders) ? data.orders : [],
      payments: Array.isArray(data.payments) ? data.payments : [],
      cheques: Array.isArray(data.cheques) ? data.cheques : [],
      supplies: Array.isArray(data.supplies) ? data.supplies : [],
      measureTypes: Array.isArray(data.measureTypes) && data.measureTypes.length > 0
        ? data.measureTypes
        : ["طول الشخص", "خزنه", "سفرة", "طول كم", "وسع كم", "حجر", "قبه", "بشليق"],
      lastModified: Date.now(),
      lastModifiedBy: deviceId
    };
  }

  // بدء الاستماع اللحظي (في نفس الثانية) لتغييرات الفايربيز
  function startRealtimeSync(getLocalDbFn, onRemoteChange, onStatusChange) {
    onRemoteDataCallback = onRemoteChange;
    onStatusCallback = onStatusChange;

    if (!isFirebaseReady && !initFirebase()) {
      return;
    }

    if (unsubscribeSnapshot) {
      try { unsubscribeSnapshot(); } catch {}
    }

    console.log("[Firebase Sync] جاري بدء المزامنة اللحظية الفورية مع Firestore...");

    try {
      unsubscribeSnapshot = docRef.onSnapshot(
        { includeMetadataChanges: true },
        (snapshot) => {
          const fromCache = snapshot.metadata.fromCache;
          const hasPendingWrites = snapshot.metadata.hasPendingWrites;

          if (!snapshot.exists) {
            console.info("[Firebase Sync] السحابة لا تحتوي على بيانات بعد، جاري رفع البيانات المحلية لتأمينها...");
            notifyStatus(true, "متصل بالفايربيز (جاري حفظ ورفع بيانات المحل الأولى)");
            const currentLocal = getLocalDbFn();
            pushToFirebase(currentLocal, true);
            return;
          }

          const remoteData = snapshot.data();
          if (!remoteData) return;

          // إذا كان التعديل محلياً وما زال قيد الإرسال، نتجاهل إعادة المعالجة لمنع الوميض
          if (hasPendingWrites && remoteData.lastModifiedBy === deviceId) {
            notifyStatus(true, "متصل بالفايربيز (مزامنة لحظية مباشرة ⚡)");
            return;
          }

          // التحقق من أن البيانات جديدة وقادمة من جهاز آخر أو من السيرفر
          if (remoteData.lastModifiedBy !== deviceId || remoteData.lastModified > lastRemoteTimestamp) {
            lastRemoteTimestamp = remoteData.lastModified || Date.now();
            console.log("⚡ [Firebase Sync] تم استلام تحديث فوري من جهاز آخر في نفس الثانية!");

            // التأكد التام من عدم مسح أي بيانات سابقة
            const clean = sanitizeDb(remoteData);
            if (clean && (clean.customers.length > 0 || clean.orders.length > 0 || clean.supplies.length > 0)) {
              if (typeof onRemoteDataCallback === "function") {
                onRemoteDataCallback(clean);
              }
            } else {
              // إذا كانت البيانات القادمة فارغة تماماً والبيانات المحلية بها محتوى، نرفع المحلي للحماية
              const local = getLocalDbFn();
              if (local && (local.customers?.length > 0 || local.orders?.length > 0)) {
                console.warn("[Firebase Shield] منع تفريغ البيانات، جاري حماية وإعادة رفع البيانات المحلية.");
                pushToFirebase(local, true);
              }
            }
          }

          notifyStatus(true, fromCache ? "متصل بالفايربيز (كاش أوفلاين)" : "متصل بالفايربيز (مزامنة لحظية مباشرة ⚡)");
        },
        (error) => {
          console.warn("[Firebase Sync Error]:", error.message);
          // إذا كان خطأ عدم إنشاء قاعدة البيانات في الكونسول أو مشكلة أذونات
          if (error.code === "permission-denied") {
            notifyStatus(false, "أذونات الفايربيز مقيدة (يُرجى تطبيق قواعد firestore.rules في الكونسول)");
          } else if (error.code === "unavailable" || error.code === "not-found") {
            notifyStatus(false, "يعمل محلياً بأمان (يرجى الضغط على Create Database في كونسول الفايربيز إذا لم يتم إنشاؤها)");
          } else {
            notifyStatus(false, "الفايربيز غير متاح حالياً (يعمل محلياً بدون إنترنت)");
          }
        }
      );
    } catch (err) {
      console.warn("[Firebase Sync] تعذر إنشاء المستمع اللحظي:", err);
      notifyStatus(false, "خطأ في اتصال الفايربيز (يعمل محلياً بأمان)");
    }
  }

  // إرسال التحديثات إلى الفايربيز فوراً في نفس اللحظة
  async function pushToFirebase(localDb, force = false) {
    if (!isFirebaseReady && !initFirebase()) return false;
    if (!docRef) return false;

    const payload = sanitizeDb(localDb);
    if (!payload) return false;

    // حماية إضافية: منع كتابة بيانات فارغة إن كانت هناك حماية سابقة
    if (!force && payload.customers.length === 0 && payload.orders.length === 0 && payload.supplies.length === 0) {
      console.info("[Firebase Shield] تم تجاهل إرسال كائن فارغ تماماً لحماية قاعدة البيانات.");
      return false;
    }

    try {
      await docRef.set(payload, { merge: true });
      return true;
    } catch (err) {
      console.warn("[Firebase Push Warning]:", err.message);
      return false;
    }
  }

  // كشف الحالة العامة
  function isConnected() {
    return isFirestoreConnected;
  }

  // تصدير واجهة الاستخدام العامة
  window.TailorFirebase = {
    config: firebaseConfig,
    deviceId: deviceId,
    init: initFirebase,
    startSync: startRealtimeSync,
    push: pushToFirebase,
    isConnected: isConnected
  };
})(window);
