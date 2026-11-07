import "../src/env";
import { execFileSync } from "child_process";
import { prisma } from "../src/lib/db";

async function runMigrations() {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });

  // Mark stuck processing documents as failed (interrupted on restart)
  const result = await prisma.document.updateMany({
    where: { status: "processing" },
    data: { status: "failed", errorMessage: "interrupted" },
  });
  console.log(`Marked ${result.count} stuck processing document(s) as failed`);

  await prisma.$disconnect();
}

runMigrations().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
