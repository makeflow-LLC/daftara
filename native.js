/* ================= دفترة — تطبيق أندرويد =================
   نفس ملفات الويب تعمل داخل تطبيق أندرويد (Capacitor). هذا الملف يضيف
   ما لا يقدر عليه المتصفح، ولا يفعل شيئًا حين يُفتح التطبيق من الرابط:

   1. نسخة احتياطية تلقائية: بعد كل تعديل يُكتب ملف اليوم في
      Documents/Daftara/ على ذاكرة الجوال. تبقى هذه الملفات حتى لو مُسحت
      بيانات التطبيق أو حُذف التطبيق نفسه، وتُستعاد بزر «استعادة نسخة».
   2. مشاركة ملف النسخة (واتساب وغيره) عبر شاشة المشاركة في أندرويد،
      لأن WebView لا يدعم navigator.share.

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
  ['addCustomer', 'updateCustomer', 'deleteCustomer',
   'addTransaction', 'deleteTransaction', 'importAll'].forEach(function (k) {
    var fn = DB[k];
    DB[k] = function () {
      return fn.apply(DB, arguments).then(function (v) { schedule(); return v; });
    };
  });

  // يُستدعى بعد فتح قاعدة البيانات
  Native.start = function () {
    running = running.then(autoBackup).then(prune);
  };

  // مشاركة ملف النسخة: يُكتب في الكاش ثم تُفتح شاشة المشاركة.
  // يعيد true عند المشاركة، وnull إن ألغاها المستخدم.
  Native.shareBackup = function (filename, json) {
    return FS.writeFile({
      path: filename,
      data: json,
      directory: 'CACHE',
      encoding: 'utf8'
    }).then(function (res) {
      return Share.share({ title: 'نسخة احتياطية — دفترة', files: [res.uri] });
    }).then(function () { return true; }, function (err) {
      if (/cancel/i.test((err && err.message) || '')) return null;
      throw err;
    });
  };
})(window);
