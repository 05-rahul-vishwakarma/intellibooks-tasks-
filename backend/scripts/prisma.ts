import "../src/env";
import { spawnSync } from "child_process";

const args = process.argv.slice(2);
const result = spawnSync("npx", ["prisma", ...args], {
  stdio: "inherit",
  cwd: process.cwd(),
  env: process.env,
});

process.exit(result.status ?? 1);
