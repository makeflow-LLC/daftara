/* ================= دفترة — تطبيق أندرويد =================
   نفس ملفات الويب تعمل داخل تطبيق أندرويد (Capacitor). هذا الملف يضيف
   ما لا يقدر عليه المتصفح، ولا يفعل شيئًا حين يُفتح التطبيق من الرابط:

   1. نسخة احتياطية تلقائية: بعد كل تعديل يُكتب ملف اليوم في
      Documents/Daftara/ على ذاكرة الجوال. تبقى هذه الملفات حتى لو مُسحت
      بيانات التطبيق أو حُذف التطبيق نفسه، وتُستعاد بزر «استعادة نسخة».
   2. مشاركة ملف النسخة (واتساب وغيره) عبر شاشة المشاركة في أندرويد،
      لأن WebView لا يدعم navigator.share.
   3. حفظ النسخة في مكان يختاره صاحب المحل (منتقي ملفات أندرويد)، وفتح ملفات
      النسخ (.json) بـ «فتح بواسطة دفترة» — في android/.../DaftaraFilesPlugin.java.
   4. إشعارات محلية: تذكيرات الزبائن والتنبيه اليومي بالمتأخرين.
   5. قفل التطبيق بالبصمة، ورمز قفل الجوال بديلًا حتى لا يُحبس صاحب المحل
      خارج دفتره إن لم تُقرأ البصمة.

   اسم الملف يحمل معرّف الدفتر (ledgerId)، فلو مُسحت البيانات وبدأ دفتر
   جديد فارغ في نفس اليوم لا يكتب فوق نسخة الدفتر القديم.
================================================================ */
(function (global) {
  'use strict';

  var cap = global.Capacitor;
  var isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());

  var Native = { isNative: isNative };
  global.Native = Native;
  if (!isNative) return;

  var FS = cap.Plugins.Filesystem;
  var Share = cap.Plugins.Share;
  var Bio = cap.Plugins.NativeBiometric;
  var App = cap.Plugins.App;
  var Files = cap.Plugins.DaftaraFiles;
  var LN = cap.Plugins.LocalNotifications;
  var DIR = 'Daftara';
  var KEEP_DAYS = 30;
  var DEBOUNCE_MS = 2000;

  // آخر نتيجة للنسخ التلقائي، لعرضها في الإعدادات: {at, file} أو {error}
  Native.auto = null;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function ledgerId() {
    return DB.getSettings().then(function (s) {
      if (s.ledgerId) return s.ledgerId;
      var id = Math.random().toString(36).slice(2, 8);
      return DB.setSetting('ledgerId', id).then(function () { return id; });
    });
  }

  // أندرويد 11+ لا يسمح بالكتابة فوق ملف أنشأه تثبيت سابق للتطبيق؛
  // عندها نكتب باسم بديل ونستمر عليه بقية اليوم.
  var altName = {};

  function write(name, json) {
    return FS.writeFile({
      path: DIR + '/' + name,
      data: json,
      directory: 'DOCUMENTS',
      encoding: 'utf8',
      recursive: true
    });
  }

  function autoBackup() {
    return Promise.all([DB.exportAll(), ledgerId()]).then(function (r) {
      var data = r[0];
      // دفتر فارغ لا يستحق ملفًا
      if (!data.customers.length && !data.transactions.length) return;
      var json = JSON.stringify(data);
      var base = 'daftara-' + today() + '-' + r[1];
      var name = altName[base] || base + '.json';
      return write(name, json).catch(function () {
        name = base + '-' + Date.now().toString(36) + '.json';
        altName[base] = name;
        return write(name, json);
      }).then(function () {
        Native.auto = { at: new Date().toISOString(), file: 'Documents/' + DIR + '/' + name };
      });
    }).catch(function (err) {
      Native.auto = { error: (err && err.message) || String(err) };
      console.error('daftara auto backup failed: ' + Native.auto.error);
    });
  }

  var timer = null;
  var running = Promise.resolve();
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      running = running.then(autoBackup);
    }, DEBOUNCE_MS);
  }

  // حذف النسخ التلقائية الأقدم من KEEP_DAYS يومًا (ملفات هذا التثبيت فقط)
  function prune() {
    var cutoff = Date.now() - KEEP_DAYS * 86400000;
    return FS.readdir({ path: DIR, directory: 'DOCUMENTS' }).then(function (res) {
      return Promise.all((res.files || []).map(function (f) {
        var name = typeof f === 'string' ? f : f.name;
        var m = /^daftara-(\d{4})-(\d{2})-(\d{2})-/.exec(name || '');
        if (!m || new Date(+m[1], +m[2] - 1, +m[3]).getTime() >= cutoff) return null;
        return FS.deleteFile({ path: DIR + '/' + name, directory: 'DOCUMENTS' }).catch(function () {});
      }));
    }).catch(function () {});
  }

  // كل تعديل على البيانات يجدول نسخة تلقائية
  ['addCustomer', 'updateCustomer', 'setReminder', 'deleteCustomer',
   'addTransaction', 'updateTransaction', 'deleteTransaction', 'importAll', 'mergeAll'].forEach(function (k) {
    var fn = DB[k];
    DB[k] = function () {
      return fn.apply(DB, arguments).then(function (v) { schedule(); return v; });
    };
  });

  // يُستدعى بعد فتح قاعدة البيانات
  Native.start = function () {
    running = running.then(autoBackup).then(prune);
  };

  /* ---------- القفل بالبصمة ---------- */
  // هل في الجوال بصمة أو رمز قفل يمكن التحقق به؟
  Native.canLock = function () {
    if (!Bio) return Promise.resolve(false);
    return Bio.isAvailable({ useFallback: true })
      .then(function (r) { return !!(r && r.isAvailable); }, function () { return false; });
  };

  // يعرض نافذة البصمة؛ يعيد true عند النجاح وfalse عند الإلغاء أو الفشل
  Native.verify = function () {
    return Bio.verifyIdentity({
      title: 'افتح دفترة',
      subtitle: 'بالبصمة أو برمز قفل الجوال',
      // 4 = أي بصمة/وجه، 7 = رمز قفل الجوال (PIN أو النمط) بديلًا
      allowedBiometryTypes: [4, 7],
      maxAttempts: 5
    }).then(function () { return true; }, function () { return false; });
  };

  // يُستدعى عند عودة التطبيق إلى الواجهة، مع مدة الغياب بالملّي ثانية
  Native.onResume = function (cb) {
    if (!App) return;
    var hiddenAt = 0;
    App.addListener('appStateChange', function (st) {
      if (!st.isActive) { hiddenAt = Date.now(); return; }
      if (hiddenAt) cb(Date.now() - hiddenAt);
      hiddenAt = 0;
    });
  };

  /* ---------- الحفظ والفتح ---------- */
  // إضافة الملفات من كود التطبيق نفسه (DaftaraFilesPlugin.java)؛ نتحقق منها احتياطًا
  if (Files) {
    // يعيد true إن حُفظ الملف، وfalse إن أغلق صاحب المحل المنتقي دون حفظ
    // f: {name, mime, text} أو {name, mime, base64}
    Native.saveAs = function (f) {
      return Files.saveAs({ filename: f.name, mime: f.mime, data: f.text, base64: f.base64 })
        .then(function (r) { return !!r.saved; });
    };

    // ملف فُتح بـ «فتح بواسطة دفترة»: {name, text} أو null
    Native.takeOpenedFile = function () {
      return Files.takeOpenedFile().then(function (r) { return r && r.text != null ? r : null; });
    };
    Native.onFileOpened = function (cb) { Files.addListener('fileOpened', cb); };
  }

  /* ---------- الإشعارات المحلية (بلا إنترنت) ---------- */
  if (LN) {
    Native.notifGranted = function () {
      return LN.checkPermissions().then(function (r) { return r.display === 'granted'; }, function () { return false; });
    };
    Native.requestNotif = function () {
      return LN.requestPermissions().then(function (r) { return r.display === 'granted'; }, function () { return false; });
    };
    // يلغي كل ما جُدول سابقًا ويجدول القائمة الجديدة: [{id, title, body, at, extra}]
    Native.syncNotifications = function (list) {
      return LN.getPending().then(function (p) {
        var old = (p && p.notifications) || [];
        return old.length ? LN.cancel({ notifications: old.map(function (n) { return { id: n.id }; }) }) : null;
      }).then(function () {
        if (!list.length) return null;
        return LN.schedule({ notifications: list.map(function (n) {
          return {
            id: n.id, title: n.title, body: n.body, extra: n.extra,
            schedule: { at: new Date(n.at), allowWhileIdle: true },
            // لا حاجة لدقة الدقيقة: بدونها لا يُطلب إذن «المنبّهات الدقيقة»
            isExactNotification: false,
            smallIcon: 'ic_stat_daftara', iconColor: '#0E7A51'
          };
        }) });
      });
    };
    Native.onNotificationTap = function (cb) {
      LN.addListener('localNotificationActionPerformed', function (a) {
        cb(a && a.notification && a.notification.extra);
      });
    };
  }

  // مشاركة ملف (نسخة احتياطية أو كشف PDF): يُكتب في الكاش ثم تُفتح شاشة المشاركة.
  // يعيد true عند المشاركة، وnull إن ألغاها المستخدم.
  Native.shareFile = function (f) {
    var opts = { path: f.name, directory: 'CACHE', data: f.base64 != null ? f.base64 : f.text };
    if (f.base64 == null) opts.encoding = 'utf8';   // بدون encoding تُعامل البيانات كـ base64
    return FS.writeFile(opts).then(function (res) {
      return Share.share({ title: f.title || f.name, files: [res.uri] });
    }).then(function () { return true; }, function (err) {
      if (/cancel/i.test((err && err.message) || '')) return null;
      throw err;
    });
  };
})(window);
