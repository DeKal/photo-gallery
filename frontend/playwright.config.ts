import { defineConfig } from "@playwright/test";

// End-to-end UI test config.
//
// Playwright boots BOTH servers for us (webServer array) and tears them down
// afterwards. `reuseExistingServer` means a backend/frontend you already have
// running locally is reused instead of being started twice.
//
// The backend's /health endpoint responds immediately (it does NOT load the ML
// models), so the readiness probe is fast; the heavy CLIP/InsightFace weights
// load lazily on the first real scan, which is why the test itself uses a long
// timeout. First ever run also downloads model weights (~1GB).
export default defineConfig({
  testDir: "./e2e",
  // A full scan + cluster of the fixtures (incl. cold model load) can take a
  // while; give each test plenty of head-room.
  timeout: 240_000,
  expect: { timeout: 180_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "cd ../backend && .venv/bin/python -m uvicorn app.main:app --port 8000",
      url: "http://localhost:8000/health",
      timeout: 180_000,
      reuseExistingServer: true,
    },
    {
      command: "npm run dev",
      url: "http://localhost:5173",
      timeout: 60_000,
      reuseExistingServer: true,
    },
  ],
});
