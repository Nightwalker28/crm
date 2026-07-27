import { expect, test } from "@playwright/test";

const token = "public-proposal-browser-token";
const proposalUrl = `/public/quotes/proposal/${token}`;
const proposalApiPattern = `**/sales/quotes/proposal/public/${token}`;

function proposalFixture() {
  return {
    quote_number: "Q/Browser 1",
    customer_name: "Acme Operations",
    title: "Implementation proposal",
    content_text: "Overview\n\nImplementation and onboarding.\n\nTerms\nNet 30.",
    currency: "USD",
    total_amount: "1250",
    expiry_date: "2099-07-31",
  };
}

test("Public proposal is responsive, readable, and downloads when analytics fails", async ({ page }) => {
  let eventRecorded = false;
  await page.route(proposalApiPattern, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "private, no-store" },
      body: JSON.stringify(proposalFixture()),
    }),
  );
  await page.route(`${proposalApiPattern}/events`, (route) => {
    eventRecorded = true;
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "analytics_database_unavailable" }),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(proposalUrl);

  await expect(page.getByRole("heading", { name: "Implementation proposal" })).toBeVisible();
  await expect(page.getByText("Prepared for Acme Operations")).toBeVisible();
  await expect(page.getByText("$1,250.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Jul 31, 2099", { exact: true })).toBeVisible();
  await expect(page.locator("article")).toContainText("Implementation and onboarding.");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download proposal Q/Browser 1" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Q-Browser-1-proposal.txt");
  await expect.poll(() => eventRecorded).toBe(true);
  await expect(page.getByText("analytics_database_unavailable")).toHaveCount(0);
});

test("Expired or unknown proposal links use a non-enumerating unavailable state", async ({ page }) => {
  await page.route(proposalApiPattern, (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "token_hash=private-value" }),
    }),
  );

  await page.goto(proposalUrl);

  await expect(page.getByRole("heading", { name: "This proposal link is unavailable" })).toBeVisible();
  await expect(page.getByText("The link may have expired or been replaced.")).toBeVisible();
  await expect(page.getByText("token_hash=private-value")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
});

test("Temporary proposal failures provide a safe retry", async ({ page }) => {
  let requestCount = 0;
  await page.route(proposalApiPattern, (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "database_password=secret" }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(proposalFixture()),
    });
  });

  await page.goto(proposalUrl);
  await expect(page.getByRole("heading", { name: "The proposal could not be loaded" })).toBeVisible();
  await expect(page.getByText("database_password=secret")).toHaveCount(0);

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Implementation proposal" })).toBeVisible();
  expect(requestCount).toBe(2);
});
