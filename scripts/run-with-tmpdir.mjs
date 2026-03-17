import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error("Usage: node scripts/run-with-tmpdir.mjs <command> [...args]");
  process.exit(2);
}

const tmpDir = path.join(process.cwd(), ".afi-tmp");
fs.mkdirSync(tmpDir, { recursive: true });

const command = argv[0];
const commandArgs = argv.slice(1);
const env = {
  ...process.env,
  TMPDIR: tmpDir,
  TEMP: tmpDir,
  TMP: tmpDir,
};

const child = spawn(command, commandArgs, {
  env,
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
