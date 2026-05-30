import { test, expect } from "@playwright/test";
import { CITY, CODE, Q1_TEXT, OPTS } from "./fixtures.js";

// Realny klient (przeglądarka) względem działającej sesji na stagingu.
// Pokrywa lukę, której boty nie ruszają: faktyczny render uczestnika i LiveView
// oraz ich zgodność (ten sam tekst pytania = synchronizacja).

async function joinAsParticipant(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mam kod/ }).click();
  await page.getByPlaceholder("XXX-0000").fill(CODE);
  await page.getByRole("button", { name: /Dołącz do quizu/ }).click();
}

const SHOTS = "report/shots";

test("uczestnik: kod → dołączenie → widzi bieżące pytanie", async ({ page }) => {
  await joinAsParticipant(page);
  await expect(page.getByText(Q1_TEXT)).toBeVisible({ timeout: 25000 });
  await page.screenshot({ path: `${SHOTS}/uczestnik-pytanie.png`, fullPage: true });
});

test("LiveView: pokazuje to samo bieżące pytanie (sync)", async ({ page }) => {
  await page.goto(`/?live=1&city=${encodeURIComponent(CITY)}`);
  await expect(page.getByText(Q1_TEXT)).toBeVisible({ timeout: 25000 });
  await page.screenshot({ path: `${SHOTS}/liveview.png`, fullPage: true });
});

test("uczestnik: może wybrać odpowiedź (lock-in działa)", async ({ page }) => {
  await joinAsParticipant(page);
  await expect(page.getByText(Q1_TEXT)).toBeVisible({ timeout: 25000 });
  await page.getByText(OPTS[0]).click();                 // wybierz "Odpowiedź Alfa"
  await expect(page.getByText(/wybrano/)).toBeVisible(); // Quiz pokazuje "✔ wybrano"
  await page.screenshot({ path: `${SHOTS}/uczestnik-odpowiedz.png`, fullPage: true });
});
