import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const departments = [
  { id: 10, name: "Operations", description: "Revenue operations" },
];

const teams = [
  { id: 21, name: "Platform", description: "Platform administrators", department_id: 10 },
];

async function mockStructure(page: Page) {
  await page.route("**/admin/users/departments", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(departments),
    }),
  );
  await page.route("**/admin/users/teams", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(teams),
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("Teams and Departments uses labeled workflows and guards dirty dismissal", async ({ page }) => {
  await mockStructure(page);
  await page.goto("/dashboard/settings/teams");

  await expect(page.getByRole("heading", { name: "Teams & Departments" })).toBeVisible();
  await expect(page.getByText("Revenue operations")).toBeVisible();
  await expect(page.getByText("Platform administrators")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Operations" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete Platform" })).toBeVisible();

  await page.getByRole("button", { name: "Create Department" }).click();
  const departmentDialog = page.getByRole("dialog").filter({ hasText: "Create Department" });
  await expect(departmentDialog.getByLabel("Name")).toBeVisible();
  await expect(departmentDialog.getByLabel("Description")).toBeVisible();
  await departmentDialog.getByLabel("Name").fill("Customer Success");
  await departmentDialog.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByRole("heading", { name: "Discard department changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Discard Changes" }).click();
  await expect(page.getByRole("heading", { name: "Create Department" })).toHaveCount(0);
});

test("Teams and Departments confirms consequences and redacts mutation failures", async ({ page }) => {
  await mockStructure(page);
  await page.route("**/admin/users/departments/10", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ detail: "tenant_id=42 has protected team rows" }),
    }),
  );
  await page.route("**/admin/users/teams", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "database_password=private-secret" }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(teams),
    });
  });

  await page.goto("/dashboard/settings/teams");
  await page.getByRole("button", { name: "Delete Operations" }).click();
  await expect(page.getByRole("dialog")).toContainText("Departments with assigned teams cannot be deleted.");
  await page.getByRole("button", { name: "Delete Department" }).click();

  await expect(page.getByText("Move or delete this department's teams before deleting it.")).toBeVisible();
  await expect(page.getByText("tenant_id=42 has protected team rows")).toHaveCount(0);
  await page.getByRole("button", { name: "Dismiss" }).click();

  await page.getByRole("button", { name: "Create Team" }).click();
  const teamDialog = page.getByRole("dialog").filter({ hasText: "Create Team" });
  await teamDialog.getByLabel("Name").fill("Customer Success");
  await expect(teamDialog.getByLabel("Department")).toBeVisible();
  await teamDialog.getByRole("button", { name: "Save" }).click();

  await expect(teamDialog.getByText("We could not save this team. Try again.")).toBeVisible();
  await expect(page.getByText("database_password=private-secret")).toHaveCount(0);
});

test("Teams and Departments exposes a fixed recoverable load error", async ({ page }) => {
  await page.route("**/admin/users/departments", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "SELECT departments WHERE tenant_id=42" }),
    }),
  );
  await page.route("**/admin/users/teams", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "redis://private-host" }),
    }),
  );

  await page.goto("/dashboard/settings/teams");

  await expect(page.getByRole("heading", { name: "Unable to load teams and departments" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByText(/tenant_id=42|private-host/)).toHaveCount(0);
});
