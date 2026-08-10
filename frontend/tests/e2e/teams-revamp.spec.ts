import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const departments = [
  { id: 10, name: "Operations", description: "Revenue operations" },
  { id: 20, name: "Customer Success", description: "Customer retention" },
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

function departmentCard(page: Page, name: string) {
  return page.locator("section").filter({
    has: page.getByRole("heading", { name, exact: true }),
  });
}

test("department Add Team actions preserve their exact context", async ({ page }) => {
  await mockStructure(page);
  await page.goto("/dashboard/settings/teams");

  const operations = departmentCard(page, "Operations");
  const customerSuccess = departmentCard(page, "Customer Success");

  await expect(operations.getByRole("button", { name: "Add Team" })).toBeVisible();
  await operations.getByRole("button", { name: "Add Team" }).click();
  let editor = page.getByRole("dialog", { name: "Create Team" });
  await expect(editor).toContainText("Selected department: Operations");
  await expect(editor.getByLabel("Department")).toContainText("Operations");
  await editor.getByLabel("Name").fill("Revenue Enablement");
  await expect(editor.getByLabel("Department")).toContainText("Operations");
  await editor.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Discard Changes" }).click();

  await expect(customerSuccess.getByText("No teams in this department.")).toBeVisible();
  await customerSuccess.getByRole("button", { name: "Add Team" }).click();
  editor = page.getByRole("dialog", { name: "Create Team" });
  await expect(editor).toContainText("Selected department: Customer Success");
  await expect(editor.getByLabel("Department")).toContainText("Customer Success");
});

test("global Create Team defaults to the first department", async ({ page }) => {
  await mockStructure(page);
  await page.goto("/dashboard/settings/teams");

  await page.getByRole("button", { name: "Create Team" }).click();
  const editor = page.getByRole("dialog", { name: "Create Team" });
  await expect(editor).toContainText("Selected department: Operations");
  await expect(editor.getByLabel("Department")).toContainText("Operations");
});

test("adds another team to a department that already has teams", async ({ page }) => {
  let createPayload: Record<string, unknown> | null = null;
  await mockStructure(page);
  await page.route("**/admin/users/teams", async (route) => {
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      createPayload = payload;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: 22, ...payload }),
      });
      return;
    }
    await route.fallback();
  });
  await page.goto("/dashboard/settings/teams");

  await departmentCard(page, "Operations").getByRole("button", { name: "Add Team" }).click();
  const editor = page.getByRole("dialog", { name: "Create Team" });
  await editor.getByLabel("Name").fill("Revenue Enablement");
  await editor.getByRole("button", { name: "Save Team" }).click();

  await expect.poll(() => createPayload).toMatchObject({
    name: "Revenue Enablement",
    department_id: 10,
  });
});

test("no-department state disables team creation and directs department setup", async ({ page }) => {
  await page.route("**/admin/users/departments", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/admin/users/teams", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.goto("/dashboard/settings/teams");

  await expect(page.getByRole("button", { name: "Create Team" })).toBeDisabled();
  await expect(page.getByText("Create the first department, then add teams inside it.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Department" })).toHaveCount(2);
});

test("team editor guards unsaved close and keeps the sheet open when cancelled", async ({ page }) => {
  await mockStructure(page);
  await page.goto("/dashboard/settings/teams");

  await departmentCard(page, "Customer Success").getByRole("button", { name: "Add Team" }).click();
  const editor = page.getByRole("dialog", { name: "Create Team" });
  await editor.getByLabel("Name").fill("Onboarding");
  await editor.getByRole("button", { name: "Close team editor" }).click();
  await expect(page.getByRole("heading", { name: "Discard team changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Name")).toHaveValue("Onboarding");
});

test("editing a team retains its existing department", async ({ page }) => {
  await mockStructure(page);
  await page.goto("/dashboard/settings/teams");

  await page.getByRole("button", { name: "Edit Platform" }).click();
  const editor = page.getByRole("dialog", { name: "Edit Team" });
  await expect(editor).toContainText("Selected department: Operations");
  await expect(editor.getByLabel("Department")).toContainText("Operations");
});

test("Teams and Departments uses labeled workflows and guards dirty dismissal", async ({ page }) => {
  await mockStructure(page);
  await page.goto("/dashboard/settings/teams");

  await expect(page.getByRole("heading", { name: "Teams", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Organization structure" })).toBeVisible();
  await expect(page.getByText("Revenue operations")).toBeVisible();
  await expect(page.getByText("Platform administrators")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Operations" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete Platform" })).toBeVisible();

  await page.getByRole("button", { name: "Create Department" }).click();
  const departmentDialog = page.getByRole("dialog").filter({ hasText: "Create Department" });
  await expect(departmentDialog).toHaveAccessibleName("Create Department");
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
  await expect(teamDialog).toHaveAccessibleName("Create Team");
  await teamDialog.getByLabel("Name").fill("Customer Success");
  await expect(teamDialog.getByLabel("Department")).toBeVisible();
  await teamDialog.getByRole("button", { name: "Save Team" }).click();

  await expect(teamDialog.getByText("We could not save this team. Try again.")).toBeVisible();
  await expect(page.getByText("database_password=private-secret")).toHaveCount(0);
});

test("Teams create deep link initializes the department and opens the editor", async ({ page }) => {
  await mockStructure(page);
  await page.goto("/dashboard/settings/teams?action=create-team");

  const teamDialog = page.getByRole("dialog", { name: "Create Team" });
  await expect(teamDialog).toBeVisible();
  await expect(teamDialog.getByLabel("Department")).toContainText("Operations");
  await expect(teamDialog.getByRole("button", { name: "Save Team" })).toBeDisabled();
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
