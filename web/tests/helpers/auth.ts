import type { Page } from "@playwright/test";

// The fixture password comes from the environment, never from source — the
// seed script creates these accounts in a real Supabase project, so a literal
// here would be a working password for anyone reading the repo.
// playwright.config.ts loads SEED_TEST_PASSWORD out of the gitignored root
// .env, and global-setup passes the same value to the seed script, so the two
// always agree without anyone exporting anything.
const PASSWORD = process.env.SEED_TEST_PASSWORD;
if (!PASSWORD) {
  throw new Error(
    "SEED_TEST_PASSWORD is not set. Add it to the root .env (see .env.example); " +
      "global-setup seeds the test trainers with that value.",
  );
}

export const TRAINER_A = { email: "trainer-a@test.gymdays.local", password: PASSWORD };
export const TRAINER_B = { email: "trainer-b@test.gymdays.local", password: PASSWORD };

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
