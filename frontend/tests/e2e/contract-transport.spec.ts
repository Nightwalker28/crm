import { expect, test } from "@playwright/test";

const resolvedLayoutRoute = "**/record-layouts/sales_leads/quick_create/resolved";

test("apiFetch retries reads but never replays writes", async ({ page }) => {
  let getAttempts = 0;
  let postAttempts = 0;

  await page.route("**/contract-transport-probe", (route) => {
    if (route.request().method() === "GET") {
      getAttempts += 1;
    } else {
      postAttempts += 1;
    }
    return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
  });

  await page.goto("/e2e/contract-transport");

  await page.getByRole("button", { name: "Send read probe" }).click();
  await expect(page.getByTestId("probe-result")).toHaveText("GET:500");
  expect(getAttempts).toBe(3);

  await page.getByRole("button", { name: "Send write probe" }).click();
  await expect(page.getByTestId("probe-result")).toHaveText("POST:500");
  expect(postAttempts).toBe(1);
});

test("the layout contract adapter reads through apiFetch and reports typed failures", async ({ page }) => {
  const requestedUrls: string[] = [];
  let body = JSON.stringify({
    layout_id: null,
    module_key: "sales_leads",
    surface: "quick_create",
    name: "Lead Quick Create",
    source: "system",
    version: 1,
    can_customize: false,
    sections: [],
  });
  let status = 200;

  await page.route(resolvedLayoutRoute, (route) => {
    requestedUrls.push(route.request().url());
    return route.fulfill({ status, contentType: "application/json", body });
  });

  await page.goto("/e2e/contract-transport");

  // A contract-shaped response resolves, and the request URL comes from the generated path.
  await page.getByRole("button", { name: "Load layout contract" }).click();
  await expect(page.getByTestId("probe-result")).toHaveText("layout:ok");
  expect(requestedUrls.at(-1)).toContain("/api/v1/record-layouts/sales_leads/quick_create/resolved");

  // A permission failure surfaces as a typed HTTP error carrying the status.
  status = 403;
  body = JSON.stringify({ detail: "You do not have access to this module." });
  await page.getByRole("button", { name: "Load layout contract" }).click();
  await expect(page.getByTestId("probe-result")).toHaveText("layout:http:403");

  // A response that drifts from the contract fails at the boundary instead of rendering.
  status = 200;
  body = JSON.stringify({ module_key: "sales_leads", surface: "quick_create" });
  await page.getByRole("button", { name: "Load layout contract" }).click();
  await expect(page.getByTestId("probe-result")).toHaveText("layout:malformed_response:none");
});
