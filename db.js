/* ================= دفتر الديون — طبقة البيانات =================
   IndexedDB عبر Dexie. لا يوجد خادم ولا حساب: كل شيء على الجهاز.
   الجداول:
     customers    : id (auto), name, phone, createdAt
     transactions : id (auto), customerId, type ("debt"|"payment"), amount, note, date
     settings     : key, value
   الرصيد لا يُخزَّن أبدًا — يُحسب دائمًا من الحركات.
================================================================ */
(function (global) {
  'use strict';

  var DEXIE_CDN = 'https://cdn.jsdelivr.net/npm/dexie@4.0.11/dist/dexie.min.js';
  var DEXIE_LOCAL = 'vendor/dexie.min.js';

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('failed: ' + src)); };
      document.head.appendChild(s);
    });
  }

  // المكتبة من الـ CDN مع نسخة محلية احتياطية.
  // بدون إنترنت نذهب للنسخة المحلية مباشرة حتى لا ننتظر مهلة الشبكة.
  function ensureDexie() {
    if (global.Dexie) return Promise.resolve();
    var chain = (global.navigator && global.navigator.onLine === false)
      ? Promise.reject(new Error('offline'))
      : loadScript(DEXIE_CDN);
    return chain
      .catch(function () { return loadScript(DEXIE_LOCAL); })
      .then(function () {
        if (!global.Dexie) throw new Error('Dexie unavailable');
      });
  }

  var db = null;

  var DB = {
    open: function () {
      if (db) return Promise.resolve(db);
      return ensureDexie().then(function () {
        db = new global.Dexie('daftara');
        db.version(1).stores({
          customers: '++id, name, createdAt',
          transactions: '++id, customerId, date',
          settings: 'key'
        });
        return db.open().then(function () { return db; });
      });
    },

    /* ---------- الإعدادات ---------- */
    getSettings: function () {
      return db.settings.toArray().then(function (rows) {
        var out = {};
        rows.forEach(function (r) { out[r.key] = r.value; });
        return out;
      });
    },
    setSetting: function (key, value) {
      return db.settings.put({ key: key, value: value });
    },

    /* ---------- الزبائن ---------- */
    allCustomers: function () { return db.customers.toArray(); },

    addCustomer: function (name, phone) {
      return db.customers.add({
        name: name,
        phone: phone || '',
        createdAt: new Date().toISOString()
      });
    },
    updateCustomer: function (id, name, phone) {
      return db.customers.update(id, { name: name, phone: phone || '' });
    },
    deleteCustomer: function (id) {
      return db.transaction('rw', db.customers, db.transactions, function () {
        db.transactions.where('customerId').equals(id).delete();
        db.customers.delete(id);
      });
    },

    /* ---------- الحركات ---------- */
    allTransactions: function () { return db.transactions.toArray(); },

    addTransaction: function (customerId, type, amount, note) {
      return db.transactions.add({
        customerId: customerId,
        type: type,
        amount: amount,
        note: note || '',
        date: new Date().toISOString()
      });
    },
    deleteTransaction: function (id) { return db.transactions.delete(id); },

    /* ---------- النسخ الاحتياطي ---------- */
    exportAll: function () {
      return Promise.all([
        db.customers.toArray(),
        db.transactions.toArray(),
        db.settings.toArray()
      ]).then(function (r) {
        return {
          app: 'daftara',
          version: 1,
          exportedAt: new Date().toISOString(),
          customers: r[0],
          transactions: r[1],
          settings: r[2]
        };
      });
    },

    // يستبدل كل البيانات الحالية بمحتوى الملف (بعد تأكيد المستخدم).
    importAll: function (data) {
      return db.transaction('rw', db.customers, db.transactions, db.settings, function () {
        db.customers.clear();
        db.transactions.clear();
        db.settings.clear();
        db.customers.bulkAdd(data.customers);
        db.transactions.bulkAdd(data.transactions);
        db.settings.bulkAdd(data.settings || []);
      });
    }
  };

  /* التحقق من صحة ملف النسخة الاحتياطية قبل الاستعادة.
     يعيد {ok:true, data} أو {ok:false, error:"رسالة بالعربية"} */
  DB.validateBackup = function (raw) {
    var data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return { ok: false, error: 'الملف غير صالح — تأكد أنه ملف النسخة الاحتياطية.' };
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, error: 'الملف غير صالح — تأكد أنه ملف النسخة الاحتياطية.' };
    }
    if (data.app && data.app !== 'daftara') {
      return { ok: false, error: 'هذا الملف من تطبيق آخر.' };
    }
    if (!Array.isArray(data.customers) || !Array.isArray(data.transactions)) {
      return { ok: false, error: 'الملف ناقص — لا يحتوي على الزبائن والحركات.' };
    }
    if (data.settings != null && !Array.isArray(data.settings)) {
      return { ok: false, error: 'الملف ناقص أو تالف.' };
    }

    var ids = Object.create(null);
    var i, c, t;
    for (i = 0; i < data.customers.length; i++) {
      c = data.customers[i];
      if (!c || typeof c !== 'object') return { ok: false, error: 'بيانات الزبائن تالفة في الملف.' };
      if (typeof c.id !== 'number' || typeof c.name !== 'string' || !c.name) {
        return { ok: false, error: 'بيانات الزبائن تالفة في الملف.' };
      }
      ids[c.id] = true;
    }
    for (i = 0; i < data.transactions.length; i++) {
      t = data.transactions[i];
      if (!t || typeof t !== 'object') return { ok: false, error: 'بيانات الحركات تالفة في الملف.' };
      if (typeof t.customerId !== 'number' ||
          (t.type !== 'debt' && t.type !== 'payment') ||
          typeof t.amount !== 'number' || !isFinite(t.amount) ||
          typeof t.date !== 'string' || !t.date) {
        return { ok: false, error: 'بيانات الحركات تالفة في الملف.' };
      }
    }

    // تنظيف: نحتفظ بالحقول المعرَّفة فقط، ونحذف الحركات بلا زبون.
    var customers = data.customers.map(function (x) {
      return {
        id: x.id,
        name: String(x.name),
        phone: typeof x.phone === 'string' ? x.phone : '',
        createdAt: typeof x.createdAt === 'string' ? x.createdAt : new Date().toISOString()
      };
    });
    var transactions = data.transactions
      .filter(function (x) { return ids[x.customerId]; })
      .map(function (x) {
        var o = {
          customerId: x.customerId,
          type: x.type,
          amount: x.amount,
          note: typeof x.note === 'string' ? x.note : '',
          date: x.date
        };
        if (typeof x.id === 'number') o.id = x.id;
        return o;
      });
    var settings = (data.settings || []).filter(function (x) {
      return x && typeof x.key === 'string';
    }).map(function (x) { return { key: x.key, value: x.value }; });

    return {
      ok: true,
      data: { customers: customers, transactions: transactions, settings: settings }
    };
  };

  global.DB = DB;
})(window);
