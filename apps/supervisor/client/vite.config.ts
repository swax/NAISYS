import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/supervisor/",
  server: {
    port: 3002,
    proxy: {
      "/api/supervisor": {
        target: "http://localhost:3003",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: "dist",
  },
});
