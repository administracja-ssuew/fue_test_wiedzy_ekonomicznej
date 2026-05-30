import { defineConfig } from "@playwright/test";
import fs from "fs";
import { loadEnv } from "./e2e/load-env.js";

const env = loadEnv();
const PORT = 5179;

// Pewne skierowanie dev servera na STAGING: zapisujemy plik trybu Vite `.env.e2e`
// (pliki .env.[mode] mają wyższy priorytet niż .env), a serwer startujemy z
// `--mode e2e`. To eliminuje niepewność, czy override przez env się przebił.
// Plik jest gitignorowany i kasowany w global-teardown.
fs.writeFileSync(".env.e2e",
  `VITE_SUPABASE_URL=${env.VITE_SUPABASE_URL_STAGE || ""}\n` +
  `VITE_SUPABASE_ANON_KEY=${env.VITE_SUPABASE_ANON_KEY_STAGE || ""}\n`);

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.js",
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.js",
  globalTeardown: "./e2e/global-teardown.js",
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    actionTimeout: 15000,
  },
  webServer: {
    command: `npm run dev -- --mode e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    timeout: 120000,
    reuseExistingServer: false,
  },
});
