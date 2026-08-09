import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Honour PORT when a harness assigns one; otherwise Vite's default 5173.
  server: { port: process.env.PORT ? Number(process.env.PORT) : 5173, open: false },
  /* The simulator is served from /sim, not from the root of its origin — it
     lives inside the portal's deployment now. Without this every asset URL is
     absolute to "/" and lands on the portal, which answers with its own 404
     page rather than the file. BASE_PATH lets a standalone build (or the dev
     server) keep the old behaviour. */
  base: process.env.BASE_PATH || "/",
  build: { outDir: "dist", chunkSizeWarningLimit: 1500 },
});
