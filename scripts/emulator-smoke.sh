#!/usr/bin/env bash
# اختبار دخان على محاكي أندرويد (يُشغَّل من .github/workflows/android.yml):
# يثبّت الـ APK، يمرّ بشاشة الإعداد، يضيف زبونًا، ثم يتأكد أن النسخة التلقائية
# كُتبت في Documents/Daftara وفيها الزبون.
set -euo pipefail
PKG=com.makeflow.daftara
on_exit() {
  adb exec-out screencap -p > screenshot.png || true
  echo "--- on screen:"; grep -o 'text="[^"]*"' ui.xml 2>/dev/null | sort -u | head -40 || true
  echo "--- logcat:"; adb logcat -d | grep -iE "Capacitor|daftara|FATAL" | tail -n 60 || true
}
trap on_exit EXIT

# يضغط على أول عنصر نصّه (أو وصفه) يطابق $1، كما يراه UiAutomator داخل الـ WebView
tap() {
  for _ in $(seq 1 15); do
    adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
    adb shell cat /sdcard/ui.xml > ui.xml 2>/dev/null || true
    xy=$(python3 - "$1" <<'PY'
import re, sys
xml = open('ui.xml', encoding='utf-8', errors='ignore').read()
for node in re.findall(r'<node [^>]*>', xml):
    t = re.search(r' text="([^"]*)"', node); d = re.search(r'content-desc="([^"]*)"', node)
    if sys.argv[1] in ((t.group(1) if t else '') + '|' + (d.group(1) if d else '')):
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
        if b:
            x1, y1, x2, y2 = map(int, b.groups())
            if x2 > x1 and y2 > y1:
                print((x1 + x2) // 2, (y1 + y2) // 2); break
PY
)
    if [ -n "$xy" ]; then echo "tap '$1' at $xy"; adb shell input tap $xy; return 0; fi
    sleep 2
  done
  echo "::error::'$1' not found on screen"; grep -o 'text="[^"]*"' ui.xml | sort -u | head -40 || true
  return 1
}

adb install -r daftara.apk
adb shell am start -W -n $PKG/.MainActivity
sleep 8

# 1) شاشة الإعداد: «التالي» والاسم فارغ ينتظر ظهور الشاشة ويضع التركيز في حقل اسم المحل
tap 'التالي'
adb shell input text 'Shop1'
adb shell input keyevent 4   # إخفاء لوحة المفاتيح؛ كانت تغطي الزر
sleep 1
tap 'التالي'
sleep 3

# 2) الشاشة الرئيسية: زبون جديد
tap 'زبون جديد'
sleep 2
adb shell input text 'Ali'
adb shell input keyevent 4   # إخفاء لوحة المفاتيح
sleep 1
tap 'حفظ'
sleep 6   # النسخة التلقائية
tap 'Ali' >/dev/null || true   # تحديث ui.xml للتشخيص: هل حُفظ الزبون؟ تُكتب بعد ثانيتين من آخر تعديل

adb shell pidof $PKG

# 3) النسخة التلقائية في ذاكرة الجوال
echo "--- Documents/Daftara:"
adb shell ls -l /sdcard/Documents/Daftara/
f=$(adb shell ls /sdcard/Documents/Daftara/ | tr -d '\r' | grep '^daftara-.*\.json$' | head -n1)
[ -n "$f" ] || { echo "::error::no auto backup file"; exit 1; }
adb shell cat "/sdcard/Documents/Daftara/$f" > backup.json
grep -q '"name":"Ali"' backup.json || { echo "::error::backup missing customer"; cat backup.json; exit 1; }
echo "auto backup OK: $f"
