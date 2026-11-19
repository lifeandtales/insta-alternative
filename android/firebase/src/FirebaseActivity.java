package com.lifeandtales.instaalternative;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.WebView;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.Collections;
import org.json.JSONObject;

public final class FirebaseActivity extends MainActivity {
    private static final int PUSH_PERMISSION = 14;
    private JavaScriptReplyProxy permissionReply;

    @Override
    protected void configureWebView(WebView view) {
        getSystemService(NotificationManager.class).createNotificationChannel(
            new NotificationChannel("insta_messages", "Messages", NotificationManager.IMPORTANCE_DEFAULT));
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        WebViewCompat.addWebMessageListener(view, "InstaNativePush",
            Collections.singleton("https://appassets.androidplatform.net"), (web, message, origin, mainFrame, reply) -> {
                if (!mainFrame) return;
                String action = message.getData();
                if ("disable".equals(action)) {
                    FirebaseMessaging messaging = FirebaseMessaging.getInstance();
                    messaging.setAutoInitEnabled(false);
                    messaging.deleteToken().addOnCompleteListener(task ->
                        reply.postMessage(task.isSuccessful() ? "{\"disabled\":true}" : "{\"error\":\"Could not disable push\"}"));
                } else if ("enable".equals(action)) {
                    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                        if (permissionReply != null) { reply.postMessage("{\"error\":\"Permission request already open\"}"); return; }
                        permissionReply = reply;
                        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, PUSH_PERMISSION);
                    } else {
                        returnToken(reply);
                    }
                } else if ("sync".equals(action)) {
                    if (getSystemService(NotificationManager.class).areNotificationsEnabled()) returnToken(reply);
                    else reply.postMessage("{\"error\":\"Notifications are disabled\"}");
                }
            });
    }

    private void returnToken(JavaScriptReplyProxy reply) {
        FirebaseMessaging messaging = FirebaseMessaging.getInstance();
        messaging.setAutoInitEnabled(true);
        messaging.getToken().addOnCompleteListener(task -> {
            if (task.isSuccessful()) reply.postMessage("{\"token\":" + JSONObject.quote(task.getResult()) + ",\"supportsReply\":true}");
            else reply.postMessage("{\"error\":\"Could not register this Android device\"}");
        });
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code != PUSH_PERMISSION || permissionReply == null) return;
        JavaScriptReplyProxy reply = permissionReply;
        permissionReply = null;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) returnToken(reply);
        else reply.postMessage("{\"error\":\"Allow notifications in Android settings\"}");
    }
}
