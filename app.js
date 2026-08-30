/* ================= دفترة — منطق التطبيق =================
   HTML/CSS/JS فقط. لا إطار عمل، لا خادم، لا حساب.
   الرصيد يُحسب دائمًا من الحركات ولا يُخزَّن.
============================================================== */
(function () {
  'use strict';

  /* ---------------- الإعدادات الثابتة ---------------- */
  var DEFAULT_CURRENCY = '₪';
  var DEFAULT_COUNTRY_CODE = '970';
  var FREE_CUSTOMER_LIMIT = 25;
  var BACKUP_REMINDER_DAYS = 7;
  var OVERDUE_DAYS = 30;

  var CURRENCIES = [
    { v: '₪', t: 'شيكل (₪)' },
    { v: 'د.أ', t: 'دينار أردني (د.أ)' },
    { v: '$', t: 'دولار ($)' },
    { v: 'ج.م', t: 'جنيه مصري (ج.م)' },
    { v: 'ر.س', t: 'ريال سعودي (ر.س)' },
    { v: 'د.إ', t: 'درهم إماراتي (د.إ)' },
    { v: 'ل.س', t: 'ليرة سورية (ل.س)' },
    { v: 'د.ع', t: 'دينار عراقي (د.ع)' }
  ];

  /* ---------------- اختصارات ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function fmt(n) {
    return round2(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  function fmtSigned(n) { return (n < 0 ? '−' : '') + fmt(Math.abs(n)); }
  function two(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
  }
  function fmtDateTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return fmtDate(iso) + ' · ' + two(d.getHours()) + ':' + two(d.getMinutes());
  }
  function ymd(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  }
  function daysSince(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return 0;
    var a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var n = new Date();
    var b = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    return Math.max(0, Math.round((b - a) / 86400000));
  }
  // توحيد الحروف العربية ليعمل البحث مع أي طريقة كتابة
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().trim()
      .replace(/[ً-ْٰ]/g, '')
      .replace(/[آأإٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/\s+/g, ' ');
  }
  /* ---------------- الحالة ---------------- */
  var S = {
    shopName: '',
    currency: DEFAULT_CURRENCY,
    lastBackupAt: null,
    persistGranted: false,
    customers: [],
    tx: [],
    index: new Map(),
    sort: 'recent',
    started: false
  };

  function reindex() {
    S.index = new Map();
    S.customers.forEach(function (c) {
      S.index.set(c.id, { c: c, tx: [], balance: 0, last: null });
    });
    S.tx.forEach(function (t) {
      var e = S.index.get(t.customerId);
      if (e) e.tx.push(t);
    });
    S.index.forEach(function (e) {
      e.tx.sort(function (a, b) {
        if (a.date === b.date) return (b.id || 0) - (a.id || 0);
        return a.date < b.date ? 1 : -1;
      });
      var bal = 0;
      e.tx.forEach(function (t) { bal += (t.type === 'debt' ? t.amount : -t.amount); });
      e.balance = round2(bal);
      e.last = e.tx.length ? e.tx[0].date : null;
    });
  }

  function entry(id) { return S.index.get(id) || null; }

  function totalOwed() {
    var sum = 0;
    S.index.forEach(function (e) { if (e.balance > 0) sum += e.balance; });
    return round2(sum);
  }

  // التأخير يُقاس بعمر أقدم دين لم يُسدَّد، لا بآخر حركة
  function overdueDays(e) {
    if (e.balance <= 0) return 0;
    var oldest = null;
    e.tx.forEach(function (t) {
      if (t.type === 'debt' && (oldest === null || t.date < oldest)) oldest = t.date;
    });
    if (!oldest) return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(oldest).getTime()) / 86400000));
  }

  function isOverdue(e) { return overdueDays(e) >= OVERDUE_DAYS; }

  function whenLabel(iso) {
    var ts = new Date(iso).getTime();
    if (isNaN(ts)) return '';
    var n = new Date();
    var midnight = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    if (ts >= midnight) return 'اليوم';
    if (ts >= midnight - 86400000) return 'أمس';
    var days = Math.floor((midnight - ts) / 86400000) + 1;
    if (days < 7) return 'قبل ' + days + ' أيام';
    return fmtDate(iso);
  }

  function lastLabel(e) {
    return e.tx.length ? 'آخر حركة ' + whenLabel(e.last) : 'لا حركات';
  }

  function loadData() {
    return Promise.all([DB.allCustomers(), DB.allTransactions()])
      .then(function (r) {
        S.customers = r[0];
        S.tx = r[1];
        reindex();
      });
  }

  function loadSettings() {
    return DB.getSettings().then(function (s) {
      S.shopName = s.shopName || '';
      S.currency = s.currency || DEFAULT_CURRENCY;
      S.lastBackupAt = s.lastBackupAt || null;
      S.persistGranted = !!s.persistGranted;
    });
  }

  /* ---------------- التنقل ---------------- */
  // nav: مكدس من {t:'view',n:'home'|'customer'|'settings',id} أو {t:'ov',n:'numpad'|'sheet'|'dialog'}
  var nav = [{ t: 'view', n: 'home' }];

  function pushEntry(e) {
    nav.push(e);
    history.pushState({ i: nav.length - 1 }, '');
    render();
  }
  function pushView(n, id) { pushEntry({ t: 'view', n: n, id: id }); }
  function pushOverlay(n) { pushEntry({ t: 'ov', n: n }); }
  function goBack() { history.back(); }

  // استبدال أعلى المكدس دون إضافة خطوة جديدة (مثلًا: ورقة الإضافة ← بطاقة الزبون)
  function replaceTop(e) {
    nav[nav.length - 1] = e;
    history.replaceState({ i: nav.length - 1 }, '');
    render();
  }

  // رجوع ثم تنفيذ عمل بعد اكتمال الرجوع فعليًا (حتى لا تتضارب خطوات المتصفح)
  var afterPop = null;
  function goBackThen(fn) { afterPop = fn; history.back(); }

  function resetToHome() {
    while (nav.length > 1) onRemoved(nav.pop());
    nav = [{ t: 'view', n: 'home' }];
    history.replaceState({ i: 0 }, '');
    render();
  }

  function onRemoved(e) {
    if (e.t === 'ov' && e.n === 'dialog') closeDialog(false);
  }

  window.addEventListener('popstate', function (ev) {
    var i = (ev.state && typeof ev.state.i === 'number') ? ev.state.i : 0;
    while (nav.length > i + 1) onRemoved(nav.pop());
    render();
    if (afterPop) {
      var f = afterPop;
      afterPop = null;
      f();
    }
  });

  function currentView() {
    for (var i = nav.length - 1; i >= 0; i--) if (nav[i].t === 'view') return nav[i];
    return { t: 'view', n: 'home' };
  }
  function overlayOpen(n) {
    return nav.some(function (e) { return e.t === 'ov' && e.n === n; });
  }

  function render() {
    if (!S.started) return;
    var v = currentView();
    $('screen-home').hidden = v.n !== 'home';
    $('screen-customer').hidden = v.n !== 'customer';
    $('screen-settings').hidden = v.n !== 'settings';
    if (v.n === 'home') renderHome();
    if (v.n === 'customer') renderCustomer(v.id);
    if (v.n === 'settings') renderSettings();
    $('numpad').hidden = !overlayOpen('numpad');
    $('sheet').hidden = !overlayOpen('sheet');
    $('dialog').hidden = !overlayOpen('dialog');
  }

  /* ---------------- مربعات التأكيد ---------------- */
  var dialogResolve = null;

  function ask(opts) {
    return new Promise(function (resolve) {
      if (dialogResolve) { resolve(false); return; }
      dialogResolve = resolve;
      $('dialog-title').textContent = opts.title || '';
      $('dialog-msg').textContent = opts.msg || '';
      var ok = $('dialog-ok');
      ok.textContent = opts.ok || 'تأكيد';
      ok.className = 'btn btn-lg full ' + (opts.danger ? 'btn-danger' : 'btn-primary');
      var cancel = $('dialog-cancel');
      cancel.hidden = !!opts.alert;
      cancel.textContent = opts.cancel || 'إلغاء';
      pushOverlay('dialog');
    });
  }
  function alertBox(title, msg, okLabel) {
    return ask({ title: title, msg: msg, ok: okLabel || 'حسنًا', alert: true });
  }
  function closeDialog(value) {
    if (!dialogResolve) return;
    var r = dialogResolve;
    dialogResolve = null;
    r(value);
  }

  $('dialog-ok').addEventListener('click', function () { closeDialog(true); goBack(); });
  $('dialog-cancel').addEventListener('click', function () { closeDialog(false); goBack(); });
  $('dialog').querySelector('.dialog-backdrop').addEventListener('click', function () {
    closeDialog(false); goBack();
  });

  /* ---------------- 1. شاشة الإعداد ---------------- */
  function fillCurrencySelect(sel, value) {
    sel.innerHTML = CURRENCIES.map(function (c) {
      return '<option value="' + esc(c.v) + '">' + esc(c.t) + '</option>';
    }).join('');
    sel.value = value;
    if (!sel.value) sel.value = DEFAULT_CURRENCY;
  }

  function isIOS() {
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) ||
      (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }
  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      navigator.standalone === true;
  }

  var installPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installPrompt = e;
    var b = $('install-now');
    if (b && !$('screen-setup').hidden) b.hidden = false;
  });

  function showOsGuide(os) {
    $('guide-android').hidden = os !== 'android';
    $('guide-ios').hidden = os !== 'ios';
    Array.prototype.forEach.call($('os-tabs').children, function (t) {
      t.classList.toggle('on', t.dataset.os === os);
    });
  }

  function showSetup() {
    fillCurrencySelect($('setup-currency'), S.currency);
    $('setup-shop').value = S.shopName || '';
    $('screen-setup').hidden = false;
    setTimeout(function () { $('setup-shop').focus(); }, 150);
  }

  $('setup-next').addEventListener('click', function () {
    var name = $('setup-shop').value.trim();
    if (!name) {
      $('setup-err').hidden = false;
      $('setup-shop').focus();
      return;
    }
    $('setup-err').hidden = true;
    S.shopName = name;
    S.currency = $('setup-currency').value || DEFAULT_CURRENCY;

    // طلب تخزين دائم حتى لا يمسح المتصفح الدفتر
    requestPersist();

    $('setup-step1').hidden = true;
    $('setup-step2').hidden = false;
    showOsGuide(isIOS() ? 'ios' : 'android');
    if (isStandalone()) {
      $('installed-note').hidden = false;
      $('guide-android').hidden = true;
      $('guide-ios').hidden = true;
      $('os-tabs').hidden = true;
    }
    if (installPrompt) $('install-now').hidden = false;
    window.scrollTo(0, 0);
  });

  Array.prototype.forEach.call($('os-tabs').children, function (t) {
    t.addEventListener('click', function () { showOsGuide(t.dataset.os); });
  });

  $('install-now').addEventListener('click', function () {
    if (!installPrompt) return;
    installPrompt.prompt();
    installPrompt.userChoice.then(function () {
      installPrompt = null;
      $('install-now').hidden = true;
    });
  });

  $('setup-done').addEventListener('click', function () {
    Promise.all([
      DB.setSetting('shopName', S.shopName),
      DB.setSetting('currency', S.currency)
    ]).then(function () {
      $('screen-setup').hidden = true;
      startApp();
    });
  });

  function requestPersist() {
    if (!navigator.storage || !navigator.storage.persist) return Promise.resolve(false);
    return navigator.storage.persist().then(function (granted) {
      S.persistGranted = !!granted;
      return DB.setSetting('persistGranted', !!granted).then(function () { return !!granted; });
    }).catch(function () { return false; });
  }

  /* ---------------- 4. الشاشة الرئيسية ---------------- */
  function renderHome() {
    $('home-shop').textContent = S.shopName || 'دفترة';
    $('metric-total').textContent = fmt(totalOwed());
    $('metric-cur').textContent = S.currency;
    $('metric-count').textContent = fmt(S.customers.length);
    renderBackupBanner();
    renderSortBar();
    renderCustomerList();
  }

  function renderSortBar() {
    var late = 0;
    S.index.forEach(function (e) { if (isOverdue(e)) late++; });
    $('sort-late').textContent = late ? 'متأخرون · ' + late : 'متأخرون';
    Array.prototype.forEach.call($('sortbar').children, function (b) {
      b.classList.toggle('on', b.dataset.sort === S.sort);
    });
  }

  function backupOverdueDays() {
    if (!S.lastBackupAt) return null;
    return daysSince(S.lastBackupAt);
  }

  function renderBackupBanner() {
    var d = backupOverdueDays();
    var show = (d === null) ? S.customers.length > 0 : d >= BACKUP_REMINDER_DAYS;
    $('backup-banner').hidden = !show;
    if (!show) return;
    $('backup-banner-text').textContent = (d === null)
      ? 'لم تحفظ نسخة احتياطية بعد.'
      : 'آخر نسخة احتياطية قبل ' + d + ' يوم.';
  }

  function sortedCustomers() {
    var list = [];
    S.index.forEach(function (e) { list.push(e); });
    if (S.sort === 'late') {
      return list.filter(isOverdue).sort(function (a, b) {
        return overdueDays(b) - overdueDays(a);
      });
    }
    if (S.sort === 'debt') {
      return list.sort(function (a, b) { return b.balance - a.balance; });
    }
    if (S.sort === 'name') {
      return list.sort(function (a, b) { return a.c.name.localeCompare(b.c.name, 'ar'); });
    }
    return list.sort(function (a, b) {                 // الأحدث حركةً
      var la = a.last ? new Date(a.last).getTime() : 0;
      var lb = b.last ? new Date(b.last).getTime() : 0;
      return lb - la;
    });
  }

  function renderCustomerList() {
    var raw = $('search').value;
    var q = norm(raw);
    var digits = q.replace(/\D/g, '');
    $('search-clear').hidden = !raw;

    var list = sortedCustomers().filter(function (e) {
      if (!q) return true;
      if (norm(e.c.name).indexOf(q) !== -1) return true;
      return digits !== '' &&
        String(e.c.phone || '').replace(/\D/g, '').indexOf(digits) !== -1;
    });

    $('customer-list').innerHTML = list.map(function (e) {
      var owed = e.balance > 0;
      var od = overdueDays(e);
      var amount = owed
        ? '<span class="row-amount num">' + fmt(e.balance) + '</span>'
        : (e.balance < 0
            ? '<span class="row-amount num credit">' + fmtSigned(e.balance) + '</span>'
            : '<span class="row-amount settled">مسدّد</span>');
      return '<li><button class="row" type="button" data-id="' + e.c.id + '">' +
        '<span class="row-mark' + (owed ? ' owed' : '') + '" aria-hidden="true">' +
          esc(String(e.c.name).trim().charAt(0)) + '</span>' +
        '<span class="row-main">' +
          '<span class="row-name">' + esc(e.c.name) + '</span>' +
          '<span class="row-sub"><span>' + esc(lastLabel(e)) + '</span>' +
            (od >= OVERDUE_DAYS ? '<span class="late">متأخر ' + od + ' يوم</span>' : '') +
          '</span>' +
        '</span>' + amount +
      '</button></li>';
    }).join('');

    var empty = $('home-empty');
    empty.hidden = list.length > 0;
    if (list.length) return;
    var title, hint;
    if (raw.trim()) {
      title = 'لا نتائج';
      hint = 'لا يوجد زبون بهذا الاسم.';
    } else if (S.sort === 'late' && S.customers.length) {
      title = 'لا متأخرين';
      hint = 'لا يوجد زبون تأخر أكثر من ' + OVERDUE_DAYS + ' يوم.';
    } else {
      title = 'الدفتر فارغ';
      hint = 'أضف أول زبون لتبدأ بتسجيل الديون والدفعات.';
    }
    $('empty-title').textContent = title;
    $('empty-hint').textContent = hint;
  }

  $('sortbar').addEventListener('click', function (ev) {
    var b = ev.target.closest('.sort');
    if (!b || b.dataset.sort === S.sort) return;
    S.sort = b.dataset.sort;
    renderSortBar();
    renderCustomerList();
    $('home-scroll').scrollTop = 0;
  });

  $('customer-list').addEventListener('click', function (e) {
    var btn = e.target.closest('.row');
    if (!btn) return;
    openCustomer(Number(btn.dataset.id));
  });

  $('search').addEventListener('input', renderCustomerList);
  $('search-clear').addEventListener('click', function () {
    $('search').value = '';
    renderCustomerList();
    $('search').focus();
  });

  $('go-settings').addEventListener('click', function () { pushView('settings'); });
  $('backup-banner-btn').addEventListener('click', function () { doBackup(); });
  $('fab-new').addEventListener('click', function () { openNewCustomer(); });

  function openCustomer(id) {
    pushView('customer', id);
    $('cust-scroll').scrollTop = 0;
  }

  /* ---------------- 2. صفحة الزبون ---------------- */
  var ICON_TRASH = '<svg class="ic" viewBox="0 0 256 256" width="19" height="19" fill="currentColor" aria-hidden="true"><path d="M200,56V208a8,8,0,0,1-8,8H64a8,8,0,0,1-8-8V56Z" opacity="0.2"/><path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"/></svg>';

  function renderCustomer(id) {
    var e = entry(id);
    if (!e) { goBack(); return; }
    var c = e.c;

    $('cust-name').textContent = c.name;
    $('cust-phone').innerHTML = c.phone
      ? '<span class="num">' + esc(c.phone) + '</span>'
      : 'لا يوجد رقم هاتف';
    var od = overdueDays(e);
    $('cust-late').textContent = od >= OVERDUE_DAYS ? 'أقدم دين منذ ' + od + ' يوم' : '';

    var block = $('balance-block');
    block.classList.toggle('owed', e.balance > 0);
    block.classList.toggle('credit', e.balance < 0);
    $('balance-label').textContent = e.balance > 0 ? 'الرصيد المستحق'
      : (e.balance < 0 ? 'رصيد لصالح الزبون' : 'الحساب');
    $('balance-value').textContent = fmt(Math.abs(e.balance));
    document.querySelector('.bal-cur').textContent = S.currency;

    $('tx-count').textContent = e.tx.length ? String(e.tx.length) : '';
    $('tx-list').innerHTML = e.tx.map(function (t) {
      var label = (t.type === 'debt' ? 'دين' : 'دفعة') + (t.note ? ' · ' + t.note : '');
      var sign = t.type === 'debt' ? '+' : '−';
      return '<li class="tx ' + t.type + '">' +
        '<span class="tx-main">' +
          '<span class="tx-label">' + esc(label) + '</span>' +
          '<span class="tx-when">' + esc(fmtDateTime(t.date)) + '</span>' +
        '</span>' +
        '<span class="tx-amount num">' + sign + fmt(t.amount) + '</span>' +
        '<button class="icon-btn tx-del" type="button" data-id="' + t.id +
          '" aria-label="حذف الحركة">' + ICON_TRASH + '</button>' +
      '</li>';
    }).join('');
    $('tx-empty').hidden = e.tx.length > 0;
  }

  $('cust-back').addEventListener('click', goBack);
  $('btn-debt').addEventListener('click', function () { openNumpad('debt'); });
  $('btn-pay').addEventListener('click', function () { openNumpad('payment'); });
  $('cust-edit').addEventListener('click', function () { openEditCustomer(currentView().id); });
  $('btn-send').addEventListener('click', function () { sendStatement(currentView().id); });

  $('tx-list').addEventListener('click', function (ev) {
    var b = ev.target.closest('.tx-del');
    if (b) confirmDeleteTx(Number(b.dataset.id));
  });

  function flashBalance() {
    var b = $('balance-block');
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop');
  }

  function confirmDeleteTx(id) {
    var t = null;
    for (var i = 0; i < S.tx.length; i++) if (S.tx[i].id === id) { t = S.tx[i]; break; }
    if (!t) return;
    ask({
      title: (t.type === 'debt' ? 'حذف دين ' : 'حذف دفعة ') + fmt(t.amount) + ' ' + S.currency + '؟',
      msg: 'سيُحذف هذا السجل من دفتر الزبون ويتغير الرصيد. لا يمكن التراجع.',
      ok: 'احذف الحركة',
      danger: true
    }).then(function (yes) {
      if (!yes) return;
      return DB.deleteTransaction(id).then(loadData).then(function () {
        render();
        flashBalance();
      });
    });
  }

  /* ---------------- 3. تسجيل دين أو دفعة (شيت) ----------------
     مبالغ صحيحة فقط: لا فاصلة عشرية، ومفتاح 00 بدلًا منها. */
  var MAX_DIGITS = 7;
  var np = { type: 'debt', customerId: null, buf: '' };

  function openNumpad(type) {
    var v = currentView();
    if (v.n !== 'customer') return;
    np.type = type;
    np.customerId = v.id;
    np.buf = '';
    var e = entry(v.id);
    $('numpad-title').textContent = type === 'debt' ? 'تسجيل دين' : 'تسجيل دفعة';
    $('numpad-for').textContent = e ? e.c.name : '';
    $('numpad-cur').textContent = S.currency;
    $('numpad-notefield').value = '';
    $('amount-display').className = 'amount-display ' + type;
    paintNumpad();
    pushOverlay('numpad');
  }

  function amountValue() { return parseInt(np.buf || '0', 10) || 0; }

  function paintNumpad() {
    var amount = amountValue();
    $('numpad-value').textContent = fmt(amount);
    var btn = $('numpad-confirm');
    btn.className = 'btn btn-lg full ' + (np.type === 'debt' ? 'btn-debt' : 'btn-pay-solid');
    btn.textContent = np.type === 'debt' ? 'أضف الدين' : 'أضف الدفعة';
    btn.disabled = amount <= 0;
  }

  function pressKey(k) {
    if (k === 'back') {
      np.buf = np.buf.slice(0, -1);
    } else {
      if (np.buf.length + k.length > MAX_DIGITS) return;
      np.buf = (np.buf + k).replace(/^0+(?=\d)/, '');
    }
    paintNumpad();
  }

  $('keys').addEventListener('click', function (ev) {
    var b = ev.target.closest('.key');
    if (b) pressKey(b.dataset.k);
  });

  $('quick').addEventListener('click', function (ev) {
    var b = ev.target.closest('.quick-btn');
    if (!b) return;
    np.buf = String(Math.min(9999999, amountValue() + Number(b.dataset.add)));
    paintNumpad();
  });

  $('numpad').querySelector('.sheet-backdrop').addEventListener('click', goBack);

  $('numpad-confirm').addEventListener('click', function () {
    var amount = amountValue();
    if (amount <= 0) return;
    var note = $('numpad-notefield').value.trim();
    var cid = np.customerId;
    $('numpad-confirm').disabled = true;
    DB.addTransaction(cid, np.type, amount, note)
      .then(loadData)
      .then(function () {
        goBackThen(function () { flashBalance(); });
      })
      .catch(function () { $('numpad-confirm').disabled = false; });
  });

  /* ---------------- ورقة الزبون (إضافة/تعديل) ---------------- */
  var sheetMode = 'new';
  var sheetId = null;
  var sheetAfter = null;

  function openSheet(opts) {
    sheetMode = opts.mode;
    sheetId = opts.id || null;
    sheetAfter = opts.after || null;
    $('sheet-title').textContent = opts.title;
    $('sheet-name').value = opts.name || '';
    $('sheet-phone').value = opts.phone || '';
    $('sheet-err').hidden = true;
    $('sheet-delete').hidden = opts.mode !== 'edit';
    $('sheet-msg').hidden = !opts.msg;
    if (opts.msg) $('sheet-msg').textContent = opts.msg;
    pushOverlay('sheet');
    setTimeout(function () {
      (opts.focusPhone ? $('sheet-phone') : $('sheet-name')).focus();
    }, 120);
  }

  function openNewCustomer() {
    if (S.customers.length >= FREE_CUSTOMER_LIMIT) {
      alertBox('اكتمل عدد الزبائن',
        'النسخة المجانية تتسع لـ ' + FREE_CUSTOMER_LIMIT + ' زبون. لإضافة زبون جديد، احذف زبونًا سدّد دينه بالكامل من شاشة الزبون (زر التعديل).');
      return;
    }
    openSheet({ mode: 'new', title: 'زبون جديد' });
  }

  function openEditCustomer(id, opts) {
    var e = entry(id);
    if (!e) return;
    opts = opts || {};
    openSheet({
      mode: 'edit',
      id: id,
      title: 'تعديل بيانات الزبون',
      name: e.c.name,
      phone: e.c.phone,
      msg: opts.msg,
      focusPhone: !!opts.focusPhone,
      after: opts.after
    });
  }

  $('sheet-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var name = $('sheet-name').value.trim();
    var phone = $('sheet-phone').value.trim();
    if (!name) {
      $('sheet-err').hidden = false;
      $('sheet-name').focus();
      return;
    }
    var after = sheetAfter;
    var id = sheetId;
    var p;
    if (sheetMode === 'new') {
      p = DB.addCustomer(name, phone).then(function (newId) {
        return loadData().then(function () {
          // ورقة الإضافة تتحوّل إلى بطاقة الزبون ليسجّل أول دين فورًا
          replaceTop({ t: 'view', n: 'customer', id: newId });
          $('cust-scroll').scrollTop = 0;
        });
      });
    } else {
      p = DB.updateCustomer(id, name, phone).then(loadData).then(function () {
        goBackThen(function () { if (after) after(id); });
      });
    }
    p.catch(function () {});
  });

  $('sheet-cancel').addEventListener('click', goBack);
  $('sheet').querySelector('.sheet-backdrop').addEventListener('click', goBack);

  $('sheet-delete').addEventListener('click', function () {
    var id = sheetId;
    var e = entry(id);
    if (!e) return;
    ask({
      title: 'حذف الزبون؟',
      msg: 'سيُحذف «' + e.c.name + '» مع كل حركاته (' + e.tx.length + '). لا يمكن التراجع.',
      ok: 'احذف',
      danger: true
    }).then(function (yes) {
      if (!yes) return;
      return DB.deleteCustomer(id).then(loadData).then(resetToHome);
    });
  });

  /* ---------------- كشف الحساب عبر واتساب ---------------- */
  // "0599123456" ← رقم محلي  →  "970599123456"
  // "+972501234567" أو "00972…" ← رقم دولي يبقى كما هو
  function normalizePhone(raw) {
    var s = String(raw || '').trim();
    var intl = /^\+/.test(s);
    var d = s.replace(/\D/g, '');
    if (!d) return '';
    if (!intl && d.indexOf('00') === 0) { d = d.slice(2); intl = true; }  // بادئة الاتصال الدولي
    if (intl) {
      d = d.replace(/^0+/, '');
      if (d.indexOf(DEFAULT_COUNTRY_CODE) === 0 || d.length >= 10) return d;
      return DEFAULT_COUNTRY_CODE + d;
    }
    if (d.indexOf(DEFAULT_COUNTRY_CODE) === 0) return d;
    d = d.replace(/^0+/, '');
    if (d.length >= 11) return d;               // يبدو أنه يحمل رمز دولة أصلًا
    return DEFAULT_COUNTRY_CODE + d;
  }

  function buildStatement(e) {
    var L = [];
    L.push(S.shopName);
    L.push('كشف حساب');
    L.push('');
    L.push('الزبون: ' + e.c.name);
    L.push('');
    L.push('آخر الحركات:');
    var last5 = e.tx.slice(0, 5);
    if (!last5.length) {
      L.push('لا توجد حركات.');
    } else {
      last5.forEach(function (t) {
        L.push('• ' + fmtDate(t.date) + ' — ' + (t.type === 'debt' ? 'دين' : 'دفعة') +
          ' ' + fmt(t.amount) + ' ' + S.currency + (t.note ? ' (' + t.note + ')' : ''));
      });
    }
    L.push('');
    if (e.balance > 0) L.push('الرصيد المستحق: ' + fmt(e.balance) + ' ' + S.currency);
    else if (e.balance < 0) L.push('رصيد لك: ' + fmt(-e.balance) + ' ' + S.currency);
    else L.push('الرصيد: 0 ' + S.currency + ' — سدّد بالكامل، شكرًا لك.');
    L.push('التاريخ: ' + fmtDate(new Date().toISOString()));
    return L.join('\n');
  }

  function sendStatement(id) {
    var e = entry(id);
    if (!e) return;
    var phone = normalizePhone(e.c.phone);
    if (!phone) {
      openEditCustomer(id, {
        msg: 'أضف رقم هاتف الزبون لإرسال كشف الحساب عبر واتساب.',
        focusPhone: true,
        after: function (cid) { sendStatement(cid); }
      });
      return;
    }
    var url = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(buildStatement(e));
    var w = window.open(url, '_blank', 'noopener');
    if (!w) window.location.href = url;
  }

  /* ---------------- 5. الإعدادات ---------------- */
  function renderSettings() {
    $('set-shop').value = S.shopName;
    fillCurrencySelect($('set-currency'), S.currency);
    $('last-backup').textContent = S.lastBackupAt
      ? 'آخر نسخة احتياطية: ' + fmtDate(S.lastBackupAt) + ' (قبل ' + daysSince(S.lastBackupAt) + ' يوم)'
      : 'لم تحفظ أي نسخة بعد.';
    $('persist-note').textContent = S.persistGranted
      ? 'التخزين الدائم مفعّل ✓ — لن يمسح المتصفح دفترك تلقائيًا.'
      : 'التخزين الدائم غير مفعّل. قد يمسح المتصفح البيانات عند امتلاء الذاكرة. احفظ نسخة احتياطية بانتظام.';
    $('btn-persist').hidden = S.persistGranted;
  }

  $('set-back').addEventListener('click', goBack);

  var shopTimer = null;
  $('set-shop').addEventListener('input', function () {
    var v = $('set-shop').value.trim();
    if (!v) return;
    S.shopName = v;
    clearTimeout(shopTimer);
    shopTimer = setTimeout(function () { DB.setSetting('shopName', v); }, 300);
  });
  $('set-shop').addEventListener('blur', function () {
    if (!$('set-shop').value.trim()) $('set-shop').value = S.shopName;
  });
  $('set-currency').addEventListener('change', function () {
    S.currency = $('set-currency').value;
    DB.setSetting('currency', S.currency).then(render);
  });
  $('btn-persist').addEventListener('click', function () {
    requestPersist().then(function (granted) {
      render();
      if (!granted) {
        alertBox('لم يُفعَّل', 'المتصفح لم يفعّل التخزين الدائم. أضف التطبيق إلى الشاشة الرئيسية واحفظ نسخة احتياطية بانتظام.');
      }
    });
  });

  /* ---------------- النسخ الاحتياطي والاستعادة ---------------- */
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function doBackup() {
    return DB.exportAll().then(function (data) {
      var json = JSON.stringify(data, null, 2);
      var filename = 'daftara-backup-' + ymd() + '.json';
      var blob = new Blob([json], { type: 'application/json' });
      var file = null;
      try { file = new File([blob], filename, { type: 'application/json' }); } catch (e) { file = null; }

      var shareable = file && navigator.share && navigator.canShare &&
        navigator.canShare({ files: [file] });

      var step = shareable
        ? navigator.share({ files: [file], title: 'نسخة احتياطية — دفترة' })
            .then(function () { return true; })
            .catch(function (err) {
              if (err && err.name === 'AbortError') return null;   // ألغى المستخدم
              downloadBlob(blob, filename);
              return true;
            })
        : Promise.resolve().then(function () { downloadBlob(blob, filename); return true; });

      return step.then(function (done) {
        if (!done) return;
        var now = new Date().toISOString();
        S.lastBackupAt = now;
        return DB.setSetting('lastBackupAt', now).then(render);
      });
    });
  }

  $('btn-backup').addEventListener('click', doBackup);

  $('btn-restore').addEventListener('click', function () { $('restore-file').click(); });

  $('restore-file').addEventListener('change', function () {
    var input = $('restore-file');
    var f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    var reader = new FileReader();
    reader.onerror = function () {
      alertBox('تعذّرت القراءة', 'لم نستطع قراءة الملف. جرّب ملفًا آخر.');
    };
    reader.onload = function () {
      var res = DB.validateBackup(String(reader.result || ''));
      if (!res.ok) { alertBox('ملف غير صالح', res.error); return; }
      ask({
        title: 'استعادة النسخة؟',
        msg: 'سيُمسح كل ما في الدفتر الآن (' + S.customers.length + ' زبون) ويُستبدل بالملف: ' +
             res.data.customers.length + ' زبون و' + res.data.transactions.length + ' حركة. لا يمكن التراجع.',
        ok: 'استعد الآن',
        danger: true
      }).then(function (yes) {
        if (!yes) return;
        return DB.importAll(res.data)
          .then(loadSettings)
          .then(loadData)
          .then(function () {
            $('search').value = '';
            resetToHome();
            return alertBox('تمت الاستعادة', 'الدفتر الآن يحتوي على ' + S.customers.length + ' زبون.');
          });
      });
    };
    reader.readAsText(f);
  });

  /* ---------------- الإقلاع ---------------- */
  function startApp() {
    S.started = true;
    nav = [{ t: 'view', n: 'home' }];
    history.replaceState({ i: 0 }, '');
    render();
  }

  function fatal(msg) {
    document.body.innerHTML =
      '<div style="padding:32px;font-family:system-ui,sans-serif;text-align:center">' +
      '<h1 style="font-size:20px">تعذّر تشغيل التطبيق</h1><p style="color:#6b7280">' + esc(msg) + '</p>' +
      '<p style="color:#6b7280">جرّب إغلاق وضع التصفح الخفي، أو استخدام متصفح آخر.</p></div>';
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  DB.open()
    .then(loadSettings)
    .then(loadData)
    .then(function () {
      if (!S.shopName) showSetup();
      else startApp();
      registerSW();
    })
    .catch(function (err) {
      fatal((err && err.message) ? err.message : 'خطأ غير معروف');
    });

  // منع التكبير بالنقر المزدوج على الأزرار (يزعج المستخدم أثناء التسجيل السريع)
  document.addEventListener('dblclick', function (e) {
    if (e.target.closest('button')) e.preventDefault();
  });
})();
