import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function run() {
  const dir = process.argv[2];
  if (!dir) {
    throw new Error("Usage: node scripts/verify-release-assets.mjs <assets-dir>");
  }

  const names = await readdir(dir);
  const pkgFiles = names.filter((name) => name.endsWith(".pkg"));
  const msiFiles = names.filter((name) => name.endsWith(".msi"));
  if (pkgFiles.length === 0) {
    throw new Error("No .pkg artifacts found");
  }
  if (msiFiles.length === 0) {
    throw new Error("No .msi artifacts found");
  }

  const sumsPath = join(dir, "SHA256SUMS.txt");
  const sums = await readFile(sumsPath, "utf8");
  for (const artifact of [...pkgFiles, ...msiFiles]) {
    if (!sums.includes(`  ${artifact}`)) {
      throw new Error(`Checksum entry missing for ${artifact}`);
    }
  }
  console.log(`Verified assets: ${pkgFiles.length} pkg, ${msiFiles.length} msi`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
