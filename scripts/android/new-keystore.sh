#!/usr/bin/env bash
# Creates the release signing key for the Android app (once, ever).
#
# Android only installs an update if it is signed with the SAME key as the
# installed app. Lose this key and existing installs can never be updated, so
# back up the whole folder (keystore + keystore.properties) somewhere safe.
#
# Location: $SKR_KEYSTORE_DIR, default ~/.config/skr-bill-calendar/android
# (outside the repo; never commit it).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
KEYDIR=${SKR_KEYSTORE_DIR:-$HOME/.config/skr-bill-calendar/android}
IMAGE=skr-android-builder:1

if [[ -e "$KEYDIR/release.jks" ]]; then
  echo "A keystore already exists at $KEYDIR/release.jks; refusing to overwrite it." >&2
  exit 1
fi
mkdir -p "$KEYDIR"
chmod 700 "$KEYDIR"
docker build -q -t "$IMAGE" "$ROOT/scripts/android" >/dev/null

# PKCS12 keystores use one password for the store and the key.
PASSWORD=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)
docker run --rm --user "$(id -u):$(id -g)" -e KS_PASS="$PASSWORD" -v "$KEYDIR":/keystore:z "$IMAGE" \
  keytool -genkeypair -keystore /keystore/release.jks -storetype PKCS12 -alias skr-bill-calendar \
  -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=BillFlow" \
  -storepass:env KS_PASS -keypass:env KS_PASS >/dev/null 2>&1

umask 077
cat > "$KEYDIR/keystore.properties" <<PROPS
storeFile=release.jks
storePassword=$PASSWORD
keyAlias=skr-bill-calendar
keyPassword=$PASSWORD
PROPS
chmod 600 "$KEYDIR/release.jks" "$KEYDIR/keystore.properties"

echo "Created $KEYDIR/release.jks"
echo "BACK UP this folder now (both files). Without it you cannot release updates to installed apps."
