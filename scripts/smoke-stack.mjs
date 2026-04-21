import { spawn, spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const isWindows = process.platform === "win32";
const agentBin = isWindows ? join(root, "go-agent", "bin", "v2ray-agent.exe") : join(root, "go-agent", "bin", "v2ray-agent");
const singboxBin = isWindows ? join(root, "agent", "bin", "sing-box.exe") : join(root, "agent", "bin", "sing-box");
const smokeScript = join(root, "scripts", "smoke-agent.mjs");

async function waitForHealth(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch("http://127.0.0.1:8777/v1/health");
      if (response.ok) return;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error("Timed out waiting for local agent health endpoint");
}

async function isHealthReady() {
  try {
    const response = await fetch("http://127.0.0.1:8777/v1/health");
    return response.ok;
  } catch {
    return false;
  }
}

async function assertExecutable(path) {
  const mode = isWindows ? constants.F_OK : constants.X_OK;
  await access(path, mode);
}

async function run() {
  let agent;
  let shouldStopAgent = false;
  const alreadyRunning = await isHealthReady();

  if (!alreadyRunning) {
    await assertExecutable(agentBin);
    await assertExecutable(singboxBin);
    agent = spawn(agentBin, [], {
      cwd: root,
      env: {
        ...process.env,
        SINGBOX_BIN: singboxBin
      },
      stdio: "inherit"
    });
    shouldStopAgent = true;
  }

  let done = false;
  const stopAgent = () => {
    if (done || !shouldStopAgent || !agent?.pid) return;
    done = true;
    if (isWindows) {
      spawnSync("taskkill", ["/PID", String(agent.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    }
    agent.kill("SIGINT");
  };

  try {
    await waitForHealth();
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [smokeScript], {
        cwd: root,
        stdio: "inherit"
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`Smoke script failed with exit code ${code}`));
      });
    });
  } finally {
    stopAgent();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
