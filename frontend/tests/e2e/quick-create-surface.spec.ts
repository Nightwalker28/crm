import { expect, test } from "@playwright/test";

const fixturePath = "/e2e/quick-create";

test("enters, traps, and returns focus with Escape and explicit close", async ({ page }) => {
  await page.goto(fixturePath);
  const opener = page.getByRole("button", { name: "Open quick create" });

  await opener.click();
  const surface = page.getByRole("dialog", { name: "Create test record" });
  await expect(surface).toBeVisible();
  await expect(surface.getByLabel("Name")).toBeFocused();
  await expect.poll(() => surface.getByLabel("Name").evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");

  await page.keyboard.press("Shift+Tab");
  await expect(surface.getByRole("button", { name: "Close Create test record" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(surface.getByRole("button", { name: "Create", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(surface.getByRole("button", { name: "Close Create test record" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(surface).toBeHidden();
  await expect(opener).toBeFocused();

  await opener.click();
  await surface.getByRole("button", { name: "Close Create test record" }).click();
  await expect(surface).toBeHidden();
  await expect(opener).toBeFocused();
});

test("confirms dirty dismissal without allowing Escape to bypass the guard", async ({ page }) => {
  await page.goto(fixturePath);
  const opener = page.getByRole("button", { name: "Open quick create" });
  await opener.click();

  const surface = page.getByRole("dialog", { name: "Create test record" });
  await surface.getByLabel("Name").fill("Unsaved record");
  await page.keyboard.press("Escape");

  const confirmation = page.getByRole("dialog", { name: "Discard quick create draft?" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(surface).toBeVisible();
  await expect(surface.getByLabel("Name")).toHaveValue("Unsaved record");

  await surface.getByRole("button", { name: "Close Create test record" }).click();
  await confirmation.getByRole("button", { name: "Discard changes" }).click();
  await expect(surface).toBeHidden();
  await expect(opener).toBeFocused();
});

test("prevents duplicate submissions while pending and exposes busy state", async ({ page }) => {
  await page.goto(fixturePath);
  await page.getByRole("button", { name: "Open quick create" }).click();

  const surface = page.getByRole("dialog", { name: "Create test record" });
  const create = surface.getByRole("button", { name: "Create", exact: true });
  await create.click();

  await expect(surface).toHaveAttribute("aria-busy", "true");
  const pendingCreate = surface.getByRole("button", { name: "Creating...", exact: true });
  await expect(pendingCreate).toBeDisabled();
  await expect(surface.getByRole("status")).toContainText("Creating...");
  await pendingCreate.evaluate((button) => button.click());
  await expect(page.getByTestId("submit-count")).toHaveText("1");
  await expect(surface).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("submit-count")).toHaveText("1");
});

test("announces submission failure, retains values, and allows a clean retry", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(fixturePath);
  await page.getByRole("button", { name: "Fail next submission" }).click();
  await page.getByRole("button", { name: "Open quick create" }).click();

  const surface = page.getByRole("dialog", { name: "Create test record" });
  await surface.getByLabel("Name").fill("Retained record");
  await surface.getByRole("button", { name: "Create", exact: true }).click();

  await expect(surface.getByRole("alert")).toContainText("We could not create this record");
  await expect(surface).toHaveAttribute("aria-busy", "false");
  await expect(surface.getByLabel("Name")).toHaveValue("Retained record");
  await expect(page.getByTestId("submit-count")).toHaveText("1");

  await surface.getByRole("button", { name: "Create", exact: true }).click();
  await expect(surface).toHaveAttribute("aria-busy", "true");
  await expect(surface).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("submit-count")).toHaveText("2");
  expect(pageErrors).toEqual([]);
});

test("emits standardized create-and-open and more-details outcomes", async ({ page }) => {
  await page.goto(fixturePath);
  await page.getByRole("button", { name: "Open quick create" }).click();

  const surface = page.getByRole("dialog", { name: "Create test record" });
  await surface.getByRole("button", { name: "Create & open" }).click();
  await expect(page.getByTestId("last-outcome")).toHaveText("create-and-open");
  await expect(surface).toHaveAttribute("aria-busy", "false");

  await surface.getByRole("button", { name: "More details" }).click();
  await expect(page.getByTestId("last-outcome")).toHaveText("more-details");
});

test("renders as a desktop side panel and a narrow full-screen surface", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(fixturePath);
  await page.getByRole("button", { name: "Open quick create" }).click();

  const surface = page.getByRole("dialog", { name: "Create test record" });
  const desktopBox = await surface.boundingBox();
  expect(desktopBox).not.toBeNull();
  expect(desktopBox!.width).toBeLessThanOrEqual(576);
  expect(desktopBox!.x).toBeGreaterThan(800);
  expect(desktopBox!.height).toBe(900);
  await expect(page.getByLabel("Preserved page context")).toBeVisible();
  const desktopBackdropAlpha = await page.locator("[data-slot='sheet-overlay']").evaluate((element) => {
    const color = getComputedStyle(element).backgroundColor;
    const alpha = color.match(/,\s*([\d.]+)\s*\)$/)?.[1] ?? color.match(/\/\s*([\d.]+)\s*\)$/)?.[1];
    return alpha ? Number(alpha) : 1;
  });
  expect(desktopBackdropAlpha).toBeLessThanOrEqual(0.6);

  await page.keyboard.press("Escape");
  await expect(surface).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open quick create" }).click();
  await expect.poll(async () => (await surface.boundingBox())?.x).toBe(0);
  const mobileBox = await surface.boundingBox();
  expect(mobileBox).not.toBeNull();
  expect(mobileBox!.x).toBe(0);
  expect(mobileBox!.width).toBe(390);
  expect(mobileBox!.height).toBe(844);

  for (const button of await surface.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});

test("removes sheet transforms and transitions when reduced motion is requested", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(fixturePath);
  await page.getByRole("button", { name: "Open quick create" }).click();

  const surface = page.getByRole("dialog", { name: "Create test record" });
  await expect(surface).toHaveAttribute("data-reduced-motion", "true");
  await expect(surface).toHaveCSS("transform", "none");
  await expect(surface).toHaveCSS("transition-duration", "0s");
});
