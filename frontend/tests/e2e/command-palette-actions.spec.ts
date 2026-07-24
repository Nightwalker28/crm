import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const fullActions = {
  can_view: true,
  can_create: true,
  can_edit: true,
  can_delete: true,
  can_restore: true,
  can_export: true,
  can_configure: true,
};

test.beforeEach(async ({ page }) => {
  await page.route("**/users/me/modules", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 1,
          name: "sales_leads",
          base_route: "/dashboard/sales/leads",
          description: "Sales leads",
          is_enabled: true,
          actions: fullActions,
        },
        {
          id: 2,
          name: "sales_contacts",
          base_route: "/dashboard/sales/contacts",
          description: "Sales contacts",
          is_enabled: true,
          actions: { ...fullActions, can_create: false },
        },
        {
          id: 3,
          name: "tasks",
          base_route: "/dashboard/tasks",
          description: "Tasks",
          is_enabled: true,
          actions: fullActions,
        },
      ]),
    }),
  );

  await loginAsAdmin(page);
});

test("shows only permitted module actions and opens routed create workflows", async ({ page }) => {
  await page.keyboard.press("Control+K");

  await expect(page.getByText("Create lead", { exact: true })).toBeVisible();
  await expect(page.getByText("Create task", { exact: true })).toBeVisible();
  await expect(page.getByText("Create contact", { exact: true })).toBeHidden();

  await page.getByText("Create lead", { exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/sales\/leads\/new$/);
  await expect(page.getByRole("heading", { name: "Create lead" })).toBeVisible();
});
