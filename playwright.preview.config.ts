import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testMatch: [
    "mvp.spec.ts",
    "quarter.spec.ts",
    "migration-limit.spec.ts",
    "planning.spec.ts",
    "comparison.spec.ts",
    "constructor.spec.ts",
    "readability.spec.ts",
    "continuation.spec.ts",
    "daily-forms.spec.ts",
    "daily-materials.spec.ts",
    "daily-loading.spec.ts",
    "daily-release.spec.ts",
    "stabilization.spec.ts",
    "city-first.spec.ts",
  ],
  grep: /city first:|city, material|old city grows|preserves an oversized|rejects a legacy archive|convenient planning|roads reject|note undo|compare city on one canvas|equal saved states|current comparison only|comparison cancels|comparison focus|visual constructor|readable city:|continue research:|daily forms:|materials export|quick backup|optional editor|optional materials|daily release:|stabilization:/,
  use: { ...base.use, baseURL: "http://127.0.0.1:4174" },
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4174 --strictPort",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
  },
});
