import type { Page } from "@playwright/test";

export const TRAINER_A = { email: "trainer-a@test.gymdays.local", password: "TestTrainerA!2026" };
export const TRAINER_B = { email: "trainer-b@test.gymdays.local", password: "TestTrainerB!2026" };

export async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  // By test id — the page defaults to 繁中, so button text isn't stable.
  await page.getByTestId("mode-password").click();
  await page.getByTestId("email").fill(who.email);
  await page.getByTestId("password").fill(who.password);
  await Promise.all([
    page.waitForURL("**/"),
    page.getByTestId("submit").click(),
  ]);
}
