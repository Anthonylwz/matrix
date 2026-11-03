#!/usr/bin/env bash
# Construye el APK mejorado a partir del APK base y la carpeta assets/ de este repositorio.
#   ./build_apk.sh <base.apk> [salida.apk]
# Requiere: python3, Java 11+ (javac/keytool) y apksig 2.3.0 (se descarga de Maven Central).
# La clave de firma se genera la primera vez en tools/keystore/ (no se sube al repositorio).
# IMPORTANTE: Android solo instala una actualización si la firma coincide. Un APK firmado con esta
# clave no reemplaza al original: hay que desinstalar la app anterior o firmar con la clave original.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BASE="${1:?Indica el APK base}"
OUT="${2:-$HERE/../dist/asistencia-ideas-v4.2.0.apk}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
JAR="$HERE/.cache/apksig-2.3.0.jar"
mkdir -p "$HERE/.cache" "$HERE/keystore" "$(dirname "$OUT")"
if [ ! -f "$JAR" ]; then
  curl -fsSL -o "$JAR" https://repo1.maven.org/maven2/com/android/tools/build/apksig/2.3.0/apksig-2.3.0.jar
  echo "6ef7a58375aa68fb492b58edd97607bee8ee5c5c  $JAR" | sha1sum -c -
fi
KS="$HERE/keystore/ideas-release.p12"
PASS="${IDEAS_KEYSTORE_PASS:-ideas-asistencia}"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -storetype PKCS12 -keystore "$KS" -storepass "$PASS" -keypass "$PASS" \
    -alias ideas -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Asistencia IDEAS, O=Instituto IDEAS, C=PE"
fi
python3 "$HERE/repack_apk.py" "$BASE" "$HERE/../assets" "$WORK/unsigned.apk"
javac -cp "$JAR" -d "$WORK" "$HERE/SignApk.java"
java --add-exports java.base/sun.security.x509=ALL-UNNAMED --add-exports java.base/sun.security.pkcs=ALL-UNNAMED --add-exports java.base/sun.security.util=ALL-UNNAMED -cp "$JAR:$WORK" SignApk sign "$WORK/unsigned.apk" "$OUT" "$KS" "$PASS" ideas
echo "APK listo: $OUT"
