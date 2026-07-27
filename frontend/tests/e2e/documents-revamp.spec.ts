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

test("Document library failures use recoverable messages without backend detail", async ({ page }) => {
  await page.route("**/documents/storage/usage", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "tenant_storage_limit_bytes missing for tenant 9001" }),
    }),
  );
  await page.route("**/documents?**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "SELECT documents FROM tenant_9001 failed" }),
    }),
  );

  await page.goto("/dashboard/documents");

  await expect(page.getByText("Storage usage is unavailable. Upload limits are still enforced by the server.")).toBeVisible();
  await expect(page.getByText("Documents could not be loaded. Check your connection and try again.")).toBeVisible();
  await expect(page.getByText("tenant_storage_limit_bytes missing for tenant 9001")).toBeHidden();
  await expect(page.getByText("SELECT documents FROM tenant_9001 failed")).toBeHidden();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("Revoking client document access requires confirmation", async ({ page }) => {
  const shareId = 55;
  const document = {
    ...documentFixture(),
    client_shares: [{
      id: shareId,
      document_id: documentId,
      contact_id: 41,
      organization_id: null,
      expires_at: null,
      revoked_at: null,
      created_by_user_id: 1,
      created_at: "2099-07-24T08:00:00Z",
    }],
  };
  let revokeRequests = 0;
  await page.route("**/documents?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [document], total: 1 }),
    }),
  );
  await page.route(`**/documents/${documentId}/versions`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    }),
  );
  await page.route(`**/documents/${documentId}/client-shares/${shareId}`, (route) => {
    revokeRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...document.client_shares[0], revoked_at: "2099-07-24T09:00:00Z" }),
    });
  });

  await page.goto("/dashboard/documents");
  await page.getByRole("button", { name: "Versions" }).click();
  await page.getByRole("button", { name: "Revoke", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Revoke client document access?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(revokeRequests).toBe(0);

  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  await page.getByRole("button", { name: "Revoke access" }).click();
  await expect.poll(() => revokeRequests).toBe(1);
});
