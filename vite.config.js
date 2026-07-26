import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Honour PORT when a harness assigns one; otherwise Vite's default 5173.
  server: { port: process.env.PORT ? Number(process.env.PORT) : 5173, open: false },
  build: { outDir: "dist", chunkSizeWarningLimit: 1500 },
});
