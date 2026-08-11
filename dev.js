import { spawn } from "node:child_process";
import path from "node:path";

const children = [];
let shuttingDown = false;

function startProcess(command, args, label, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: false,
    env: process.env,
    ...options,
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    console.error(`${label} exited with ${signal ?? code ?? 0}. Shutting down...`);
    shutdown(code ?? (signal ? 1 : 0));
  });

  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }

  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

startProcess(process.execPath, [path.resolve("server.js")], "paystack-server");
startProcess(process.execPath, [path.resolve("node_modules", "vite", "bin", "vite.js"), "--host", "0.0.0.0"], "vite");
