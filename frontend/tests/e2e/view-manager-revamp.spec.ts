import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

type SavedView = {
  id: number;
  module_key: string;
  name: string;
  config: {
    visible_columns: string[];
    filters: Record<string, unknown>;
    sort: null;
  };
  is_default: boolean;
  is_system: boolean;
  updated_at: string;
};

const emptyFilters = {
  search: "",
  logic: "all",
  conditions: [],
  all_conditions: [],
  any_conditions: [],
};

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);

  let views: SavedView[] = [
    {
      id: 71,
      module_key: "sales_contacts",
      name: "Default View",
      config: { visible_columns: ["first_name", "primary_email", "contact_telephone"], filters: emptyFilters, sort: null },
      is_default: false,
      is_system: true,
      updated_at: "2099-07-20T08:00:00Z",
    },
    {
      id: 72,
      module_key: "sales_contacts",
      name: "My Contacts",
      config: { visible_columns: ["first_name", "primary_email"], filters: emptyFilters, sort: null },
      is_default: true,
      is_system: false,
      updated_at: "2099-07-20T09:00:00Z",
    },
  ];

  await page.route("**/custom-fields/sales_contacts", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/module-fields/sales_contacts", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/users/saved-views/sales_contacts?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ views }) }),
  );
  await page.route("**/users/saved-views/sales_contacts", async (route) => {
    const payload = route.request().postDataJSON() as { name: string; config: SavedView["config"] };
    const created: SavedView = {
      id: 73,
      module_key: "sales_contacts",
      name: payload.name,
      config: payload.config,
      is_default: false,
      is_system: false,
      updated_at: "2099-07-20T10:00:00Z",
    };
    views = [...views, created];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(created) });
  });
  await page.route(/\/users\/saved-views\/sales_contacts\/\d+$/, async (route) => {
    const viewId = Number(new URL(route.request().url()).pathname.split("/").at(-1));
    if (route.request().method() === "DELETE") {
      views = views.filter((view) => view.id !== viewId);
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    const payload = route.request().postDataJSON() as Partial<Pick<SavedView, "name" | "config" | "is_default">>;
    views = views.map((view) => view.id === viewId ? { ...view, ...payload } : view);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(views.find((view) => view.id === viewId)),
    });
  });
});

test("adds and reorders fields, updates preview, and saves from mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/views/sales_contacts?viewId=72");

  await expect(page.getByRole("heading", { name: "Manage Contacts View" })).toBeVisible();
  await page.getByRole("button", { name: "Add Last Name" }).click();
  await page.getByRole("button", { name: "Move Email up" }).click();
  await page.getByLabel("Default search").fill("active customer");
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  const selectedOrder = await page.locator('[data-testid^="selected-column-"]').evaluateAll((items) =>
    items.map((item) => item.getAttribute("data-testid")),
  );
  expect(selectedOrder).toEqual([
    "selected-column-primary_email",
    "selected-column-first_name",
    "selected-column-last_name",
  ]);
  await expect(page.getByTestId("preview-column-primary_email")).toBeVisible();

  const updateRequest = page.waitForRequest((request) => request.method() === "PUT" && request.url().endsWith("/users/saved-views/sales_contacts/72"));
  await page.getByRole("button", { name: "Save Changes" }).click();
  const request = await updateRequest;
  expect(request.postDataJSON()).toMatchObject({
    config: {
      visible_columns: ["primary_email", "first_name", "last_name"],
      filters: { search: "active customer" },
    },
  });
  await expect(page.getByText("All changes saved")).toBeVisible();
});

test("supports drag ordering, guards switching, and saves a new view from default", async ({ page }) => {
  await page.goto("/dashboard/views/sales_contacts?viewId=72");
  await page.getByTestId("selected-column-primary_email").dragTo(page.getByTestId("selected-column-first_name"));
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("discard unsaved changes");
    await dialog.dismiss();
  });
  await page.getByLabel("Select saved view").click();
  await page.getByRole("option", { name: "Default View" }).click();
  await expect(page).toHaveURL(/viewId=72/);

  await page.getByRole("button", { name: "Discard" }).click();
  await page.getByRole("button", { name: "New From Default" }).click();
  await expect(page.getByText("System", { exact: true })).toBeVisible();
  await page.getByLabel("View name").fill("Focused Contacts");

  const createRequest = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/users/saved-views/sales_contacts"));
  await page.getByRole("button", { name: "Save As New" }).click();
  const request = await createRequest;
  expect(request.postDataJSON()).toMatchObject({ name: "Focused Contacts" });
  await expect(page).toHaveURL(/viewId=73/);
});
