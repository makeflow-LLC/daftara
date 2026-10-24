package com.makeflow.daftara;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * ملفات دفترة على أندرويد:
 *  - saveAs: يفتح منتقي الملفات في النظام ليختار صاحب المحل أين يحفظ الملف
 *    (التنزيلات، Drive، بطاقة الذاكرة...) ثم يكتبه هناك: نص (data) أو ثنائي (base64)
 *    مثل كشف الحساب PDF.
 *  - فتح ملف .json من مدير الملفات أو واتساب بـ «فتح بواسطة دفترة»: يُحفظ رابطه
 *    ويُطلق الحدث fileOpened، ويقرؤه التطبيق بـ takeOpenedFile.
 */
@CapacitorPlugin(name = "DaftaraFiles")
public class DaftaraFilesPlugin extends Plugin {

    private static final int MAX_BYTES = 20 * 1024 * 1024;
    private Uri pendingUri;

    @Override
    public void load() {
        take(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (take(intent)) notifyListeners("fileOpened", new JSObject(), true);
    }

    @SuppressWarnings("deprecation")
    private boolean take(Intent intent) {
        if (intent == null) return false;
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(intent.getAction())) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(intent.getAction())) {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        }
        if (uri == null) return false;
        pendingUri = uri;
        // حتى لا يُعاد فتح الملف نفسه عند إعادة إنشاء الشاشة (تدوير الجوال مثلًا)
        intent.setAction(Intent.ACTION_MAIN);
        intent.setData(null);
        return true;
    }

    @PluginMethod
    public void takeOpenedFile(PluginCall call) {
        JSObject ret = new JSObject();
        Uri uri = pendingUri;
        pendingUri = null;
        if (uri == null) {
            call.resolve(ret);
            return;
        }
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) throw new Exception("no stream");
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = in.read(chunk)) != -1) {
                buf.write(chunk, 0, n);
                if (buf.size() > MAX_BYTES) throw new Exception("file too large");
            }
            ret.put("name", displayName(uri));
            ret.put("text", new String(buf.toByteArray(), StandardCharsets.UTF_8));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("read failed: " + e.getMessage());
        }
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {}
        return uri.getLastPathSegment();
    }

    @PluginMethod
    public void saveAs(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mime", "application/json"));
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("filename", "daftara-backup.json"));
        startActivityForResult(call, intent, "saveAsResult");
    }

    @ActivityCallback
    private void saveAsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            ret.put("saved", false);
            call.resolve(ret);
            return;
        }
        try (OutputStream out = getContext().getContentResolver().openOutputStream(data.getData())) {
            if (out == null) throw new Exception("no stream");
            String b64 = call.getString("base64");
            out.write(b64 != null ? Base64.decode(b64, Base64.DEFAULT) : call.getString("data", "").getBytes(StandardCharsets.UTF_8));
            ret.put("saved", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("write failed: " + e.getMessage());
        }
    }
}
