import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Relative paths so the build works on GitHub Pages (/python-tuple-playground/)
  base: "./",
  plugins: [react(), tailwindcss()],
});