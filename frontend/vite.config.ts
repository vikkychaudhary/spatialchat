import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API = "http://localhost:4000";
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin proxy: the session cookie never needs cross-site CORS during development.
    proxy: { "/api": API, "/health": API, "/socket.io": { target: API, ws: true } },
  },
});
