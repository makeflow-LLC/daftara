// ينسخ ملفات التطبيق (الويب) إلى مجلد واحد نظيف.
// يستخدمه نشر GitHub Pages وتطبيق أندرويد معًا، فتبقى ملفات الجذر هي المصدر الوحيد.
//   node scripts/build-www.mjs <المجلد>
import { cpSync, rmSync, mkdirSync } from 'node:fs';

const FILES = [
  'index.html', 'app.css', 'app.js', 'db.js', 'native.js', 'sw.js',
  'manifest.json', '_headers', '.nojekyll', 'icons', 'vendor'
];

const out = process.argv[2];
if (!out) { console.error('usage: build-www.mjs <dir>'); process.exit(1); }

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of FILES) cpSync(f, `${out}/${f}`, { recursive: true });
rmSync(`${out}/icons/make-icons.py`, { force: true });
console.log(`copied ${FILES.length} entries to ${out}/`);
