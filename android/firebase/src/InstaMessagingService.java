package com.lifeandtales.instaalternative;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.Intent;
import android.net.Uri;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public final class InstaMessagingService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(RemoteMessage message) {
        RemoteMessage.Notification payload = message.getNotification();
        String body = payload == null ? message.getData().get("body") : payload.getBody();
        if (body == null) return;
        String tag = payload == null ? message.getData().get("tag") : payload.getTag();
        if (tag == null) tag = message.getMessageId();
        if (tag == null) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (!manager.areNotificationsEnabled()) return;
        manager.createNotificationChannel(new android.app.NotificationChannel(
            "insta_messages", "Messages", NotificationManager.IMPORTANCE_DEFAULT));
        Intent launch = new Intent(this, FirebaseActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent click = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE);
        String title = payload == null ? message.getData().get("title") : payload.getTitle();
        Notification.Builder builder = new Notification.Builder(this, "insta_messages")
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(title == null || title.isEmpty() ? "Insta Alternative" : title)
            .setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setContentIntent(click)
            .setAutoCancel(true);
        Bitmap avatar = loadAvatar(message.getData().get("avatarUrl"));
        if (avatar != null) builder.setLargeIcon(avatar);
        String ticket = message.getData().get("replyTicket");
        if (ticket != null && ticket.matches("[a-f0-9-]{36}")) {
            Intent reply = new Intent(this, NotificationReplyReceiver.class)
                .setData(Uri.parse("insta-reply://conversation/" + Uri.encode(tag)))
                .putExtra("ticket", ticket).putExtra("tag", tag);
            PendingIntent action = PendingIntent.getBroadcast(this, 0, reply,
                PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification.Action.Builder replyAction = new Notification.Action.Builder(
                (android.graphics.drawable.Icon) null, "Reply", action)
                .addRemoteInput(new RemoteInput.Builder("reply_text").setLabel("Reply").build());
            if (android.os.Build.VERSION.SDK_INT >= 28)
                replyAction.setSemanticAction(Notification.Action.SEMANTIC_ACTION_REPLY);
            if (android.os.Build.VERSION.SDK_INT >= 31) replyAction.setAuthenticationRequired(true);
            builder.addAction(replyAction.build());
        }
        manager.notify(tag, 0, builder.build());
    }

    private Bitmap loadAvatar(String address) {
        if (address == null) return null;
        HttpURLConnection connection = null;
        try {
            URL url = new URL(address);
            if (!"https".equals(url.getProtocol())
                || !"nbmxfsadqflsjlibxqor.supabase.co".equals(url.getHost())
                || (url.getPort() != -1 && url.getPort() != 443)
                || url.getUserInfo() != null
                || !url.getPath().startsWith("/storage/v1/object/sign/avatars/")) return null;
            connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(1000);
            connection.setReadTimeout(1000);
            if (connection.getResponseCode() != 200) return null;
            try (java.io.InputStream input = connection.getInputStream();
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] chunk = new byte[8192];
                long deadline = android.os.SystemClock.elapsedRealtime() + 2000;
                int count;
                while ((count = input.read(chunk)) != -1) {
                    if (android.os.SystemClock.elapsedRealtime() > deadline
                        || output.size() + count > 512000) return null;
                    output.write(chunk, 0, count);
                }
                byte[] bytes = output.toByteArray();
                BitmapFactory.Options options = new BitmapFactory.Options();
                options.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
                if (options.outWidth < 1 || options.outHeight < 1) return null;
                options.inJustDecodeBounds = false;
                options.inSampleSize = 1;
                while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 192)
                    options.inSampleSize *= 2;
                return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
            }
        } catch (Exception failure) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
