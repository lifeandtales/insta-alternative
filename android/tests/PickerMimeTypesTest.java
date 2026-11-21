package com.lifeandtales.instaalternative;

import java.util.Arrays;

public final class PickerMimeTypesTest {
    private static void expect(String[] accepted, String... expected) {
        String[] actual = PickerMimeTypes.normalize(accepted);
        if (!Arrays.equals(actual, expected)) throw new AssertionError(Arrays.toString(actual));
    }
    public static void main(String[] args) {
        expect(new String[]{".jpg,.jpeg,.png,image/jpeg,video/mp4"}, "image/jpeg", "image/png", "video/mp4");
        expect(new String[]{" image/* ", "video/*"}, "image/*", "video/*");
        expect(new String[]{".PDF, application/pdf"}, "application/pdf");
        expect(new String[]{".MP4,.mov"}, "video/mp4", "video/quicktime");
        expect(new String[]{".unsupported"}, "*/*");
        expect(new String[]{"image/jpeg", "*/*"}, "*/*");
        expect(new String[]{null, ""}, "*/*");
        expect(null, "*/*");
        System.out.println("Picker MIME normalization checks passed");
    }
}
