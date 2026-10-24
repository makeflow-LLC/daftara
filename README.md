# دفترة — Debt Ledger PWA

An offline-first, Arabic, right-to-left PWA that replaces the paper debt notebook kept
behind the counter of a small grocery, pharmacy or butcher shop.

Built for a non-technical shop owner who is standing, holding a phone in one hand, and may
have no internet at all. Everything is local: no backend, no account, no login, no
analytics, no cookies.

- Vanilla HTML / CSS / JS — no framework, no build step, no bundler.
- One dependency: [Dexie.js](https://dexie.org/) (IndexedDB wrapper), served from the
  local copy in `vendor/` only. Nothing is loaded from a third-party host.
- Works fully offline after the first load, including a cold start in airplane mode.
- ~107 KB of app code, CSS, HTML and icons (Dexie adds ~94 KB).

## Run it locally

The app needs to be served over `http://` or `https://` — a service worker and IndexedDB
do not work from `file://`. Any static server works:

```bash
# Python (already on most machines)
python3 -m http.server 8000

# or Node
npx serve .
```

Then open <http://localhost:8000> — `localhost` counts as a secure context, so the service
worker registers normally.

To test the offline behaviour: load the page once, then in DevTools → Network tick
**Offline** (or turn on airplane mode on a phone) and reload. The app shell comes from the
cache and the data from IndexedDB.

To start over with an empty ledger, delete the site data (DevTools → Application → Storage
→ Clear site data).

## Deploy to static hosting

The app is a folder of static files with **relative paths only**, so it works at the root
of a domain or in a subdirectory. Upload everything except `icons/make-icons.py` (harmless
if included):

```
index.html  app.css  app.js  db.js  sw.js  manifest.json  icons/  vendor/
```

Any static host works — GitHub Pages, Netlify, Cloudflare Pages, Vercel, S3, or a plain
nginx/Apache directory. Two requirements:

1. **Serve over HTTPS.** Service workers (and therefore offline support and "Add to home
   screen") only work on HTTPS or `localhost`.
2. **Serve `manifest.json` as `application/manifest+json` or `application/json`.** Most
   hosts do this already.

Examples:

```bash
# GitHub Pages: push this folder to the `gh-pages` branch (or enable Pages on main)
# Netlify: drag the folder onto https://app.netlify.com/drop
# Cloudflare Pages: `npx wrangler pages deploy .`
```

### After you change any file, bump the cache version

`sw.js` caches the app shell with a versioned cache name and deletes older caches on
activate. If you deploy a change without bumping the version, returning users keep the old
files. Edit one line:

```js
var CACHE_VERSION = 'v1';   // → 'v2'
```

## Files

| File | What it does |
| --- | --- |
| `index.html` | Setup, home and customer screens plus the four bottom sheets, as static markup; JS fills in the dynamic parts. |
| `app.css` | Everything visual. Mobile-first, RTL, system fonts only. |
| `db.js` | Dexie setup, all IndexedDB reads/writes, backup validation. Exposes `window.DB`. |
| `app.js` | Screens, navigation, number pad, WhatsApp statement, backup/restore. |
| `pdf.js` | Customer statement as PDF: drawn on a canvas (the browser shapes the Arabic with the device fonts), each page embedded as a JPEG in a hand-written PDF. No library, no bundled font. |
| `native.js` | Android-only additions (auto backup to `Documents/Daftara`, native share). No-op in a browser. |
| `sw.js` | Cache-first service worker for the app shell. |
| `manifest.json` | Standalone, RTL, portrait, theme colour, 192/512 icons. |
| `icons/` | PNG icons + `make-icons.py`, the script that generates them. |
| `vendor/dexie.min.js` | Local fallback copy of Dexie 4.0.11. |

## Data model

Three IndexedDB tables in a database named `daftara`:

```
customers     id (auto), name, phone, createdAt (ISO)
transactions  id (auto), customerId, type ("debt" | "payment"), amount, note, date (ISO)
settings      key ("shopName" | "currency" | "lastBackupAt" | "persistGranted"), value
```

**A balance is never stored.** It is always computed as
`sum(debts) − sum(payments)` for that customer, so history and balance can never disagree.
The home screen's "total owed" is the sum of the *positive* balances only.

## Configuration

The tunable values live at the top of `app.js`:

```js
var DEFAULT_CURRENCY     = '₪';
var DEFAULT_COUNTRY_CODE = '970';   // prefixed onto local phone numbers for wa.me links
var BACKUP_REMINDER_DAYS = 7;       // yellow banner on the home screen after this long
var OVERDUE_DAYS         = 30;      // "متأخر N يوم" once the oldest unpaid debt is this old
```

The currency list offered in setup and settings is the `CURRENCIES` array just below them.
`sw.js` has its own `CACHE_VERSION`.

## Backups

Backup exports every table into a single JSON file named `daftara-backup-YYYY-MM-DD.json`.
On phones that support sharing files it goes through the Web Share API (so the owner can
send it to themselves on WhatsApp); everywhere else it falls back to a normal file
download.

Settings has two ways to load such a file. **استيراد بيانات** merges it into the current
ledger: a customer with the same name and phone is reused, a transaction with the same type,
amount and date is skipped, and the shop name and currency are left alone, so importing the
same file twice changes nothing. **استعادة نسخة كاملة** replaces everything (also offered on
the first setup screen). An empty ledger offers the import link on the home screen.

Restore validates the file before touching anything — shape, types, `type` being
`debt`/`payment`, and transactions pointing at a customer that exists (orphans are
dropped). It then shows a confirm sheet stating exactly what will be replaced, and only
then clears and reloads the tables. Record ids are preserved, so a restore round-trips
byte-for-byte.

The app also calls `navigator.storage.persist()` during setup and stores the result, so the
browser is less likely to evict the ledger. Settings shows the current status and offers to
request it again if it was denied.

## Android app (APK)

The same web files are wrapped as an Android app with [Capacitor](https://capacitorjs.com/).
The root files stay the only source: `scripts/build-www.mjs` copies them into `www/`, and
`npx cap sync android` copies that into the Android project. Edit the web files as usual;
nothing under `android/app/src/main/assets` is committed.

Why: in the browser, "clear site data" or clearing Chrome's storage wipes the ledger. Inside
the app the data lives in the app's own storage, and `native.js` writes an automatic backup
after every change to `Documents/Daftara/daftara-YYYY-MM-DD-<ledgerId>.json` (kept 30 days).
Those files survive clearing the app's data and uninstalling it; restore them with
«استعادة نسخة», which is also offered on the first setup screen.

Every 24 hours (and from «احفظ نسخة احتياطية») the app asks where to keep a backup: a place
the owner picks with Android's file picker (Downloads, Drive, SD card…), or sent through the
share sheet (WhatsApp…). The app is also registered for `.json` files, so «فتح بواسطة دفترة»
from a file manager or WhatsApp offers to merge the file or replace the ledger. Both live in
`android/app/src/main/java/com/makeflow/daftara/DaftaraFilesPlugin.java`.

Home shows a «اليوم» strip (today's debts, payments and count; tap for the list) and a
purple strip when a customer reminder is due. Each customer can carry a note (shown on their
page and searchable) and one reminder for the owner — a date/time and a text such as «طالب
أبو خالد بالسداد». On Android, reminders and a daily «زبائن متأخرون» alert (default 9:00, set
in Settings) are local notifications scheduled on the phone for the next 7 days and
rescheduled after every change; they are inexact (no exact-alarm permission). Search matches
name, note, or phone digits without the leading 0 (0599… finds +970599…). Settings has a
light/dark/auto theme, applied before first paint from localStorage.

Deleting a customer or replacing the whole ledger from a backup asks for the fingerprint (or
the phone PIN) after the confirm sheet; in the browser, or on a phone with no fingerprint or
PIN, the confirm sheet alone is enough.

Settings also offers a fingerprint lock (Android only). The prompt accepts the phone's own
PIN/pattern as a fallback, the app relocks after a minute in the background, and it never
locks when the phone has no fingerprint or PIN any more, so the owner cannot be shut out.

Builds run in GitHub Actions (`.github/workflows/android.yml`): every push builds the APK and
boots it on an emulator; pushes to `main` also publish it to Releases. Latest APK:
<https://github.com/makeflow-LLC/daftara/releases/latest/download/daftara.apk>

Signing: the release key is never in the repository. The workflow reads it from the
`ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and
`ANDROID_KEY_PASSWORD` repository secrets, and a push to `main` fails rather than release
without them. Other branches and local builds are signed with the throwaway debug key, fine
for testing but not for handing out. Android only installs an update over an app signed with
the same key, so keep the keystore and its password safe outside GitHub too.

The Android app has no INTERNET permission (removed in the manifest with `tools:node`), so it
cannot send data anywhere; WhatsApp links open the WhatsApp app.

Local build (needs JDK 21 and the Android SDK): `npm ci && npm run apk`.
Regenerate launcher icons and splash after changing `icons/`: `python3 scripts/android-icons.py`.

## Icons

`icons/make-icons.py` writes the three PNGs with nothing but the Python standard library
(no Pillow). Run it only if you want to change the artwork or colours:

```bash
python3 icons/make-icons.py
```

## Testing

The app was verified in headless Chromium (Playwright) against the acceptance criteria:

1. Add a customer, add a 30 debt, add a 10 payment → the card shows **20** and both rows
   appear in the history, newest first.
2. Reopen offline → all data intact, app launches from cache.
3. Export a backup, clear browser storage, restore the file → identical data (ids, dates,
   notes and shop settings).
4. Home screen total equals the sum of every customer's positive balance.
5. The WhatsApp link opens as `https://wa.me/970599123456?text=…` with the statement
   correctly percent-encoded.
6. Every interactive element passes a 48px hit-area check (number pad keys are 56px,
   primary buttons 56px).

Plus the edge cases: overdue sorting and the red "متأخر N يوم" sub-line, the 7-day backup
banner, deleting a customer cascading to their transactions,
hardware/browser back closing overlays, restoring a file with an orphan transaction, and
phone numbers written as `0599…`, `599…`, `+972…`, `00970…`.

## Notes on a few decisions

- **Number pad direction.** The keypad is laid out left-to-right (1 top-left, like every
  phone dialer and calculator) even though the rest of the UI is RTL, because amounts use
  Latin digits.
- **Whole amounts only.** The keypad has a `00` key instead of a decimal point, plus
  `+5 / +10 / +20 / +50` shortcuts. Amounts recorded before this change keep their exact
  decimal value everywhere they are displayed — nothing is rounded after the fact.
- **Customers with no transactions** show `لا توجد حركات` rather than `سدّد بالكامل` —
  a brand-new customer has a zero balance but has not "paid in full".
- **Deleting a customer** is available inside the edit sheet (with a confirm sheet). It is
  the escape hatch for a typo.
- **Every modal is a bottom sheet**, confirms included, so the buttons land under the thumb
  of someone holding the phone one-handed instead of in the middle of the screen.
- **Overpayment** (a negative balance) is shown as `رصيد لصالح الزبون` in green rather than
  being treated as an error.
- **Settings, restore and storage protection** live in the settings sheet even though the
  design handoff only drew the shop name, the info lines and the backup button. Dropping
  restore would have removed half of the backup story.
- **The statement preview shows exactly what is sent** — the same six lines, the same
  total. A preview that differs from the message would be worse than no preview.

## Not in scope

Login, accounts, cloud sync, inventory, products, invoices, reports, charts, multi-shop,
per-customer currencies, a dark-mode toggle, i18n, notifications, payment integration.
