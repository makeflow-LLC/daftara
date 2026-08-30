# دفترة — Debt Ledger PWA

An offline-first, Arabic, right-to-left PWA that replaces the paper debt notebook kept
behind the counter of a small grocery, pharmacy or butcher shop.

Built for a non-technical shop owner who is standing, holding a phone in one hand, and may
have no internet at all. Everything is local: no backend, no account, no login, no
analytics, no cookies.

- Vanilla HTML / CSS / JS — no framework, no build step, no bundler.
- One dependency: [Dexie.js](https://dexie.org/) (IndexedDB wrapper), loaded from a CDN
  with a local copy in `vendor/` as a fallback.
- Works fully offline after the first load, including a cold start in airplane mode.
- ~85 KB of app code, CSS, HTML and icons (Dexie adds ~94 KB).

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
| `index.html` | All five screens as static markup; JS fills in the dynamic parts. |
| `app.css` | Everything visual. Mobile-first, RTL, system fonts only. |
| `db.js` | Dexie setup, all IndexedDB reads/writes, backup validation. Exposes `window.DB`. |
| `app.js` | Screens, navigation, number pad, WhatsApp statement, backup/restore. |
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
var FREE_CUSTOMER_LIMIT  = 25;      // new customers blocked past this, with an explanation
var BACKUP_REMINDER_DAYS = 7;       // yellow banner on the home screen after this long
var OVERDUE_DAYS         = 30;      // "متأخر N يوم" past this many days since last activity
```

The currency list offered in setup and settings is the `CURRENCIES` array just below them.
`sw.js` has its own `CACHE_VERSION`.

## Backups

Backup exports every table into a single JSON file named `daftara-backup-YYYY-MM-DD.json`.
On phones that support sharing files it goes through the Web Share API (so the owner can
send it to themselves on WhatsApp); everywhere else it falls back to a normal file
download.

Restore validates the file before touching anything — shape, types, `type` being
`debt`/`payment`, and transactions pointing at a customer that exists (orphans are
dropped). It then shows a confirm dialog stating exactly what will be replaced, and only
then clears and reloads the tables. Record ids are preserved, so a restore round-trips
byte-for-byte.

The app also calls `navigator.storage.persist()` during setup and stores the result, so the
browser is less likely to evict the ledger. Settings shows the current status and offers to
request it again if it was denied.

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
6. Every interactive element passes a 48px hit-area check (number pad keys are 64px+,
   primary buttons 56px).

Plus the edge cases: overdue sorting and the red "متأخر N يوم" sub-line, the 7-day backup
banner, the 25-customer limit, deleting a customer cascading to their transactions,
hardware/browser back closing overlays, restoring a file with an orphan transaction, and
phone numbers written as `0599…`, `599…`, `+972…`, `00970…`.

## Notes on a few decisions

- **Number pad direction.** The keypad is laid out left-to-right (1 top-left, like every
  phone dialer and calculator) even though the rest of the UI is RTL, because amounts use
  Latin digits.
- **Customers with no transactions** show `لا توجد حركات` rather than `سدّد بالكامل` —
  a brand-new customer has a zero balance but has not "paid in full".
- **Deleting a customer** is available inside the edit sheet (with a confirm dialog). It is
  the escape hatch for a typo, and for freeing a slot once the free limit is reached.
- **Overpayment** (a negative balance) is shown as `رصيد لصالح الزبون` in green rather than
  being treated as an error.

## Not in scope

Login, accounts, cloud sync, inventory, products, invoices, reports, charts, multi-shop,
per-customer currencies, a dark-mode toggle, i18n, notifications, payment integration.
