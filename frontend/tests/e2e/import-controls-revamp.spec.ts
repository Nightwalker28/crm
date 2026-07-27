import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const preview = {
  source_headers: ["email", "first_name"],
  target_headers: ["primary_email", "first_name"],
  required_headers: ["primary_email"],
  default_duplicate_mode: "skip",
  suggested_mapping: {
    primary_email: "email",
    first_name: "first_name",
  },
};

const summary = {
  message: "Import completed.",
  total_rows: 2,
  processed_rows: 2,
  imported_rows: 1,
  new_rows: 1,
  skipped_rows: 0,
  overwritten_rows: 0,
  merged_rows: 0,
  failed_rows: 1,
  failures: [{ row_number: 3, record_identifier: "bad@example.com", reason: "Email is invalid." }],
};

async function chooseImportFile(page: Page) {
  await page.getByRole("button", { name: "Actions" }).click();
  await page.getByLabel("Import").setInputFiles({
    name: "leads.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("email,first_name\nada@example.com,Ada"),
  });
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("validates mapping and confirms overwrite imports on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/sales/leads/import/preview", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(preview) }),
  );
  await page.route("**/sales/leads/import?**", async (route) => {
    expect(new URL(route.request().url()).searchParams.get("duplicate_mode")).toBe("overwrite");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ mode: "inline", message: "Import completed.", summary }),
    });
  });
  await page.goto("/dashboard/sales/leads");
  await chooseImportFile(page);

  await expect(page.getByRole("heading", { name: "Import preview" })).toBeVisible();
  await expect(page.getByText("leads.csv")).toBeVisible();

  await page.getByLabel("primary_email").click();
  await page.getByRole("option", { name: "Do not import this field" }).click();
  await page.getByRole("button", { name: "Run import" }).click();
  await expect(page.getByRole("alert")).toContainText("Map the required fields");

  await page.getByLabel("primary_email").click();
  await page.getByRole("option", { name: "email" }).click();
  await page.getByLabel("Duplicate handling").click();
  await page.getByRole("option", { name: "Overwrite duplicates" }).click();
  await page.getByRole("button", { name: "Run import" }).click();

  await expect(page.getByRole("heading", { name: "Overwrite duplicates?" })).toBeVisible();
  await page.getByRole("button", { name: "Run overwrite import" }).click();

  await expect(page.getByRole("heading", { name: "Import summary" })).toBeVisible();
  await expect(page.getByText("bad@example.com")).toBeVisible();
  await expect(page.getByText("Email is invalid.")).toBeVisible();
});

test("redacts import preview backend details", async ({ page }) => {
  await page.route("**/sales/leads/import/preview", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "COPY tenant_id=42 failed on private-db" }),
    }),
  );
  await page.goto("/dashboard/sales/leads");
  await chooseImportFile(page);

  await expect(page.getByText("The import preview could not be loaded. Check the file and try again.")).toBeVisible();
  await expect(page.getByText(/tenant_id=42|private-db/)).toHaveCount(0);
});
