import { fileURLToPath } from "node:url";

export default {
  testDir: ".",
  testMatch: "browser.spec.mjs",
  outputDir: "../../apps/web/test-results/consumer-review",
  reporter: "list",
  workers: 1,
  use: {
    baseURL: "http://localhost:4180",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm --prefix apps/web run preview -- --port 4180",
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    url: "http://localhost:4180",
    reuseExistingServer: false,
  },
};
