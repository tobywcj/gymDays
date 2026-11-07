import type { Page } from "@playwright/test";

// The fixture password is supplied by the environment, not committed — the seed
// script creates these accounts in a real Supabase project, so a literal here
// would be a working password for anyone reading the repo. Seed and test must
// agree on it:
//   export SEED_TEST_PASSWORD=...
//   node web/scripts/seed-test-users.mjs && npx playwright test
const PASSWORD = process.env.SEED_TEST_PASSWORD;
if (!PASSWORD) {
  throw new Error(
    "SEED_TEST_PASSWORD is not set. Export the same value you seeded the test " +
      "trainers with (see web/scripts/seed-test-users.mjs).",
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
