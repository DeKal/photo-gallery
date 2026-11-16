import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The frontend calls the backend directly at http://localhost:8000
// (see src/api.ts — BASE). The backend CORS already allows
// http://localhost:5173, so no dev proxy is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
