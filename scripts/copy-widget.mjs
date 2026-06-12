// Copies the built widget bundle into the dashboard's build output so
// both are served from the same domain (https://your-app/widget.js), and
// zips the WordPress plugin so it's downloadable from the deployed app.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "apps/widget/dist/widget.js");

if (!existsSync(src)) {
  console.error("widget bundle not found — run `npm run build:widget` first");
  process.exit(1);
}

for (const dest of [
  join(root, "apps/dashboard/dist/widget.js"),
  join(root, "apps/dashboard/public/widget.js"),
]) {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(`copied widget.js -> ${dest}`);
}

try {
  const zipPath = join(root, "apps/dashboard/dist/talktogo-wordpress-plugin.zip");
  execFileSync("zip", ["-r", "-q", zipPath, "talktogo"], {
    cwd: join(root, "wordpress-plugin"),
  });
  console.log(`zipped WordPress plugin -> ${zipPath}`);
} catch (err) {
  console.warn("could not zip WordPress plugin (zip CLI unavailable?) — skipping");
}
