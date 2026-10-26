import { defineConfig } from "vitest/config";

// Separate from vite.config.js: the React Router plugin isn't needed (and doesn't run) under Vitest.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.{js,jsx}"],
    setupFiles: ["test/setup.js"],
    restoreMocks: true,
  },
});
