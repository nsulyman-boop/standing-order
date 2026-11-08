import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// VITE_BASE_PATH=/standing-order/ for GitHub Pages (see .github/workflows/pages.yml); "/" locally.
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react()],
  server: { port: 3000, host: true },
  build: { target: "es2022", sourcemap: false },
});
