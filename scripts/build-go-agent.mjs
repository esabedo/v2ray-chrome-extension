import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const root = process.cwd();
const goAgentDir = resolve(root, "go-agent");
const outDir = resolve(goAgentDir, "bin");
const goBin = existsSync("/usr/local/go/bin/go") ? "/usr/local/go/bin/go" : "go";

await mkdir(outDir, { recursive: true });

const args = ["build", "-o", "./bin/v2ray-agent", "./cmd/agent"];

const exitCode = await new Promise((resolveCode, rejectCode) => {
  const child = spawn(goBin, args, {
    cwd: goAgentDir,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  child.on("error", rejectCode);
  child.on("close", resolveCode);
});

if (exitCode !== 0) {
  process.exit(exitCode ?? 1);
}
