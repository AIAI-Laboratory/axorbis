import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(root, "img/icon.svg"), "utf8");
const originalViewBox = 'viewBox="0 0 750 749.999995"';
if (!source.includes(originalViewBox)) {
  throw new Error("Unexpected Axorbis icon viewBox; review the desktop safe area before regenerating icons.");
}

// macOS Dock magnifies the icon tile. Keep the supplied artwork intact while
// giving the generated app icon a transparent optical safe area around it.
const padded = source.replace(originalViewBox, 'viewBox="-125 -125 1000 1000"');
const temp = mkdtempSync(join(tmpdir(), "axorbis-desktop-icon-"));
try {
  const input = join(temp, "icon.svg");
  const output = join(temp, "generated");
  writeFileSync(input, padded);
  const result = spawnSync(
    resolve(root, "app/node_modules/.bin/tauri"),
    ["icon", input, "--output", output],
    { cwd: resolve(root, "app"), stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  } else {
    for (const name of [
      "icon.png", "icon.icns", "icon.ico", "32x32.png", "64x64.png", "128x128.png", "128x128@2x.png",
      "StoreLogo.png", "Square30x30Logo.png", "Square44x44Logo.png", "Square71x71Logo.png",
      "Square89x89Logo.png", "Square107x107Logo.png", "Square142x142Logo.png",
      "Square150x150Logo.png", "Square284x284Logo.png", "Square310x310Logo.png",
    ]) {
      copyFileSync(join(output, name), resolve(root, "app/src-tauri/icons", name));
    }
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
