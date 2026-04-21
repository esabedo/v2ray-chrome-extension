import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const srcDir = resolve(root, "src");
const outDir = resolve(root, "dist");

await mkdir(outDir, { recursive: true });
await cp(resolve(srcDir, "manifest.json"), resolve(outDir, "manifest.json"));
await cp(resolve(srcDir, "popup.html"), resolve(outDir, "popup.html"));
await cp(resolve(srcDir, "popup.css"), resolve(outDir, "popup.css"));
