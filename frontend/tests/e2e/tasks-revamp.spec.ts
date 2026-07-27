import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const taskId = 987654331;

function taskFixture(status = "todo") {
  const due = new Date();
  due.setHours(14, 0, 0, 0);
  return {
    id: taskId,
    title: "Prepare renewal brief",
    description: "Collect the latest account context before the customer review.",
    status,
    priority: "high",
    start_at: null,
    due_at: due.toISOString(),
    completed_at: status === "completed" ? new Date().toISOString() : null,
    source_module_key: "sales_organizations",
    source_entity_id: "51",
    source_label: "Acme",
    created_by_user_id: 1,
    updated_by_user_id: 1,
    assigned_by_user_id: 1,
    created_by_name: "Admin User",
    updated_by_name: "Admin User",
    assigned_by_name: "Admin User",
    assigned_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    assignees: [{ assignee_type: "user", assignee_key: "user:1", user_id: 1, team_id: null, label: "Admin User" }],
  };
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  let task = taskFixture();
  await page.route("**/tasks?**", async (route) => {
    const url = new URL(route.request().url());
    const pageSize = Number(url.searchParams.get("page_size") ?? 10);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [task], range_start: 1, range_end: 1, total_count: 1, total_pages: 1, page: 1, page_size: pageSize }),
    });
  });
  await page.route(`**/tasks/${taskId}`, async (route) => {
    if (route.request().method() === "PUT") {
      task = { ...task, ...route.request().postDataJSON(), updated_at: new Date().toISOString() };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(task) });
  });
  await page.route(`**/calendar/events/from-task/${taskId}`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ event: null }) });
  });
  await page.route("**/tasks/options**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ users: [], teams: [] }) });
  });
});

test("Tasks expose list, board, and calendar views with quick review", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/tasks");

  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(page.getByPlaceholder("Search tasks")).toBeVisible();
  await expect(page.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Board" }).click();
  await expect(page.getByText(/Drag cards between columns/)).toBeVisible();
  await expect(page.getByRole("region", { name: "To Do tasks" })).toContainText("Prepare renewal brief");
  await page.getByRole("button", { name: "Prepare renewal brief" }).click();
  await expect(page.getByRole("heading", { name: "Edit Task" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/dashboard/tasks\\?taskId=${taskId}$`));
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Calendar" }).click();
  await expect(page.getByRole("region", { name: "Task due date calendar" })).toBeVisible();
  await expect(page.getByText("1 of 1 loaded tasks have a due date")).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous month" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next month" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare renewal brief" })).toBeVisible();
});

test("Board status menu updates a task", async ({ page }) => {
  await page.goto("/dashboard/tasks");
  await page.getByRole("button", { name: "Board" }).click();
  await page.getByRole("combobox", { name: "Change status for Prepare renewal brief" }).click();
  await page.getByRole("option", { name: "In Progress" }).click();
  await expect(page.getByRole("region", { name: "In Progress tasks" })).toContainText("Prepare renewal brief");
  await expect(page.getByText("Task moved to in progress.")).toBeVisible();
});

test("Task creation labels required fields and validates the schedule", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/tasks");

  await page.getByRole("button", { name: "Add Task" }).click();
  await expect(page.getByRole("heading", { name: "Create Task" })).toBeVisible();
  await page.getByLabel("Task title").fill("Schedule customer follow-up");
  await page.getByLabel("Start").fill("2026-07-25T15:00");
  await page.getByLabel("Due").fill("2026-07-25T14:00");

  await expect(page.getByText("Due time must be after the start time.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Task" })).toBeDisabled();
});

test("Task assignees use the shared accessible user and team picker", async ({ page }) => {
  await page.unroute("**/tasks/options**");
  await page.route("**/tasks/options**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        users: [{ id: 7, name: "Ada Owner", email: "ada@example.com", team_name: "Revenue" }],
        teams: [{ id: 4, name: "Revenue" }],
      }),
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/tasks?action=create");

  await page.getByRole("button", { name: "Select task assignees" }).click();
  const search = page.getByLabel("Search task assignees");
  await expect(search).toBeVisible();
  await search.fill("Revenue");

  const userOption = page.getByRole("button", { name: /Ada Owner/ });
  const teamOption = page.getByRole("button", { name: /RevenueTeam assignment/ });
  await expect(userOption).toHaveAttribute("aria-pressed", "false");
  await userOption.click();
  await teamOption.click();
  await expect(page.getByRole("button", { name: "Select task assignees" })).toContainText("2 assignees selected");
  await expect(page.getByRole("button", { name: "Remove Ada Owner" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Revenue" })).toBeVisible();
});

test("Task list failures do not expose backend details", async ({ page }) => {
  await page.unroute("**/tasks?**");
  await page.route("**/tasks?**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "database_connection=secret" }),
    }),
  );
  await page.goto("/dashboard/tasks");

  await expect(page.getByText("Tasks could not be loaded. Check your connection and try again.")).toBeVisible();
  await expect(page.getByText("database_connection=secret")).toBeHidden();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});
