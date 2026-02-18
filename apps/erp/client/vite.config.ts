import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/erp/",
  server: {
    port: 3202,
    proxy: {
      "/api/erp": {
        target: "http://localhost:3201",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
