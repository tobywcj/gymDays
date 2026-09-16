import { test, expect } from "@playwright/test";
import { TRAINER_A, signIn } from "./helpers/auth";

test.describe("Dashboard (visual contract + live data)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, TRAINER_A);
  });

  test("renders top-bar title and four metric labels", async ({ page }) => {
    await expect(page.locator("text=Dashboard").first()).toBeVisible();
    await expect(page.locator("text=Active Clients")).toBeVisible();
    await expect(page.locator("text=Quiet Clients").first()).toBeVisible();
    await expect(page.locator("text=Open Injuries").first()).toBeVisible();
    await expect(page.locator("text=Change requests").first()).toBeVisible();
  });

  test("sidebar shows all 5 nav items", async ({ page }) => {
    const labels = ["Dashboard", "Clients", "Programme", "Knowledge Base", "Messages"];
    for (const label of labels) {
      await expect(page.locator(`nav button:has-text("${label}")`)).toBeVisible();
    }
  });

  test("clients page renders the seeded trainer's 2 clients", async ({ page }) => {
    await page.goto("/clients");
    const rows = page.getByTestId("client-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText(/Alice Adams|Aaron Avery/);
  });

  test("scheduled agents card renders with a create control", async ({ page }) => {
    await expect(page.getByTestId("scheduled-agents")).toBeVisible();
    await expect(page.locator("text=Scheduled Agents")).toBeVisible();
    await expect(page.getByTestId("agents-new")).toBeVisible();
  });

  test("body uses the deep-space base background #15161a", async ({ page }) => {
    const color = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(color).toBe("rgb(21, 22, 26)");
  });

  test("glass primitive renders specular highlight and edge ring", async ({ page }) => {
    const probe = await page.evaluate(() => {
      const el = document.querySelector(".glass") as HTMLElement | null;
      if (!el) return null;
      const before = getComputedStyle(el, "::before");
      const after = getComputedStyle(el, "::after");
      return {
        beforeContent: before.content,
        afterContent: after.content,
        beforeBg: before.backgroundImage,
        afterBg: after.backgroundImage,
      };
    });
    expect(probe).not.toBeNull();
    expect(probe!.beforeContent).not.toBe("none");
    expect(probe!.afterContent).not.toBe("none");
    expect(probe!.beforeBg).toContain("gradient");
    expect(probe!.afterBg).toContain("gradient");
  });

  test("Add Client control is in the top bar and routes to /clients/new", async ({ page }) => {
    const cta = page.getByTestId("add-client");
    await expect(cta).toBeVisible();
    await expect(cta).toContainText("Add Client");
    await cta.click();
    await expect(page).toHaveURL(/\/clients\/new$/);
  });
});
