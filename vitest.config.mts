import "dotenv/config";

import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// `server-only` throws outside a React Server Components bundle; tests run server code directly.
const alias = { "server-only": new URL("./test/server-only-stub.ts", import.meta.url).pathname };

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "prisma/**/*.test.ts"],
          exclude: ["**/*.int.test.ts"],
        },
      },
      {
        // Integration tests run against TEST_DATABASE_URL (a separate, disposable database).
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["src/**/*.int.test.ts"],
          globalSetup: ["./test/integration-global-setup.ts"],
          setupFiles: ["./test/integration-setup.ts"],
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
