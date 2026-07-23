# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: module-builder-revamp.spec.ts >> adds a field in the inspector and exposes shared builder destinations
- Location: tests/e2e/module-builder-revamp.spec.ts:145:5

# Error details

```
Error: Admin MFA is enabled. Set E2E_ADMIN_MFA_CODE or E2E_ADMIN_RECOVERY_CODE to run authenticated browser tests.
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - generic:
      - generic:
        - generic:
          - generic:
            - generic: Lynk
        - generic:
          - paragraph: Loading
    - generic [ref=e3]:
      - region "Notifications alt+T"
      - main [ref=e4]:
        - generic [ref=e281]:
          - heading "Lynk" [level=1] [ref=e282]
          - paragraph [ref=e283]: Sign in with your provisioned account.
          - generic [ref=e284]:
            - generic [ref=e285]: Enter your authenticator code or one recovery code to finish signing in.
            - generic [ref=e286]:
              - generic [ref=e287]: Authenticator Code
              - textbox "Authenticator Code" [ref=e288]
            - generic [ref=e289]:
              - generic [ref=e290]: Recovery Code
              - textbox "Recovery Code" [ref=e291]
            - button "Verify MFA" [disabled] [ref=e292]
  - button "Open Next.js Dev Tools" [ref=e298] [cursor=pointer]:
    - img [ref=e299]
  - alert [ref=e302]
```

# Test source

```ts
  1  | import { expect, type Page } from "@playwright/test";
  2  | 
  3  | const adminEmail = process.env.INITIAL_ADMIN_EMAIL;
  4  | const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;
  5  | const adminMfaCode = process.env.E2E_ADMIN_MFA_CODE;
  6  | const adminRecoveryCode = process.env.E2E_ADMIN_RECOVERY_CODE;
  7  | 
  8  | export async function loginAsAdmin(page: Page) {
  9  |   if (!adminEmail || !adminPassword) {
  10 |     throw new Error("INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD must be set for e2e tests.");
  11 |   }
  12 | 
  13 |   await page.goto("/auth/login");
  14 |   await expect(page.getByRole("button", { name: "Sign in with email" })).toBeVisible();
  15 | 
  16 |   await page.getByLabel("Email").fill(adminEmail);
  17 |   await page.getByLabel("Password").fill(adminPassword);
  18 |   await page.getByRole("button", { name: "Sign in with email" }).click();
  19 | 
  20 |   const authenticatorInput = page.getByLabel("Authenticator Code");
  21 |   await expect
  22 |     .poll(
  23 |       async () => page.url().endsWith("/dashboard") || await authenticatorInput.isVisible().catch(() => false),
  24 |       { message: "Expected login to reach the dashboard or MFA challenge.", timeout: 20_000 },
  25 |     )
  26 |     .toBeTruthy();
  27 | 
  28 |   if (await authenticatorInput.isVisible().catch(() => false)) {
  29 |     if (adminMfaCode) {
  30 |       await authenticatorInput.fill(adminMfaCode);
  31 |     } else if (adminRecoveryCode) {
  32 |       await page.getByLabel("Recovery Code").fill(adminRecoveryCode);
  33 |     } else {
> 34 |       throw new Error("Admin MFA is enabled. Set E2E_ADMIN_MFA_CODE or E2E_ADMIN_RECOVERY_CODE to run authenticated browser tests.");
     |             ^ Error: Admin MFA is enabled. Set E2E_ADMIN_MFA_CODE or E2E_ADMIN_RECOVERY_CODE to run authenticated browser tests.
  35 |     }
  36 |     await page.getByRole("button", { name: "Verify MFA" }).click();
  37 |   }
  38 | 
  39 |   await page.waitForURL("**/dashboard");
  40 |   await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  41 | }
  42 | 
```