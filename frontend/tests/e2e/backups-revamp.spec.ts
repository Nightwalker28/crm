import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const backupSettings = {
  id: 7,
  tenant_id: 42,
  enabled: false,
  frequency: "manual",
  scope: "full_tenant",
  selected_modules: [],
  retention_count: 3,
  destination: "local_download",
  include_documents: true,
  last_run_at: null,
  next_run_at: null,
  updated_at: "2026-07-25T08:00:00Z",
};

const modules = [
  {
    id: 1,
    name: "sales_leads",
    description: "Leads",
    is_enabled: true,
    import_duplicate_mode: "skip",
  },
  {
    id: 2,
    name: "documents",
    description: "Documents",
    is_enabled: true,
    import_duplicate_mode: "skip",
  },
];

const completedRun = {
  id: 101,
  requested_by_user_id: 1,
  settings_id: 7,
  backup_type: "tenant",
  scope: "full_tenant",
  modules_included: ["sales_leads", "documents"],
  status: "completed",
  started_at: "2026-07-25T08:00:00Z",
  completed_at: "2026-07-25T08:01:00Z",
  storage_ref: "tenant/42/backup-101.zip",
  size_bytes: 4096,
  error_message: null,
  destination: "local_download",
  destination_upload_status: "uploaded",
  metadata_json: {},
  created_at: "2026-07-25T08:00:00Z",
  updated_at: "2026-07-25T08:01:00Z",
};

const failedRun = {
  ...completedRun,
  id: 102,
  status: "failed",
  storage_ref: null,
  size_bytes: null,
  destination_upload_status: "failed",
  error_message: "psycopg2 connection refused at internal-db:5432 secret-token",
};

async function mockBackupPage(page: Page, runs = [completedRun, failedRun]) {
  await page.route("**/admin/tenant-backup-settings/destinations/connections", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  // The GET used to keep returning the original record after a PUT, so the page it was
  // testing could never settle: the draft held the saved values and the query held the old
  // ones, which reads as permanently dirty. It remembers the write now.
  let saved = backupSettings;
  await page.route("**/admin/tenant-backup-settings", async (route) => {
    if (route.request().method() === "PUT") {
      saved = { ...saved, ...route.request().postDataJSON(), updated_at: "2026-07-25T09:00:00Z" };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(saved) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(saved) });
  });
  await page.route("**/admin/tenant-backup-runs?page=1&page_size=10", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: runs }),
    }),
  );
  await page.route("**/admin/users/modules", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(modules) }),
  );
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("saves responsive tenant backup settings with shared controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockBackupPage(page, []);
  await page.goto("/dashboard/settings/backups");

  // The schedule was behind a `Configure` drawer and is on the page now (rebuild 5.6 batch
  // 6d), so every step below lost its drawer scope. What is being checked is unchanged: the
  // record still commits as a set, through one footer.
  await expect(page.getByRole("heading", { name: "Backups" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Configure backups" })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Manual only", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Scheduled", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Scheduled", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "Include", exact: true })).toHaveAttribute("aria-checked", "true");

  await page.getByRole("combobox", { name: "Scope" }).click();
  await page.getByRole("option", { name: "Selected modules" }).click();
  await page.getByRole("checkbox", { name: "Leads" }).click();
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  const saveRequest = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/admin/tenant-backup-settings"),
  );
  await page.getByRole("button", { name: "Save schedule" }).click();
  const payload = (await saveRequest).postDataJSON() as {
    enabled: boolean;
    scope: string;
    selected_modules: string[];
  };

  expect(payload.enabled).toBeTruthy();
  expect(payload.scope).toBe("selected_modules");
  expect(payload.selected_modules).toEqual(["sales_leads"]);
  await expect(page.getByText("All changes saved")).toBeVisible();
});

test("discards a dirty backup configuration without writing", async ({ page }) => {
  await mockBackupPage(page, []);
  await page.goto("/dashboard/settings/backups");

  // There is no drawer to dismiss any more, so the discard confirmation that guarded closing
  // it went with it. The unsaved draft is still recoverable — through the footer's Discard,
  // which is where the rest of the app puts it (5.4).
  let writes = 0;
  await page.route("**/admin/tenant-backup-settings", async (route) => {
    if (route.request().method() === "PUT") writes += 1;
    await route.fallback();
  });

  const discard = page.getByRole("button", { name: "Discard changes" });
  await expect(discard).toBeDisabled();

  await page.getByRole("radio", { name: "Scheduled", exact: true }).click();
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await discard.click();

  await expect(page.getByRole("radio", { name: "Manual only", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("All changes saved")).toBeVisible();
  expect(writes).toBe(0);
});

test("redacts backup failures and confirms artifact deletion", async ({ page }) => {
  await mockBackupPage(page);
  let deleteRequests = 0;
  await page.route("**/admin/tenant-backup-runs/101", async (route) => {
    if (route.request().method() === "DELETE") {
      deleteRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ run: completedRun, message: "Deleted" }),
      });
      return;
    }
    await route.fallback();
  });
  await page.goto("/dashboard/settings/backups");

  await expect(page.getByText("Backup failed. Try again or review the destination.")).toBeVisible();
  await expect(page.getByText(/psycopg2|internal-db|secret-token/)).toHaveCount(0);

  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("heading", { name: "Delete backup artifact?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(deleteRequests).toBe(0);

  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete backup" }).click();
  await expect.poll(() => deleteRequests).toBe(1);
});

test("shows a recoverable fixed error when settings fail", async ({ page }) => {
  await page.route("**/admin/tenant-backup-settings/destinations/connections", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/admin/tenant-backup-settings", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "redis://internal-cache:6379 secret-stack-trace" }),
    }),
  );
  await page.route("**/admin/tenant-backup-runs?page=1&page_size=10", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) }),
  );
  await page.route("**/admin/users/modules", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(modules) }),
  );
  await page.goto("/dashboard/settings/backups");

  await expect(page.getByRole("heading", { name: "Unable to load backup settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByText(/internal-cache|secret-stack-trace/)).toHaveCount(0);
});
