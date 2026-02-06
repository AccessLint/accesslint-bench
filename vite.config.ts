import codspeedPlugin from "@codspeed/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [codspeedPlugin()],
  test: {
    environment: "happy-dom",
    hookTimeout: 60_000,
    benchmark: {
      include: ["src/**/*.bench.ts"],
    },
  },
});
