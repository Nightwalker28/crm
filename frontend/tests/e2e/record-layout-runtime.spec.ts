import { expect, test } from "@playwright/test";

const quickCreateLayout = {
  layout_id: null,
  module_key: "sales_leads",
  surface: "quick_create",
  name: "Lead Quick Create",
  source: "system",
  version: 1,
  can_customize: false,
  warnings: [],
  sections: [
    {
      id: "identity",
      label: "Identity",
      position: 0,
      region: "main",
      collapsed_by_default: false,
      fields: [
        { field_key: "last_name", label: "Last name", field_type: "text", field_source: "system", position: 0, width: "half", visible: true, required: false, readonly: false },
        { field_key: "first_name", label: "First name", field_type: "text", field_source: "system", position: 1, width: "half", visible: true, required: false, readonly: false },
        { field_key: "title", label: "Job title", field_type: "text", field_source: "system", position: 2, width: "full", visible: false, required: false, readonly: false },
        { field_key: "primary_email", label: "Email", field_type: "email", field_source: "system", position: 3, width: "full", visible: true, required: true, readonly: false },
        { field_key: "custom:renewal_tier", label: "Renewal tier", field_type: "text", field_source: "custom_field", position: 4, width: "full", visible: true, required: true, readonly: false, help_text: "Workspace qualification tier." },
      ],
    },
    {
      id: "qualification",
      label: "Qualification",
      position: 1,
      region: "main",
      collapsed_by_default: true,
      fields: [
        { field_key: "status", label: "Status", field_type: "select", field_source: "system", position: 0, width: "half", visible: true, required: false, readonly: false },
        { field_key: "assigned_to", label: "Owner", field_type: "user_reference", field_source: "system", position: 1, width: "half", visible: true, required: true, readonly: false },
        { field_key: "tags", label: "Tags", field_type: "tags", field_source: "system", position: 2, width: "full", visible: true, required: true, readonly: false },
      ],
    },
  ],
};

const detailLayout = {
  ...quickCreateLayout,
  surface: "detail",
  name: "Lead Details",
  sections: [
    {
      id: "details",
      label: "Details",
      position: 0,
      region: "main",
      collapsed_by_default: false,
      fields: [
        { field_key: "company", label: "Company", field_type: "text", field_source: "system", position: 0, width: "half", visible: true, required: false, readonly: true },
        { field_key: "primary_email", label: "Email", field_type: "email", field_source: "system", position: 1, width: "half", visible: true, required: true, readonly: true },
        { field_key: "phone", label: "Phone", field_type: "phone", field_source: "system", position: 2, width: "half", visible: false, required: false, readonly: true },
        { field_key: "tags", label: "Tags", field_type: "tags", field_source: "system", position: 3, width: "full", visible: true, required: false, readonly: true },
      ],
    },
    {
      id: "configured",
      label: "Configured details",
      position: 1,
      region: "sidebar",
      collapsed_by_default: true,
      fields: [
        { field_key: "custom:renewal_tier", label: "Renewal tier", field_type: "text", field_source: "custom_field", position: 0, width: "full", visible: true, required: false, readonly: true },
      ],
    },
  ],
};

test("resolved Quick Create metadata controls order, visibility, collapse, width, validation, and custom values", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/record-layouts/sales_leads/quick_create/resolved", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(quickCreateLayout) }),
  );
  await page.route("**/record-layouts/sales_leads/detail/resolved", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detailLayout) }),
  );
  await page.route("**/linked-record-options/users?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [{ id: 7, label: "Ada Owner", email: "ada@example.test" }] }),
    }),
  );

  await page.goto("/e2e/record-layout");
  await expect.poll(() => pageErrors).toEqual([]);

  const detailsProof = page.locator("section[aria-label='Resolved Lead Details proof']");
  const detailFields = detailsProof.locator("[data-layout-section='details'] [data-layout-field]");
  await expect(detailFields.nth(0)).toHaveAttribute("data-layout-field", "company");
  await expect(detailFields.nth(1)).toHaveAttribute("data-layout-field", "primary_email");
  await expect(detailsProof.locator("[data-layout-field='phone']")).toHaveCount(0);
  await expect(detailsProof.getByText("Lynk QA", { exact: true })).toBeVisible();
  await expect(detailsProof.locator("[data-layout-section='configured']")).toHaveAttribute("data-layout-region", "sidebar");
  const mainSection = detailsProof.locator("[data-layout-section='details']");
  const sidebarSection = detailsProof.locator("[data-layout-section='configured']");
  const desktopMainBox = await mainSection.boundingBox();
  const desktopSidebarBox = await sidebarSection.boundingBox();
  expect(desktopSidebarBox?.x).toBeGreaterThan((desktopMainBox?.x ?? 0) + (desktopMainBox?.width ?? 0) - 2);
  await detailsProof.locator("[data-layout-section='configured'] summary").click();
  await expect(detailsProof.getByText("Renewal tier", { exact: true })).toBeVisible();
  await expect(detailsProof.getByText("Gold", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 500, height: 800 });
  const mobileMainBox = await mainSection.boundingBox();
  const mobileSidebarBox = await sidebarSection.boundingBox();
  expect(mobileSidebarBox?.y).toBeGreaterThan((mobileMainBox?.y ?? 0) + (mobileMainBox?.height ?? 0) - 2);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByRole("button", { name: "Open resolved Lead Quick Create" }).click();

  const fields = page.locator("[data-layout-section='identity'] [data-layout-field]");
  await expect(fields).toHaveCount(4);
  await expect(fields.nth(0)).toHaveAttribute("data-layout-field", "last_name");
  await expect(fields.nth(1)).toHaveAttribute("data-layout-field", "first_name");
  await expect(fields.nth(2)).toHaveAttribute("data-layout-field", "primary_email");
  await expect(fields.nth(2)).toHaveAttribute("data-layout-width", "full");
  await expect(page.getByLabel("Job title")).toHaveCount(0);
  await expect(page.getByText("Workspace qualification tier.")).toBeVisible();

  const qualification = page.locator("[data-layout-section='qualification'] details");
  await expect(qualification).not.toHaveAttribute("open", "");
  await qualification.locator("summary").click();
  await expect(page.getByLabel("Status")).toBeVisible();

  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Email is required.").first()).toBeVisible();
  const emailInput = page.getByLabel("Email");
  await expect(emailInput).toBeFocused();
  await expect(emailInput).toHaveAttribute("aria-invalid", "true");
  const emailErrorId = await emailInput.getAttribute("aria-describedby");
  expect(emailErrorId).toBeTruthy();
  await expect(page.locator(`#${emailErrorId}`)).toHaveText("Email is required.");

  await page.getByLabel("Last name").fill("Fixture");
  await page.getByLabel("Email").fill("layout.fixture@example.test");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByTestId("last-layout-payload")).toHaveText("none");
  await expect(page.getByLabel("Renewal tier")).toBeFocused();

  await page.getByLabel("Renewal tier").fill("Gold");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(qualification).toHaveAttribute("open", "");
  const ownerPicker = page.getByLabel("Owner");
  await expect(ownerPicker).toBeFocused();
  await ownerPicker.fill("Ada");
  await page.getByRole("option", { name: "Ada Owner" }).click();

  await page.getByRole("button", { name: "Create", exact: true }).click();
  const tagsInput = page.getByLabel("Tags");
  await expect(tagsInput).toBeFocused();
  await expect(tagsInput).toHaveAttribute("aria-invalid", "true");
  const tagsErrorId = await tagsInput.getAttribute("aria-describedby");
  expect(tagsErrorId).toBeTruthy();
  await expect(page.locator(`#${tagsErrorId}`)).toHaveText("Tags is required.");
  await tagsInput.fill("priority");
  await tagsInput.press("Enter");

  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByTestId("last-layout-payload")).toContainText('"last_name":"Fixture"');
  await expect(page.getByTestId("last-layout-payload")).toContainText('"renewal_tier":"Gold"');
  await expect(page.getByTestId("last-layout-payload")).toContainText('"assigned_to":7');
  await expect(page.getByTestId("last-layout-payload")).toContainText('"tags":["priority"]');

});
