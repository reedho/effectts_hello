import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["stories/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["**/*.bun.test.ts", "**/node_modules/**"],
  },
})
