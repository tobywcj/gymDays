import { test, expect, type Page } from "@playwright/test";
import { TRAINER_A, signIn } from "./helpers/auth";

// All PAR-Q question keys, in render order. Mirrors ScreeningStepper's `items`.
const PARQ_KEYS = [
  "heart_condition",
  "chest_pain_activity",
  "chest_pain_rest",
  "dizziness",
  "bone_joint",
  "blood_pressure_med",
  "other_reason",
] as const;

// Trainer creates a fresh client and returns the public onboarding link.
// Same flow as M4 onboarding — the public page now renders the screening stepper.
async function createInvite(page: Page, clientName: string): Promise<string> {
  await signIn(page, TRAINER_A);
  await page.getByTestId("add-client").click();
  await expect(page).toHaveURL(/\/clients\/new$/);

  await page.getByTestId("name").fill(clientName);
  await page.getByTestId("goal").fill("Fat loss");
  await Promise.all([
    page.waitForURL(/\/clients\/new\?invited=/),
    page.getByTestId("create").click(),
  ]);

  const link = await page.getByTestId("invite-link").inputValue();
  expect(link).toMatch(/\/onboarding\/[A-Za-z0-9_-]{20,}$/);
  return link;
}

// Answer every PAR-Q row with the same yes/no choice.
async function answerAllParq(page: Page, choice: "yes" | "no") {
  for (const key of PARQ_KEYS) {
    await page.getByTestId(`parq-${key}-${choice}`).click();
  }
}

// The stepper is rendered in the default language (zh) and driven entirely by
// test ids, so these flows are independent of the displayed copy. The language
// toggle gets its own dedicated test below.
test.describe("Screening questionnaire (PAR-Q → medical → CVD → signup)", () => {
  test("healthy client walks the full 5-step screening and lands on the checklist", async ({ browser }) => {
    const stamp = Date.now().toString(36);
    const clientName = `Screen Healthy ${stamp}`;

    const trainer = await browser.newContext();
    const link = await createInvite(await trainer.newPage(), clientName);
    await trainer.close();

    // Public page — anonymous, no trainer session.
    const anon = await browser.newContext();
    const pub = await anon.newPage();
    await pub.goto(link);
    await expect(pub.getByText(clientName)).toBeVisible();

    // Step 1 · PAR-Q — Next stays disabled until every question is answered.
    await expect(pub.getByTestId("step-next-1")).toBeDisabled();
    await answerAllParq(pub, "no");
    await expect(pub.getByTestId("clearance-banner")).toHaveCount(0);
    await pub.getByTestId("parq-free-text").fill("No concerns.");
    await pub.getByTestId("step-next-1").click();

    // Step 2 · Medical & injury history.
    await pub.getByTestId("medical-injuries").fill("right knee meniscus 2022");
    await pub.getByTestId("medical-meds").fill("none");
    await pub.getByTestId("chronic-asthma").check();
    await pub.getByTestId("medical-notes").fill("trains mornings");
    await pub.getByTestId("step-next-2").click();

    // Step 3 · CVD risk.
    await pub.getByTestId("cvd-age").fill("31");
    await pub.getByTestId("cvd-sex-f").click();
    await pub.getByTestId("cvd-inactivity").check();
    await pub.getByTestId("step-next-3").click();

    // Step 4 · Account creation. Submit disabled until email + 8-char password.
    await expect(pub.getByTestId("clearance-reminder")).toHaveCount(0);
    await expect(pub.getByTestId("submit-final")).toBeDisabled();
    await pub.getByTestId("signup-email").fill(`screen-healthy-${stamp}@test.gymdays.local`);
    await pub.getByTestId("signup-password").fill("ScreenTest!2026");
    await expect(pub.getByTestId("submit-final")).toBeEnabled();
    await pub.getByTestId("submit-final").click();

    // Step 5 · Confirmation checklist. A clean PAR-Q yields the 3 standard
    // checklist items (no medical-clearance line).
    await expect(pub.getByTestId("confirm-step")).toBeVisible();
    await expect(pub.getByTestId("submit-error")).toHaveCount(0);
    await expect(pub.getByTestId("confirm-step").locator("li")).toHaveCount(3);

    // Re-using a consumed invite token returns the expired page.
    await pub.goto(link);
    await expect(pub.getByTestId("invite-expired")).toBeVisible();

    await anon.close();
  });

  test("a PAR-Q 'Yes' surfaces the clearance warning through to the checklist", async ({ browser }) => {
    const stamp = Date.now().toString(36);
    const clientName = `Screen Flagged ${stamp}`;

    const trainer = await browser.newContext();
    const link = await createInvite(await trainer.newPage(), clientName);
    await trainer.close();

    const anon = await browser.newContext();
    const pub = await anon.newPage();
    await pub.goto(link);
    await expect(pub.getByText(clientName)).toBeVisible();

    // Answer everything No, then flip one to Yes → clearance banner appears.
    await answerAllParq(pub, "no");
    await expect(pub.getByTestId("clearance-banner")).toHaveCount(0);
    await pub.getByTestId("parq-heart_condition-yes").click();
    await expect(pub.getByTestId("clearance-banner")).toBeVisible();
    await pub.getByTestId("step-next-1").click();

    // Skip the optional medical fields.
    await pub.getByTestId("step-next-2").click();

    await pub.getByTestId("cvd-age").fill("58");
    await pub.getByTestId("cvd-sex-m").click();
    await pub.getByTestId("step-next-3").click();

    // The warning follows the "Yes" answer onto the signup step…
    await expect(pub.getByTestId("clearance-reminder")).toBeVisible();
    await pub.getByTestId("signup-email").fill(`screen-flagged-${stamp}@test.gymdays.local`);
    await pub.getByTestId("signup-password").fill("ScreenTest!2026");
    await pub.getByTestId("submit-final").click();

    // …and adds the 4th (medical-clearance) item to the first-session checklist.
    await expect(pub.getByTestId("confirm-step")).toBeVisible();
    await expect(pub.getByTestId("confirm-step").locator("li")).toHaveCount(4);

    await anon.close();
  });

  test("the language toggle switches the header copy between zh and en", async ({ browser }) => {
    const stamp = Date.now().toString(36);
    const clientName = `Screen Lang ${stamp}`;

    const trainer = await browser.newContext();
    const link = await createInvite(await trainer.newPage(), clientName);
    await trainer.close();

    const anon = await browser.newContext();
    const pub = await anon.newPage();
    await pub.goto(link);

    // Default is Chinese; the toggle button advertises the *other* language.
    const toggle = pub.getByTestId("lang-toggle");
    await expect(pub.getByText(`您好，${clientName}`)).toBeVisible();
    await expect(toggle).toHaveText("EN");

    // Retry the click until it lands — guards against a lost click before the
    // client handler hydrates (the SSR copy is interactive only after hydration).
    await expect(async () => {
      await toggle.click();
      await expect(toggle).toHaveText("中文", { timeout: 1000 });
    }).toPass();
    await expect(pub.getByText(`Welcome, ${clientName}`)).toBeVisible();

    await anon.close();
  });

  test("an invalid token shows the expired page", async ({ browser }) => {
    const anon = await browser.newContext();
    const pub = await anon.newPage();
    await pub.goto("/onboarding/this-token-does-not-exist");
    await expect(pub.getByTestId("invite-expired")).toBeVisible();
    await anon.close();
  });
});
