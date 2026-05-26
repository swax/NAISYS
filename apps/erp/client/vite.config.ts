import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import istanbul from "vite-plugin-istanbul";

const coverageMode = process.env.COVERAGE === "1";
const jsModuleRe = /\.[cm]?[jt]sx?(?:$|\?)/;

function stripPureAnnotationsForCoverage(): Plugin {
  return {
    name: "strip-pure-annotations-for-coverage",
    enforce: "post",
    transform(code, id) {
      if (
        !id.includes("/src/") ||
        !jsModuleRe.test(id) ||
        !code.includes("__PURE__")
      ) {
        return;
      }

      return {
        code: code.replace(/\/\*\s*[@#]__PURE__\s*\*\//g, (comment) =>
          " ".repeat(comment.length),
        ),
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    ...(coverageMode
      ? [
          istanbul({
            include: "src/**/*",
            extension: [".ts", ".tsx"],
            requireEnv: false,
            forceBuildInstrument: true,
          }),
          stripPureAnnotationsForCoverage(),
        ]
      : []),
  ],
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
    port: 2202,
    proxy: {
      "/erp/api": {
        target: "http://localhost:3302",
        changeOrigin: true,
      },
    },
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
