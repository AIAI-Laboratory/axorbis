#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "DMG verification requires macOS." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dmg_dir="$repo_root/app/src-tauri/target/release/bundle/dmg"
dmg_path="${1:-}"

if [[ -z "$dmg_path" ]]; then
  version="$(node -p "require('$repo_root/app/package.json').version")"
  architecture="$(uname -m)"
  case "$architecture" in
    arm64) architecture="aarch64" ;;
    x86_64) architecture="x86_64" ;;
  esac
  dmg_path="$dmg_dir/Axorbis_${version}_${architecture}.dmg"
fi

if [[ -z "$dmg_path" || ! -f "$dmg_path" ]]; then
  echo "Axorbis DMG not found under $dmg_dir." >&2
  exit 1
fi

mount_dir="$(mktemp -d "${TMPDIR:-/tmp}/axorbis-dmg.XXXXXX")"
mounted=0

cleanup() {
  if [[ "$mounted" == "1" ]]; then
    hdiutil detach "$mount_dir" >/dev/null 2>&1 || true
  fi
  rmdir "$mount_dir" >/dev/null 2>&1 || true
}
trap cleanup EXIT

hdiutil verify "$dmg_path" >/dev/null
hdiutil attach -readonly -nobrowse -mountpoint "$mount_dir" "$dmg_path" >/dev/null
mounted=1

if [[ ! -d "$mount_dir/Axorbis.app" ]]; then
  echo "Invalid DMG: Axorbis.app is missing." >&2
  exit 1
fi

if [[ ! -L "$mount_dir/Applications" || "$(readlink "$mount_dir/Applications")" != "/Applications" ]]; then
  echo "Invalid DMG: the /Applications install shortcut is missing." >&2
  exit 1
fi

codesign --verify --deep --strict "$mount_dir/Axorbis.app"
echo "Verified installable DMG: $dmg_path"
