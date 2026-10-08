#!/usr/bin/env bash
# Builds the Android app. Needs only Docker and Node (the Android SDK runs in a container).
#
#   scripts/build-apk.sh            signed release APK  (needs scripts/android/new-keystore.sh once)
#   scripts/build-apk.sh debug      debug APK (debuggable; used by the emulator tests)
#
# Output: dist-apk/bill-calendar-<version>[-debug].apk. The version comes from frontend/package.json.
set -euo pipefail

MODE=${1:-release}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
IMAGE=skr-android-builder:1
KEYDIR=${SKR_KEYSTORE_DIR:-$HOME/.config/skr-bill-calendar/android}
VERSION=$(node -p "require('$ROOT/frontend/package.json').version")

case "$MODE" in
  release)
    if [[ ! -f "$KEYDIR/keystore.properties" ]]; then
      echo "No signing key in $KEYDIR. Create one with scripts/android/new-keystore.sh (or set SKR_KEYSTORE_DIR)." >&2
      exit 1
    fi
    TASK=assembleRelease
    SIGNING=(-v "$KEYDIR":/keystore:ro,z)
    PROPS=(-PskrKeystoreProperties=/keystore/keystore.properties)
    OUT=frontend/android/app/build/outputs/apk/release/app-release.apk
    DEST=dist-apk/bill-calendar-$VERSION.apk
    ;;
  debug)
    TASK=assembleDebug
    SIGNING=()
    PROPS=()
    OUT=frontend/android/app/build/outputs/apk/debug/app-debug.apk
    DEST=dist-apk/bill-calendar-$VERSION-debug.apk
    ;;
  *)
    echo "usage: $0 [release|debug]" >&2
    exit 2
    ;;
esac

echo "==> Build image"
docker build -q -t "$IMAGE" "$ROOT/scripts/android" >/dev/null
docker volume create skr-android-cache >/dev/null

echo "==> Web app (standalone) $VERSION"
(cd "$ROOT" && npm run build:standalone -w frontend >/dev/null)
(cd "$ROOT/frontend" && npx cap sync android >/dev/null)

echo "==> Gradle $TASK"
docker run --rm --user "$(id -u):$(id -g)" \
  -v skr-android-cache:/cache -v "$ROOT":/src:z "${SIGNING[@]}" \
  -w /src/frontend/android "$IMAGE" ./gradlew --no-daemon -q "$TASK" "${PROPS[@]}"

mkdir -p "$ROOT/dist-apk"
cp "$ROOT/$OUT" "$ROOT/$DEST"
if [[ "$MODE" == release ]]; then
  echo "==> Signature"
  docker run --rm -v "$ROOT/dist-apk":/apk:ro,z "$IMAGE" \
    /opt/android-sdk/build-tools/35.0.0/apksigner verify --print-certs "/apk/$(basename "$DEST")" | grep -E "Signer #1 certificate (DN|SHA-256)"
fi
echo "==> $DEST ($(du -h "$ROOT/$DEST" | cut -f1))"
