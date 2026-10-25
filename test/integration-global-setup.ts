import { execFileSync } from "node:child_process";

/** Applies migrations to the test database once before the integration tests run. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Integration tests need their own database, e.g.\n" +
        '  TEST_DATABASE_URL="postgresql://sales:sales@localhost:5432/sales_app_test?schema=public"\n' +
        "Create it with `createdb sales_app_test` and add the line to .env (see .env.example).",
    );
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL must point to a different database than DATABASE_URL.");
  }
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
    // On Windows pnpm is pnpm.cmd, which only runs through the shell.
    shell: process.platform === "win32",
  });
}
