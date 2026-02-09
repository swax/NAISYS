import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/erp/",
  server: {
    proxy: {
      "/api/erp": {
        target: "http://localhost:3002",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
