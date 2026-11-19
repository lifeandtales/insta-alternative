package com.lifeandtales.instaalternative;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

public final class NotificationReplyReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        Bundle input = RemoteInput.getResultsFromIntent(intent);
        if (input == null || input.getCharSequence("reply_text") == null) return;
        String text = input.getCharSequence("reply_text").toString().trim();
        String ticket = intent.getStringExtra("ticket");
        String tag = intent.getStringExtra("tag");
        if (text.isEmpty() || ticket == null || tag == null) return;
        PendingResult pending = goAsync();
        new Thread(() -> {
            try { showResult(context, tag, text.length() <= 1000 && send(ticket, text)); }
            finally { pending.finish(); }
        }, "notification-reply").start();
    }

    private boolean send(String ticket, String text) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL("https://nbmxfsadqflsjlibxqor.supabase.co/functions/v1/web-push/reply");
            connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(3500);
            connection.setReadTimeout(4000);
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setDoOutput(true);
            JSONObject body = new JSONObject().put("ticket", ticket).put("text", text);
            try (java.io.OutputStream output = connection.getOutputStream()) {
                output.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            return connection.getResponseCode() == 204;
        } catch (Exception failure) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void showResult(Context context, String tag, boolean sent) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (!manager.areNotificationsEnabled()) return;
        PendingIntent open = PendingIntent.getActivity(context, 0,
            new Intent(context, FirebaseActivity.class), PendingIntent.FLAG_IMMUTABLE);
        Notification status = new Notification.Builder(context, "insta_messages")
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle("Insta Alternative")
            .setContentText(sent ? "Reply sent" : "Reply could not be sent. Open the app to retry.")
            .setContentIntent(open)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setTimeoutAfter(sent ? 3000 : 0)
            .build();
        manager.notify(tag, 0, status);
    }
}
