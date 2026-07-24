import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const documentId = 8801;

function documentFixture() {
  return {
    id: documentId,
    title: "Renewal agreement",
    description: "Signed customer renewal agreement.",
    original_filename: "renewal-agreement.txt",
    content_type: "text/plain",
    extension: "txt",
    file_size_bytes: 24,
    storage_provider: "local",
    is_template: false,
    template_category: null,
    current_version_id: 1,
    uploaded_by_user_id: 1,
    created_at: "2099-07-24T08:00:00Z",
    updated_at: "2099-07-24T08:00:00Z",
    links: [],
    client_shares: [],
  };
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.route("**/documents/storage/connections", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/documents/storage/usage", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        used_bytes: 24,
        tenant_storage_limit_bytes: 1048576,
        remaining_bytes: 1048552,
        usage_percent: 0.01,
      }),
    }),
  );
});

test("Document upload is responsive and focuses the required file control", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/documents/upload");

  await expect(page.getByRole("heading", { name: "Upload document" })).toBeVisible();
  await page.getByRole("button", { name: "Upload document" }).click();
  await expect(page.getByText("Choose a document to upload.")).toBeVisible();
  await expect(page.getByLabel("File")).toBeFocused();
});

test("Document upload returns to and highlights the saved library record", async ({ page }) => {
  const document = documentFixture();
  await page.route("**/documents", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(document),
    });
  });
  await page.route("**/documents?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [document], total: 1 }),
    }),
  );

  await page.goto("/dashboard/documents/upload");
  await page.getByLabel("Title").fill("Renewal agreement");
  await page.getByLabel("File").setInputFiles({
    name: "renewal-agreement.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("signed renewal agreement"),
  });
  await page.getByRole("button", { name: "Upload document" }).click();

  await expect(page).toHaveURL(new RegExp(`/dashboard/documents\\?documentId=${documentId}$`));
  await expect(page.getByText("Renewal agreement", { exact: true })).toBeVisible();
});

test("Document removal requires confirmation and redacts backend failures", async ({ page }) => {
  const document = documentFixture();
  await page.route("**/documents?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [document], total: 1 }),
    }),
  );
  await page.route(`**/documents/${documentId}`, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "storage_path=/private/tenant-secret" }),
    }),
  );

  await page.goto("/dashboard/documents");
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("heading", { name: "Remove document?" })).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).click();

  await expect(page.getByText("We could not remove this document. Try again.")).toBeVisible();
  await expect(page.getByText("storage_path=/private/tenant-secret")).toBeHidden();
});
