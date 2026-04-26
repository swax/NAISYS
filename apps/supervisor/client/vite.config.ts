import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import istanbul from "vite-plugin-istanbul";

/** Disable Zod v4 JIT (uses `new Function`) to comply with CSP script-src 'self'. */
function zodJitless(): Plugin {
  let patched = false;
  return {
    name: "zod-jitless",
    transform(code, id) {
      if (
        id.includes("zod") &&
        code.includes("export const globalConfig = {};")
      ) {
        patched = true;
        return code.replace(
          "export const globalConfig = {};",
          "export const globalConfig = { jitless: true };",
        );
      }
    },
    buildEnd() {
      if (!patched) {
        this.warn(
          "zod-jitless plugin did not patch globalConfig — Zod may have changed its internals. " +
            "CSP violations from eval/new Function are likely.",
        );
      }
    },
  };
}

const coverageMode = process.env.COVERAGE === "1";

export default defineConfig({
  plugins: [
    zodJitless(),
    react(),
    ...(coverageMode
      ? [
          istanbul({
            include: "src/**/*",
            extension: [".ts", ".tsx"],
            requireEnv: false,
            forceBuildInstrument: true,
          }),
        ]
      : []),
  ],
  base: "/supervisor/",
  server: {
    port: 2201,
    proxy: {
      "/supervisor/api": {
        target: "http://localhost:3301",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "@mantine/core",
      "@mantine/hooks",
      "@mantine/store",
    ],
  },
  build: {
    outDir: "dist",
    minify: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            return "vendor";
          }
        },
      },
    },
  },
});
