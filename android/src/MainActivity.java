package com.lifeandtales.instaalternative;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.ClipDescription;
import android.os.ResultReceiver;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.InputConnectionWrapper;
import android.view.inputmethod.InputContentInfo;
import android.util.Base64;
import org.json.JSONObject;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Collections;

public class MainActivity extends Activity {
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String STORAGE_HOST = "nbmxfsadqflsjlibxqor.supabase.co";
    private static final int PICK_FILES = 1;
    private static final int MEDIA_PERMISSION = 2;
    private static final int PAGE_BACKGROUND = Color.rgb(248, 245, 241);
    private WebView web;
    private ValueCallback<Uri[]> fileResult;
    private PermissionRequest mediaRequest;

    private boolean receiveKeyboardContent(InputContentInfo content, int flags) {
        if (content == null || !"content".equals(content.getContentUri().getScheme())) return false;
        final boolean permission = (flags & InputConnection.INPUT_CONTENT_GRANT_READ_URI_PERMISSION) != 0;
        // InputConnection callbacks may run off the UI thread. Never access WebView here.
        try { if (permission) content.requestPermission(); }
        catch (RuntimeException denied) { return false; }
        new Thread(() -> {
            try (InputStream input = getContentResolver().openInputStream(content.getContentUri());
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                if (input == null) throw new IOException("Missing keyboard content");
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (output.size() + count > 10000000) throw new IOException("Sticker too large");
                    output.write(buffer, 0, count);
                }
                byte[] bytes = output.toByteArray();
                String mime = keyboardImageMime(bytes);
                if (mime == null) throw new IOException("Unsupported keyboard image");
                JSONObject detail = new JSONObject();
                detail.put("mime", mime);
                detail.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
                runOnUiThread(() -> {
                    if (!isDestroyed() && isAssetOrigin(Uri.parse(web.getUrl()))) {
                        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('android-chat-content',{detail:" + detail + "}))", null);
                    }
                });
            } catch (Exception failure) {
                runOnUiThread(() -> {
                    if (!isDestroyed()) Toast.makeText(MainActivity.this,
                        "Could not open this sticker. Choose a GIF, WebP, PNG or JPEG up to 10 MB.", Toast.LENGTH_SHORT).show();
                });
            } finally {
                if (permission) {
                    try { content.releasePermission(); } catch (RuntimeException ignored) {}
                }
            }
        }, "keyboard-media").start();
        return true;
    }

    private static String keyboardImageMime(byte[] bytes) {
        if (bytes.length >= 6 && bytes[0] == 'G' && bytes[1] == 'I' && bytes[2] == 'F'
            && bytes[3] == '8' && (bytes[4] == '7' || bytes[4] == '9') && bytes[5] == 'a') return "image/gif";
        if (bytes.length >= 8 && (bytes[0] & 255) == 137 && bytes[1] == 'P' && bytes[2] == 'N'
            && bytes[3] == 'G' && bytes[4] == 13 && bytes[5] == 10 && bytes[6] == 26 && bytes[7] == 10) return "image/png";
        if (bytes.length >= 12 && bytes[0] == 'R' && bytes[1] == 'I' && bytes[2] == 'F' && bytes[3] == 'F'
            && bytes[8] == 'W' && bytes[9] == 'E' && bytes[10] == 'B' && bytes[11] == 'P') return "image/webp";
        if (bytes.length >= 3 && (bytes[0] & 255) == 255 && (bytes[1] & 255) == 216
            && (bytes[2] & 255) == 255) return "image/jpeg";
        return null;
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setBackgroundDrawable(new ColorDrawable(PAGE_BACKGROUND));
        web = new WebView(this) {
            @Override
            public InputConnection onCreateInputConnection(EditorInfo editor) {
                InputConnection connection = super.onCreateInputConnection(editor);
                if (connection == null) return null;
                String[] types = new String[] { "image/*" };
                editor.contentMimeTypes = types;
                if (editor.extras == null) editor.extras = new Bundle();
                editor.extras.putStringArray("androidx.core.view.inputmethod.EditorInfoCompat.CONTENT_MIME_TYPES", types);
                editor.extras.putStringArray("android.support.v13.view.inputmethod.EditorInfoCompat.CONTENT_MIME_TYPES", types);
                return new InputConnectionWrapper(connection, false) {
                    @Override
                    public boolean commitContent(InputContentInfo content, int flags, Bundle options) {
                        return receiveKeyboardContent(content, flags);
                    }

                    @Override
                    public boolean performPrivateCommand(String action, Bundle data) {
                        String prefix;
                        if ("androidx.core.view.inputmethod.InputConnectionCompat.COMMIT_CONTENT".equals(action)) {
                            prefix = "androidx.core.view.inputmethod.InputConnectionCompat.";
                        } else if ("android.support.v13.view.inputmethod.InputConnectionCompat.COMMIT_CONTENT".equals(action)) {
                            prefix = "android.support.v13.view.inputmethod.InputConnectionCompat.";
                        } else return super.performPrivateCommand(action, data);
                        if (data == null) return false;
                        ResultReceiver receiver = null;
                        boolean accepted = false;
                        try {
                            receiver = data.getParcelable(prefix + "CONTENT_RESULT_RECEIVER");
                            Uri uri = data.getParcelable(prefix + "CONTENT_URI");
                            ClipDescription description = data.getParcelable(prefix + "CONTENT_DESCRIPTION");
                            Uri link = data.getParcelable(prefix + "CONTENT_LINK_URI");
                            if (uri != null && description != null) {
                                accepted = receiveKeyboardContent(new InputContentInfo(uri, description, link),
                                    data.getInt(prefix + "CONTENT_FLAGS"));
                            }
                        } catch (RuntimeException invalidContent) {
                            accepted = false;
                        } finally {
                            if (receiver != null) {
                                try { receiver.send(accepted ? 1 : 0, null); }
                                catch (RuntimeException ignored) {}
                            }
                        }
                        return accepted;
                    }
                };
            }
        };
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!isAssetOrigin(uri)) return null;
                String path = uri.getPath();
                if (path == null || path.equals("/")) path = "/index.html";
                try {
                    WebResourceResponse response = new WebResourceResponse(contentType(path), "UTF-8",
                        getAssets().open("web" + path));
                    if (path.equals("/index.html")) {
                        response.setResponseHeaders(Collections.singletonMap("Cache-Control", "no-store"));
                    }
                    return response;
                } catch (IOException missing) {
                    return new WebResourceResponse("text/plain", "UTF-8", 404,
                        "Not Found", Collections.emptyMap(), null);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!request.isForMainFrame() || isAssetOrigin(uri)) return false;
                if (isChatDownload(uri)) {
                    queueChatDownload(uri);
                    return true;
                }
                String scheme = uri.getScheme();
                if ("https".equals(scheme) || "http".equals(scheme) || "tel".equals(scheme)) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (ActivityNotFoundException ignored) {}
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileResult != null) fileResult.onReceiveValue(null);
                fileResult = callback;
                try { startActivityForResult(params.createIntent(), PICK_FILES); }
                catch (ActivityNotFoundException unavailable) {
                    fileResult = null;
                    callback.onReceiveValue(null);
                }
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                if (!isAssetOrigin(request.getOrigin()) || mediaRequest != null) {
                    request.deny();
                    return;
                }
                List<String> permissions = new ArrayList<>();
                for (String resource : request.getResources()) {
                    String permission = nativePermission(resource);
                    if (permission != null && checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED
                        && !permissions.contains(permission)) permissions.add(permission);
                }
                if (permissions.isEmpty()) {
                    finishMediaRequest(request);
                } else {
                    mediaRequest = request;
                    requestPermissions(permissions.toArray(new String[0]), MEDIA_PERMISSION);
                }
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (mediaRequest == request) mediaRequest = null;
            }
        });
        web.setDownloadListener((url, userAgent, disposition, mimeType, length) -> {
            Uri uri = Uri.parse(url);
            if (isChatDownload(uri)) queueChatDownload(uri);
        });
        configureWebView(web);
        web.setBackgroundColor(PAGE_BACKGROUND);
        setContentView(web);
        if (state == null || web.restoreState(state) == null) web.loadUrl("https://" + ASSET_HOST + "/");
    }

    protected void configureWebView(WebView view) {}

    private static boolean isAssetOrigin(Uri uri) {
        return "https".equals(uri.getScheme()) && ASSET_HOST.equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private static boolean isChatDownload(Uri uri) {
        return "https".equals(uri.getScheme()) && STORAGE_HOST.equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443)
            && uri.getPath() != null && (uri.getPath().startsWith("/storage/v1/object/sign/chat-attachments/") || uri.getPath().startsWith("/storage/v1/object/sign/community-media/"))
            && uri.getQueryParameter("download") != null && uri.getQueryParameter("token") != null;
    }

    private void queueChatDownload(Uri uri) {
        String name = uri.getQueryParameter("download").replaceAll("[\\p{Cntrl}/\\\\]", "_").trim();
        if (name.isEmpty() || name.equals(".") || name.equals("..")) name = "Chat attachment";
        try {
            DownloadManager.Request request = new DownloadManager.Request(uri)
                .setTitle(name)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            }
            getSystemService(DownloadManager.class).enqueue(request);
        } catch (RuntimeException failure) {
            Toast.makeText(this, "Could not start this download.", Toast.LENGTH_SHORT).show();
        }
    }

    private static String contentType(String path) {
        if (path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    private static String nativePermission(String resource) {
        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) return Manifest.permission.RECORD_AUDIO;
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) return Manifest.permission.CAMERA;
        return null;
    }

    private void finishMediaRequest(PermissionRequest request) {
        List<String> granted = new ArrayList<>();
        for (String resource : request.getResources()) {
            String permission = nativePermission(resource);
            if (permission != null && checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) granted.add(resource);
        }
        if (granted.isEmpty()) request.deny();
        else request.grant(granted.toArray(new String[0]));
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == MEDIA_PERMISSION && mediaRequest != null) {
            finishMediaRequest(mediaRequest);
            mediaRequest = null;
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == PICK_FILES && fileResult != null) {
            ValueCallback<Uri[]> callback = fileResult;
            fileResult = null;
            callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        web.saveState(state);
        super.onSaveInstanceState(state);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (fileResult != null) fileResult.onReceiveValue(null);
        if (mediaRequest != null) mediaRequest.deny();
        web.destroy();
        super.onDestroy();
    }
}
