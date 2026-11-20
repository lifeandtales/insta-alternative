package com.lifeandtales.instaalternative;

import android.app.Activity;
import android.content.ContentValues;
import android.content.ContentResolver;
import android.content.Intent;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.WebView;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.util.Collections;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONException;
import org.json.JSONObject;

final class ReelDownloads {
    private static final long MAX_BYTES = 50_000_000;
    private static final AtomicBoolean BUSY = new AtomicBoolean();

    static void register(Activity activity, WebView view, String appHost, String storageHost) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        WebViewCompat.addWebMessageListener(view, "InstaNativeMedia", Collections.singleton("https://" + appHost),
            (web, message, origin, mainFrame, reply) -> {
                if (!mainFrame || !"https".equals(origin.getScheme()) || !appHost.equals(origin.getHost())) return;
                try {
                    JSONObject request = new JSONObject(message.getData());
                    String id = request.getString("id");
                    Uri uri = Uri.parse(request.getString("url"));
                    if ("share".equals(request.getString("action"))) {
                        if (!isShareUrl(uri)) {
                            result(reply, id, false);
                            return;
                        }
                        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain")
                            .putExtra(Intent.EXTRA_TEXT, uri.toString());
                        activity.startActivity(Intent.createChooser(send, "Share"));
                        result(reply, id, true);
                    } else if ("download".equals(request.getString("action"))) {
                        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || !isReelAsset(uri, storageHost)
                                || !BUSY.compareAndSet(false, true)) {
                            result(reply, id, false);
                            return;
                        }
                        String name = request.optString("name", "reel").replaceAll("[^a-zA-Z0-9._-]", "_");
                        name = name.substring(0, Math.min(name.length(), 90)) + "-silent";
                        String fileName = name;
                        new Thread(() -> {
                            boolean saved = download(activity, uri, fileName);
                            BUSY.set(false);
                            activity.runOnUiThread(() -> result(reply, id, saved));
                        }, "silent-reel-download").start();
                    }
                } catch (JSONException | RuntimeException ignored) {
                    // Requests with invalid data have no action.
                }
            });
    }

    private static boolean isShareUrl(Uri uri) {
        String fragment = uri.getFragment();
        return "https".equals(uri.getScheme()) && "lifeandtales.github.io".equals(uri.getHost())
            && uri.getUserInfo() == null && uri.getPort() == -1 && uri.getQuery() == null
            && "/insta-alternative/".equals(uri.getPath()) && fragment != null
            && fragment.matches("(?:reel-id-[0-9a-f-]{36}|post-id-[0-9a-f-]{36}-[0-9]+)");
    }

    private static boolean isReelAsset(Uri uri, String host) {
        String path = uri.getPath();
        return "https".equals(uri.getScheme()) && host.equals(uri.getHost()) && uri.getUserInfo() == null
            && (uri.getPort() == -1 || uri.getPort() == 443)
            && path != null && path.matches("/storage/v1/object/sign/app-media/[0-9a-f-]{36}/[0-9a-f-]{36}/video")
            && uri.getQueryParameter("token") != null;
    }

    private static void result(JavaScriptReplyProxy reply, String id, boolean ok) {
        try {
            reply.postMessage(new JSONObject().put("id", id).put("ok", ok).toString());
        } catch (JSONException | RuntimeException ignored) {
            // The page can close while a download is being prepared.
        }
    }

    private static boolean download(Activity activity, Uri uri, String name) {
        File input = null;
        File output = null;
        try {
            input = File.createTempFile("reel-input", ".video", activity.getCacheDir());
            output = File.createTempFile("reel-silent", ".mp4", activity.getCacheDir());
            fetch(uri, input);
            String mime = muxVideo(input, output);
            saveToDownloads(activity, output, name + ("video/webm".equals(mime) ? ".webm" : ".mp4"), mime);
            return true;
        } catch (IOException | RuntimeException failure) {
            return false;
        } finally {
            if (input != null) input.delete();
            if (output != null) output.delete();
        }
    }

    private static void fetch(Uri uri, File target) throws IOException {
        HttpsURLConnection connection = (HttpsURLConnection) new URL(uri.toString()).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(20_000);
        connection.setReadTimeout(20_000);
        try {
            if (connection.getResponseCode() != 200 || connection.getContentLengthLong() > MAX_BYTES) {
                throw new IOException("Reel download unavailable");
            }
            try (InputStream in = connection.getInputStream(); OutputStream out = Files.newOutputStream(target.toPath())) {
                byte[] buffer = new byte[64 * 1024];
                long total = 0;
                for (int read; (read = in.read(buffer)) != -1; ) {
                    total += read;
                    if (total > MAX_BYTES) throw new IOException("Reel too large");
                    out.write(buffer, 0, read);
                }
            }
        } finally {
            connection.disconnect();
        }
    }

    static String muxVideo(File source, File result) throws IOException {
        MediaExtractor extractor = new MediaExtractor();
        MediaMuxer muxer = null;
        try {
            extractor.setDataSource(source.getPath());
            MediaFormat format = null;
            for (int track = 0; track < extractor.getTrackCount(); track++) {
                MediaFormat candidate = extractor.getTrackFormat(track);
                String mime = candidate.getString(MediaFormat.KEY_MIME);
                if (mime == null || !mime.startsWith("video/")) continue;
                extractor.selectTrack(track);
                format = candidate;
                break;
            }
            if (format == null) throw new IOException("No video track");
            String codec = format.getString(MediaFormat.KEY_MIME);
            boolean webm = "video/x-vnd.on2.vp8".equals(codec) || "video/x-vnd.on2.vp9".equals(codec);
            muxer = new MediaMuxer(result.getPath(), webm
                ? MediaMuxer.OutputFormat.MUXER_OUTPUT_WEBM : MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            if (!webm && format.containsKey(MediaFormat.KEY_ROTATION)) muxer.setOrientationHint(format.getInteger(MediaFormat.KEY_ROTATION));
            int videoTrack = muxer.addTrack(format);
            muxer.start();
            ByteBuffer buffer = ByteBuffer.allocateDirect(256 * 1024);
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            while (extractor.getSampleTrackIndex() >= 0) {
                long size = extractor.getSampleSize();
                if (size < 0 || size > MAX_BYTES) throw new IOException("Invalid video frame");
                if (size > buffer.capacity()) buffer = ByteBuffer.allocateDirect((int) size);
                buffer.clear();
                int read = extractor.readSampleData(buffer, 0);
                if (read < 0) break;
                int flags = (extractor.getSampleFlags() & MediaExtractor.SAMPLE_FLAG_SYNC) != 0
                    ? MediaCodec.BUFFER_FLAG_KEY_FRAME : 0;
                info.set(0, read, extractor.getSampleTime(), flags);
                muxer.writeSampleData(videoTrack, buffer, info);
                extractor.advance();
            }
            muxer.stop();
            return webm ? "video/webm" : "video/mp4";
        } finally {
            extractor.release();
            if (muxer != null) muxer.release();
        }
    }

    private static void saveToDownloads(Activity activity, File file, String name, String mime) throws IOException {
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        ContentResolver resolver = activity.getContentResolver();
        Uri entry = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (entry == null) throw new IOException("Could not create download");
        try {
            try (OutputStream stream = resolver.openOutputStream(entry)) {
                if (stream == null) throw new IOException("Could not open download");
                Files.copy(file.toPath(), stream);
            }
            values.clear();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            if (resolver.update(entry, values, null, null) != 1) throw new IOException("Could not publish download");
        } catch (IOException | RuntimeException failure) {
            resolver.delete(entry, null, null);
            throw failure;
        }
    }
}
