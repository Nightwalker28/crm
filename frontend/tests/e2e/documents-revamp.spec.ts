import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const documentId = 8801;

function documentFixture() {
  return {
    id: documentId,
    tenant_id: 1,
    title: "Renewal agreement",
    display_name: "Renewal agreement",
    description: "Signed customer renewal agreement.",
    original_filename: "renewal-agreement.txt",
    content_type: "text/plain",
    extension: "txt",
    file_size_bytes: 24,
    storage_provider: "local",
    provider_status: "available",
    uploaded_at: "2099-07-24T08:00:00Z",
    tags: [],
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
  await page.route("**/documents/limits", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ allowed_extensions: ["pdf", "doc", "docx", "txt", "rtf", "odt"], max_upload_bytes: 1048576, tenant_storage_limit_bytes: 1048576 }),
    }),
  );
});

test("Document upload is responsive and shows file validation beside the affected row", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/documents/upload");

  await expect(page.getByRole("heading", { name: "Upload documents" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: "malware.exe", mimeType: "application/octet-stream", buffer: Buffer.from("unsafe") });
  await expect(page.getByText("malware.exe", { exact: true })).toBeVisible();
  await expect(page.getByText("This file type is not supported.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload files" })).toBeHidden();
});

test("Choose files and drop both create compact multi-file queue rows", async ({ page }) => {
  await page.goto("/dashboard/documents/upload");
  await page.locator('input[type="file"]').setInputFiles([
    { name: "first.txt", mimeType: "text/plain", buffer: Buffer.from("first") },
    { name: "second.txt", mimeType: "text/plain", buffer: Buffer.from("second") },
  ]);
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["third"], "third.txt", { type: "text/plain" }));
    return transfer;
  });
  await page.getByRole("button", { name: "Add more document files" }).dispatchEvent("drop", { dataTransfer });

  await expect(page.getByText("first.txt", { exact: true })).toBeVisible();
  await expect(page.getByText("second.txt", { exact: true })).toBeVisible();
  await expect(page.getByText("third.txt", { exact: true })).toBeVisible();
  await expect(page.getByText(/3 files ready/)).toBeVisible();
});

test("CRM association search keeps records with the same numeric ID distinct across modules", async ({ page }) => {
  await page.route("**/global-search?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        query: "acme",
        results: [
          { module_key: "sales_contacts", module_label: "Contacts", record_id: "1", title: "Acme contact", subtitle: "person@example.com", href: "/dashboard/sales/contacts/1" },
          { module_key: "sales_organizations", module_label: "Accounts", record_id: "1", title: "Acme account", subtitle: "Customer", href: "/dashboard/sales/organizations/1" },
        ],
      }),
    }),
  );
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/dashboard/documents/upload");
  await page.getByText("Details and CRM links").click();
  await page.getByPlaceholder("Search records by module or name").fill("acme");

  await expect(page.getByRole("option", { name: /Acme contact/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /Acme account/ })).toBeVisible();
  await page.getByRole("option", { name: /Acme contact/ }).click();
  await expect(page.getByText("Contacts · Acme contact")).toBeVisible();
  await page.getByPlaceholder("Search records by module or name").fill("acme");
  await page.getByRole("option", { name: /Acme account/ }).click();
  await expect(page.getByText("Accounts · Acme account")).toBeVisible();
  expect(consoleErrors.some((message) => message.includes("same key"))).toBeFalsy();
});

test("Document upload keeps per-file completion actions on the full page", async ({ page }) => {
  const document = documentFixture();
  await page.route("**/api/v1/documents", async (route) => {
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
  await page.locator('input[type="file"]').setInputFiles({
    name: "renewal-agreement.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("signed renewal agreement"),
  });
  await page.getByText("Add file overrides").click();
  await page.getByRole("button", { name: "Customize this file" }).click();
  await page.getByLabel("Display title").fill("Renewal agreement");
  // The per-file override inputs render before the shared ones, and the shared Category is
  // hidden while overrides are open, so last() picks an unfillable element.
  await page.getByLabel("Category").first().fill("Contract");
  const overrideTags = page.getByLabel("Tags", { exact: true }).first();
  await overrideTags.fill("renewal");
  await overrideTags.press("Enter");
  await page.getByRole("button", { name: "Upload files" }).click();

  await expect(page).toHaveURL(/\/dashboard\/documents\/upload$/);
  await expect(page.getByText("Complete", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "View" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  await expect(page.getByText("1 file complete")).toBeVisible();
});

test("Connection lookup failure leaves local upload available", async ({ page }) => {
  await page.route("**/documents/storage/connections", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "provider unavailable" }) }),
  );
  await page.goto("/dashboard/documents/upload");

  await expect(page.getByText("Cloud connections could not be checked. Local storage remains available.")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Storage destination" })).toContainText("MAAD-CRM storage");
  await expect(page.getByRole("button", { name: "Choose document files or drag and drop them here" })).toBeEnabled();
});

test("Connected Google Drive destination uploads and keeps stable provider actions", async ({ page }) => {
  const cloudDocument = {
    ...documentFixture(),
    storage_provider: "google_drive",
    provider_file_id: "google-file-id",
    external_web_url: "https://drive.google.com/file/d/google-file-id/view",
  };
  await page.route("**/documents/storage/connections", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{ provider: "google_drive", status: "connected", account_email: "files@example.com", provider_root_name: "Lynk", updated_at: "2099-07-24T08:00:00Z" }]),
  }));
  await page.route("**/api/v1/documents", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    expect((await route.request().postDataBuffer())?.toString("utf8")).toContain("google_drive");
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(cloudDocument) });
  });
  await page.goto("/dashboard/documents/upload");
  await page.getByRole("combobox", { name: "Storage destination" }).click();
  await page.getByRole("option", { name: "Google Drive" }).click();
  await expect(page.getByText(/files@example.com/)).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: "cloud.txt", mimeType: "text/plain", buffer: Buffer.from("cloud") });
  await page.getByRole("button", { name: "Upload files" }).click();
  await expect(page.getByText("Complete", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "View" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Copy link" })).toBeEnabled();
});

test("Failed rows retry with the same upload key and completed rows are not uploaded twice", async ({ page }) => {
  const document = documentFixture();
  const uploadKeys: string[] = [];
  let attempts = 0;
  await page.route("**/api/v1/documents", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    attempts += 1;
    const body = await route.request().postDataBuffer();
    // The multipart header is name="idempotency_key", so the value only starts after the
    // closing quote; without it the match never lands and the key reads as empty.
    uploadKeys.push(body?.toString("utf8").match(/name="idempotency_key"\r\n\r\n([^\r]+)/)?.[1] ?? "");
    if (attempts === 1) return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(document) });
  });
  await page.goto("/dashboard/documents/upload");
  await page.locator('input[type="file"]').setInputFiles({ name: "retry.txt", mimeType: "text/plain", buffer: Buffer.from("retry") });
  await page.getByRole("button", { name: "Upload files" }).click();
  await expect(page.getByText("Failed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Complete", { exact: true })).toBeVisible();

  expect(attempts).toBe(2);
  expect(uploadKeys[0]).toBeTruthy();
  expect(uploadKeys[1]).toBe(uploadKeys[0]);
});

test("Pending queue warns before navigation and keyboard users can remove the file", async ({ page }) => {
  await page.goto("/dashboard/documents/upload");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose document files or drag and drop them here" }).press("Enter");
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: "draft.txt", mimeType: "text/plain", buffer: Buffer.from("draft") });
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("unsaved changes");
    await dialog.dismiss();
  });
  await page.getByRole("link", { name: "Back to documents" }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/documents\/upload$/);

  await page.getByRole("button", { name: "Remove" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("draft.txt", { exact: true })).toBeHidden();
});

test("Lost cloud access disables the shared document view action", async ({ page }) => {
  const cloudDocument = {
    ...documentFixture(),
    storage_provider: "google_drive",
    provider_status: "permission_lost",
    external_web_url: "https://drive.google.com/file/d/provider-id/view",
  };
  await page.route("**/documents?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [cloudDocument], total: 1 }) }),
  );

  await page.goto("/dashboard/documents");

  await expect(page.getByRole("button", { name: "View" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "View" })).toHaveAttribute("title", /Reconnect the provider account/);
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
  await page.route(`**/api/v1/documents/${documentId}`, (route) =>
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
