import { test, expect } from "@playwright/test";
import { TRAINER_A, TRAINER_B, signIn } from "./helpers/auth";

test.describe("M3 auth + tenant isolation", () => {
  test("logged-out request to / redirects to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText("Trainer sign-in")).toBeVisible();
  });

  test("trainer A sees only A's clients (not B's)", async ({ page }) => {
    await signIn(page, TRAINER_A);
    const rows = page.getByTestId("client-row");
    await expect(rows).toHaveCount(2);
    await expect(page.locator("text=Alice Adams")).toBeVisible();
    await expect(page.locator("text=Aaron Avery")).toBeVisible();
    await expect(page.locator("text=Bella Briggs")).toHaveCount(0);
    await expect(page.locator("text=Ben Burton")).toHaveCount(0);
    await expect(page.locator("text=Bea Bates")).toHaveCount(0);
  });

  test("trainer B sees only B's clients (not A's)", async ({ page }) => {
    await signIn(page, TRAINER_B);
    const rows = page.getByTestId("client-row");
    await expect(rows).toHaveCount(3);
    await expect(page.locator("text=Bella Briggs")).toBeVisible();
    await expect(page.locator("text=Ben Burton")).toBeVisible();
    await expect(page.locator("text=Bea Bates")).toBeVisible();
    await expect(page.locator("text=Alice Adams")).toHaveCount(0);
    await expect(page.locator("text=Aaron Avery")).toHaveCount(0);
  });

  test("sidebar shows the signed-in trainer's name", async ({ page }) => {
    await signIn(page, TRAINER_A);
    await expect(page.getByTestId("trainer-info")).toContainText("Trainer A");
  });
});
