# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: leads-revamp.spec.ts >> Leads routed workflow exposes create, detail, edit, conversion, and deep-linked tabs
- Location: tests/e2e/leads-revamp.spec.ts:83:5

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
  21 |   await expect.poll(async () => page.url().endsWith("/dashboard") || await authenticatorInput.isVisible().catch(() => false)).toBeTruthy();
  22 | 
  23 |   if (await authenticatorInput.isVisible().catch(() => false)) {
  24 |     if (adminMfaCode) {
  25 |       await authenticatorInput.fill(adminMfaCode);
  26 |     } else if (adminRecoveryCode) {
  27 |       await page.getByLabel("Recovery Code").fill(adminRecoveryCode);
  28 |     } else {
> 29 |       throw new Error("Admin MFA is enabled. Set E2E_ADMIN_MFA_CODE or E2E_ADMIN_RECOVERY_CODE to run authenticated browser tests.");
     |             ^ Error: Admin MFA is enabled. Set E2E_ADMIN_MFA_CODE or E2E_ADMIN_RECOVERY_CODE to run authenticated browser tests.
  30 |     }
  31 |     await page.getByRole("button", { name: "Verify MFA" }).click();
  32 |   }
  33 | 
  34 |   await page.waitForURL("**/dashboard");
  35 |   await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  36 | }
  37 | 
```