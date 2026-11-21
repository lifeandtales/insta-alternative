package com.lifeandtales.instaalternative;

import java.util.LinkedHashSet;
import java.util.Locale;

/** Converts HTML accept values into the MIME filters Android's document picker accepts. */
final class PickerMimeTypes {
    private PickerMimeTypes() {}

    static String[] normalize(String[] accepted) {
        LinkedHashSet<String> types = new LinkedHashSet<>();
        if (accepted != null) for (String group : accepted) {
            if (group == null) continue;
            for (String value : group.split(",")) {
                String type = value.trim().toLowerCase(Locale.ROOT);
                if (type.startsWith(".")) type = fromExtension(type);
                if (type.matches("[a-z0-9!#$&^_.+*-]+/[a-z0-9!#$&^_.+*-]+")) types.add(type);
            }
        }
        if (types.isEmpty() || types.contains("*/*")) return new String[]{"*/*"};
        return types.toArray(new String[0]);
    }

    private static String fromExtension(String extension) {
        switch (extension) {
            case ".jpg": case ".jpeg": return "image/jpeg";
            case ".png": return "image/png";
            case ".gif": return "image/gif";
            case ".webp": return "image/webp";
            case ".avif": return "image/avif";
            case ".heic": return "image/heic";
            case ".heif": return "image/heif";
            case ".bmp": return "image/bmp";
            case ".tif": case ".tiff": return "image/tiff";
            case ".mp4": case ".m4v": return "video/mp4";
            case ".mov": return "video/quicktime";
            case ".webm": return "video/webm";
            case ".3gp": return "video/3gpp";
            case ".ogv": return "video/ogg";
            case ".pdf": return "application/pdf";
            default: return "";
        }
    }
}
