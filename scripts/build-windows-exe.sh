#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="x86_64-pc-windows-msvc"
version="$(node -p "require('$repo_root/app/package.json').version")"
runner_args=()

if [[ "$(uname -s)" == "Darwin" ]]; then
  for formula in llvm lld; do
    formula_prefix="$(brew --prefix "$formula")"
    PATH="$formula_prefix/bin:$PATH"
  done
  export PATH

  for tool in cargo-xwin llvm-rc lld-link makensis; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "Missing Windows cross-build tool: $tool" >&2
      exit 1
    fi
  done
  runner_args=(--runner cargo-xwin)
fi

cd "$repo_root"
npm run tauri:build --prefix app -- \
  "${runner_args[@]}" \
  --target "$target" \
  --bundles nsis

installer_dir="$repo_root/app/src-tauri/target/$target/release/bundle/nsis"
installer="$installer_dir/Axorbis_${version}_x64-setup.exe"

if [[ -z "$installer" || ! -f "$installer" ]]; then
  echo "Windows NSIS installer was not produced under $installer_dir." >&2
  exit 1
fi

file "$installer"
echo "Created Windows installer: $installer"
