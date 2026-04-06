import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

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

export default defineConfig({
  plugins: [zodJitless(), react()],
  base: "/erp/",
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "@mantine/core",
      "@mantine/hooks",
      "@mantine/notifications",
      "@mantine/store",
    ],
  },
  server: {
    port: 3202,
    proxy: {
      "/erp/api": {
        target: "http://localhost:3201",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
