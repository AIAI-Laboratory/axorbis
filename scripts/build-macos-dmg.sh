#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "DMG builds require macOS." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app_path="$repo_root/app/src-tauri/target/release/bundle/macos/Axorbis.app"
dmg_dir="$repo_root/app/src-tauri/target/release/bundle/dmg"
version="$(node -p "require('$repo_root/app/package.json').version")"
architecture="$(uname -m)"
signing_identity="${APPLE_SIGNING_IDENTITY:--}"

case "$architecture" in
  arm64) architecture="aarch64" ;;
  x86_64) architecture="x86_64" ;;
esac

output_path="$dmg_dir/Axorbis_${version}_${architecture}.dmg"
stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/axorbis-dmg-stage.XXXXXX")"
temporary_dmg="$(mktemp "${TMPDIR:-/tmp}/Axorbis_${version}_${architecture}.XXXXXX.dmg")"

cleanup() {
  rm -rf "$stage_dir"
  rm -f "$temporary_dmg"
}
trap cleanup EXIT

cd "$repo_root"
npm run tauri:build --prefix app -- --bundles app

# Tauri leaves locally built apps unsigned when no Apple certificate is
# configured. Ad-hoc signing keeps local/test installers internally valid;
# release builds can provide a Developer ID through APPLE_SIGNING_IDENTITY.
codesign --force --deep --sign "$signing_identity" "$app_path"
codesign --verify --deep --strict "$app_path"

ditto "$app_path" "$stage_dir/Axorbis.app"
ln -s /Applications "$stage_dir/Applications"

mkdir -p "$dmg_dir"
hdiutil create \
  -volname "Axorbis" \
  -srcfolder "$stage_dir" \
  -format UDZO \
  -ov \
  "$temporary_dmg" >/dev/null

mv -f "$temporary_dmg" "$output_path"
echo "Created macOS installer: $output_path"
