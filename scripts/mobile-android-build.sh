#!/usr/bin/env bash
# Generated native sources and trust anchor belong only to this disposable test APK.
set -euo pipefail
: "${RUNNER_TEMP:?}" "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?}"
export CI=1 EXPO_NO_TELEMETRY=1
export EXPO_PUBLIC_CUSTOMER_API_URL=https://127.0.0.1:3444
export EXPO_PUBLIC_SUPABASE_URL=https://127.0.0.1:3444
export EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY"
cd gridex-web/apps/mobile
npm exec --no -- expo prebuild --platform android --no-install
python3 - "$RUNNER_TEMP/ops.crt" <<'PY'
from pathlib import Path
import shutil,sys,xml.etree.ElementTree as ET
res=Path('android/app/src/main/res')
(res/'raw').mkdir(exist_ok=True); (res/'xml').mkdir(exist_ok=True)
shutil.copyfile(sys.argv[1],res/'raw'/'integration_ca.crt')
(res/'xml'/'integration_network_security.xml').write_text('<network-security-config><base-config cleartextTrafficPermitted="false"><trust-anchors><certificates src="@raw/integration_ca"/></trust-anchors></base-config></network-security-config>')
manifest=Path('android/app/src/main/AndroidManifest.xml')
ET.register_namespace('android','http://schemas.android.com/apk/res/android')
tree=ET.parse(manifest);tree.getroot().find('application').set('{http://schemas.android.com/apk/res/android}networkSecurityConfig','@xml/integration_network_security');tree.write(manifest,encoding='utf-8',xml_declaration=True)
PY
(cd android && ./gradlew --no-daemon :app:assembleRelease -PreactNativeArchitectures=x86_64)
apk=android/app/build/outputs/apk/release/app-release.apk
build_tools="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
"$build_tools/apksigner" verify "$apk"
"$build_tools/aapt" dump badging "$apk" > "$RUNNER_TEMP/mobile-apk-badging.txt"
python3 - "$RUNNER_TEMP/mobile-apk-badging.txt" <<'PY'
import sys
s=open(sys.argv[1]).read();assert "package: name='se.gridex.el.dev'" in s;assert "versionName='0.1.0'" in s
PY
mkdir -p "$RUNNER_TEMP/mobile-android"
cp "$apk" "$RUNNER_TEMP/mobile-android/gridex-el-isolated-test.apk"
(cd "$RUNNER_TEMP/mobile-android" && sha256sum gridex-el-isolated-test.apk > SHA256SUMS)
