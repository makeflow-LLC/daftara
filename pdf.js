/* ================= دفترة — كشف الحساب PDF =================
   يرسم الكشف على canvas (المتصفح يتكفّل بتشكيل الحروف العربية واتجاهها
   بخطوط الجهاز، بلا مكتبة ولا خط مُضمَّن)، ثم يضع كل صفحة كصورة JPEG داخل
   ملف PDF بسيط مكتوب يدويًا. النتيجة تُطبع وتُرسل وتُفتح في أي قارئ PDF.

   StatementPdf.make({shop, currency, name, phone, tx:[{date,type,amount,note}],
                      fmtNum, fmtDate}) ← Promise<Uint8Array>
================================================================ */
(function (global) {
  'use strict';

  // A4 بدقة 150 نقطة في البوصة
  var W = 1240, H = 1754, M = 64;
  var PDF_W = 595.28, PDF_H = 841.89;

  var C = {
    brand: '#0e7a51', brand2: '#0a5f74', ink: '#201e1d', muted: '#6b6767',
    line: '#e4dfdf', zebra: '#faf7f7', head: '#f1eded',
    debt: '#aa0b56', debtBg: '#fff1f4', pay: '#0b6644', payBg: '#e8f5ee'
  };
  var FONT_AR = '"Noto Naskh Arabic","Noto Sans Arabic","Geeza Pro",Tahoma,sans-serif';
  var FONT_NUM = '"Noto Serif","Source Serif 4","Times New Roman",serif';

  var ROW_H = 58;
  var FIRST_TABLE_Y = 640, NEXT_TABLE_Y = 210, TABLE_END = H - 120;

  function rowsOn(first) {
    return Math.floor((TABLE_END - (first ? FIRST_TABLE_Y : NEXT_TABLE_Y) - ROW_H) / ROW_H);
  }

  // الأعمدة من اليمين: التاريخ، البيان، دين، دفعة، الرصيد
  var COLS = (function () {
    var right = W - M;
    var widths = [190, 0, 170, 170, 190];
    widths[1] = (W - 2 * M) - 190 - 170 - 170 - 190;
    var out = [], x = right;
    widths.forEach(function (w) { out.push({ r: x, l: x - w, w: w }); x -= w; });
    return out;
  })();

  function text(ctx, s, x, y, o) {
    ctx.font = (o.weight || 400) + ' ' + o.size + 'px ' + (o.num ? FONT_NUM : FONT_AR);
    ctx.fillStyle = o.color || C.ink;
    ctx.direction = o.num ? 'ltr' : 'rtl';
    ctx.textAlign = o.align || 'right';
    ctx.textBaseline = 'middle';
    var str = String(s);
    if (o.max) {   // قصّ النص الطويل بنقاط
      while (str.length > 1 && ctx.measureText(str).width > o.max) str = str.slice(0, -1);
      if (str !== String(s)) str = str.slice(0, -1) + '…';
    }
    // الأرقام في عزل LTR حتى لا تنقلب الإشارة («-10» لا «10-») داخل صفحة عربية
    if (o.num) str = '\u202A' + str.replace(/^-/, '\u2212') + '\u202C';
    ctx.fillText(str, x, y);
  }

  function roundRect(ctx, x, y, w, h, r, fill) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function band(ctx, h, o) {
    var g = ctx.createLinearGradient(W, 0, 0, h);
    g.addColorStop(0, C.brand);
    g.addColorStop(1, C.brand2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, h);
    text(ctx, o.shop, W - M, h * 0.40, { size: h > 200 ? 54 : 40, weight: 700, color: '#fff', max: W * 0.6 });
    text(ctx, 'كشف حساب' + (o.cont ? ' — تابع' : ''), W - M, h * 0.72, { size: 28, color: 'rgba(255,255,255,.85)' });
    text(ctx, o.date, M, h * 0.40, { size: 26, color: '#fff', num: true, align: 'left' });
    text(ctx, 'تاريخ الكشف', M + 2, h * 0.72, { size: 22, color: 'rgba(255,255,255,.75)', align: 'left' });
  }

  function summary(ctx, y, o) {
    var gap = 24, bw = (W - 2 * M - 2 * gap) / 3, bh = 130;
    var boxes = [
      { label: 'مجموع الديون', value: o.debts, color: C.debt, bg: C.debtBg },
      { label: 'مجموع الدفعات', value: o.payments, color: C.pay, bg: C.payBg },
      o.balance > 0 ? { label: 'الرصيد المستحق', value: o.balance, color: '#fff', bg: C.debt, strong: true }
        : o.balance < 0 ? { label: 'رصيد لصالح الزبون', value: -o.balance, color: '#fff', bg: C.pay, strong: true }
        : { label: 'الرصيد — مسدّد', value: 0, color: C.ink, bg: C.head, strong: true }
    ];
    boxes.forEach(function (b, i) {
      var x = W - M - (i + 1) * bw - i * gap;
      roundRect(ctx, x, y, bw, bh, 18, b.bg);
      text(ctx, b.label, x + bw - 22, y + 38, { size: 24, color: b.strong ? b.color : C.muted, weight: b.strong ? 700 : 400 });
      text(ctx, o.fmtNum(b.value) + ' ' + o.currency, x + bw - 22, y + 90, { size: 40, weight: 700, color: b.color, align: 'right' });
    });
  }

  function tableHead(ctx, y) {
    roundRect(ctx, M, y, W - 2 * M, ROW_H, 10, C.head);
    ['التاريخ', 'البيان', 'دين', 'دفعة', 'الرصيد'].forEach(function (h, i) {
      text(ctx, h, COLS[i].r - 14, y + ROW_H / 2, { size: 23, weight: 700, color: C.muted });
    });
  }

  function row(ctx, y, r, i, o) {
    if (i % 2) { ctx.fillStyle = C.zebra; ctx.fillRect(M, y, W - 2 * M, ROW_H); }
    var mid = y + ROW_H / 2;
    text(ctx, o.fmtDate(r.date), COLS[0].r - 14, mid, { size: 23, num: true, color: C.muted, align: 'right' });
    text(ctx, r.label, COLS[1].r - 14, mid, { size: 25, max: COLS[1].w - 28 });
    if (r.type === 'debt') text(ctx, o.fmtNum(r.amount), COLS[2].r - 14, mid, { size: 26, num: true, weight: 700, color: C.debt });
    else text(ctx, o.fmtNum(r.amount), COLS[3].r - 14, mid, { size: 26, num: true, weight: 700, color: C.pay });
    text(ctx, o.fmtNum(r.running), COLS[4].r - 14, mid, {
      size: 26, num: true, color: r.running > 0 ? C.debt : (r.running < 0 ? C.pay : C.muted)
    });
    ctx.fillStyle = C.line;
    ctx.fillRect(M, y + ROW_H - 1, W - 2 * M, 1);
  }

  function footer(ctx, page, pages) {
    ctx.fillStyle = C.line;
    ctx.fillRect(M, H - 92, W - 2 * M, 2);
    text(ctx, 'دفترة — أحد منتجات MakeFlow', W - M, H - 56, { size: 22, color: C.muted });
    text(ctx, 'صفحة ' + page + ' من ' + pages, M, H - 56, { size: 22, color: C.muted, align: 'left' });
  }

  function jpegBytes(canvas) {
    var b64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ملف PDF 1.4: كائن الفهرس، الصفحات، ولكل صفحة: صفحة + محتوى + صورة
  function buildPdf(images) {
    var parts = [], len = 0, offsets = [];
    function put(x) {
      var b = typeof x === 'string' ? new TextEncoder().encode(x) : x;
      parts.push(b); len += b.length;
    }
    function obj(n, body) { offsets[n] = len; put(n + ' 0 obj\n'); body(); put('\nendobj\n'); }

    put('%PDF-1.4\n');
    put(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));
    var n = images.length, kids = [];
    for (var i = 0; i < n; i++) kids.push((3 + i * 3) + ' 0 R');
    obj(1, function () { put('<< /Type /Catalog /Pages 2 0 R >>'); });
    obj(2, function () { put('<< /Type /Pages /Count ' + n + ' /Kids [' + kids.join(' ') + '] >>'); });
    images.forEach(function (img, i) {
      var p = 3 + i * 3;
      var content = 'q ' + PDF_W + ' 0 0 ' + PDF_H + ' 0 0 cm /Im0 Do Q';
      obj(p, function () {
        put('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PDF_W + ' ' + PDF_H + '] ' +
            '/Resources << /XObject << /Im0 ' + (p + 2) + ' 0 R >> >> /Contents ' + (p + 1) + ' 0 R >>');
      });
      obj(p + 1, function () { put('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream'); });
      obj(p + 2, function () {
        put('<< /Type /XObject /Subtype /Image /Width ' + W + ' /Height ' + H +
            ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + img.length + ' >>\nstream\n');
        put(img);
        put('\nendstream');
      });
    });
    var xref = len, total = 3 + n * 3;
    var x = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
    for (var k = 1; k < total; k++) x += String(offsets[k]).padStart(10, '0') + ' 00000 n \n';
    put(x + 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');

    var out = new Uint8Array(len), at = 0;
    parts.forEach(function (b) { out.set(b, at); at += b.length; });
    return out;
  }

  function make(o) {
    // الأقدم أولًا، مع الرصيد بعد كل حركة
    var running = 0, debts = 0, payments = 0;
    var rows = o.tx.slice().sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); })
      .map(function (t) {
        if (t.type === 'debt') { running += t.amount; debts += t.amount; }
        else { running -= t.amount; payments += t.amount; }
        return { date: t.date, type: t.type, amount: t.amount, running: running,
                 label: (t.type === 'debt' ? 'دين' : 'دفعة') + (t.note ? ' · ' + t.note : '') };
      });

    var pages = [], first = rowsOn(true), next = rowsOn(false);
    pages.push(rows.slice(0, first));
    for (var at = first; at < rows.length; at += next) pages.push(rows.slice(at, at + next));

    var today = o.fmtDate(new Date().toISOString());
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    var images = pages.map(function (list, pi) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      var y;
      if (pi === 0) {
        band(ctx, 250, { shop: o.shop, date: today });
        text(ctx, 'الزبون', W - M, 300, { size: 24, color: C.muted });
        text(ctx, o.name, W - M, 348, { size: 42, weight: 700, max: W * 0.6 });
        if (o.phone) text(ctx, o.phone, M, 348, { size: 28, num: true, color: C.muted, align: 'left' });
        summary(ctx, 410, { debts: debts, payments: payments, balance: running, currency: o.currency, fmtNum: o.fmtNum });
        y = FIRST_TABLE_Y;
      } else {
        band(ctx, 150, { shop: o.shop + ' — ' + o.name, date: today, cont: true });
        y = NEXT_TABLE_Y;
      }
      tableHead(ctx, y);
      y += ROW_H;
      if (!list.length) text(ctx, 'لا توجد حركات بعد.', W / 2, y + 50, { size: 26, color: C.muted, align: 'center' });
      list.forEach(function (r, i) { row(ctx, y + i * ROW_H, r, i, o); });
      footer(ctx, pi + 1, pages.length);
      return jpegBytes(canvas);
    });
    return Promise.resolve(buildPdf(images));
  }

  function toBase64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  global.StatementPdf = { make: make, toBase64: toBase64 };
})(window);
