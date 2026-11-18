#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
sdk="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
jdk="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
tools="$sdk/build-tools/${ANDROID_BUILD_TOOLS:-36.0.0}"
platform="$sdk/platforms/${ANDROID_PLATFORM:-android-37.0}/android.jar"
work="$root/work/android-build"
mode="${1:-app}"
case "$mode" in
    app) output="$root/outputs/insta-alternative-debug.apk" ;;
    *) printf 'Usage: %s [app]\n' "$0" >&2; exit 2 ;;
esac

mkdir -p "$work" "$root/outputs"
build="$(mktemp -d "$work/build.XXXXXX")"
trap 'rm -rf "$build"' EXIT
mkdir -p "$build/assets/web" "$build/classes" "$build/dex"
manifest="$root/android/AndroidManifest.xml"
if [[ "$mode" == admin ]]; then
    web="$build/assets/web"
    mkdir -p "$web/styles" "$web/src/features" "$web/src/storage"
    sed 's|<a href="./index.html">Insta Alternative</a>|<span>Insta Alternative</span>|' \
        "$root/admin.html" > "$web/index.html"
    cp "$root/styles/admin-dashboard.css" "$web/styles/"
    cp "$root/src/features/admin-dashboard.js" "$root/src/features/admin-users.js" "$web/src/features/"
    cp "$root/src/storage/supabase.js" "$web/src/storage/"
    manifest="$build/AndroidManifest.xml"
    sed -e 's/package="com.lifeandtales.instaalternative"/package="com.lifeandtales.instaalternative.admin"/' \
        -e 's/android:name=".MainActivity"/android:name="com.lifeandtales.instaalternative.MainActivity"/' \
        -e 's/android:label="Insta Alternative"/android:label="Insta Alternative Admin"/' \
        -e '/android.permission.RECORD_AUDIO/d' -e '/android.permission.CAMERA/d' -e '/android.permission.MODIFY_AUDIO_SETTINGS/d' \
        "$root/android/AndroidManifest.xml" > "$manifest"
else
    cp -R "$root/index.html" "$root/app.js" "$root/styles.css" "$root/src" "$root/styles" "$build/assets/web/"
fi
export JAVA_HOME="$jdk"
export PATH="$jdk/bin:$PATH"
"$tools/aapt2" link -I "$platform" --manifest "$manifest" \
    -A "$build/assets" -o "$build/unsigned.apk"
"$jdk/bin/javac" --release 8 -cp "$platform" -d "$build/classes" "$root/android/src/MainActivity.java"
"$jdk/bin/jar" cf "$build/classes.jar" -C "$build/classes" .
"$tools/d8" --min-api 26 --lib "$platform" --output "$build/dex" "$build/classes.jar"
(cd "$build/dex" && zip -q "$build/unsigned.apk" classes.dex)
"$tools/zipalign" -f 4 "$build/unsigned.apk" "$build/aligned.apk"

keystore="$work/debug.keystore"
if [[ ! -f "$keystore" ]]; then
    "$jdk/bin/keytool" -genkeypair -keystore "$keystore" -storepass android -keypass android \
        -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Android Debug,O=Android,C=US'
fi
"$tools/apksigner" sign --ks "$keystore" --ks-key-alias androiddebugkey --ks-pass pass:android \
    --key-pass pass:android --out "$output" "$build/aligned.apk"
"$tools/apksigner" verify "$output"
printf '%s\n' "$output"
