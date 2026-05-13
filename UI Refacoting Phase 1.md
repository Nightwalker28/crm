You are working on Nightwalker28/crm.

RUN 1 GOAL:
Complete the routing and navigation migration cleanly.

This run must:
1. Create a proper canonical /dashboard/settings/* route structure.
2. Move admin/configuration pages into Settings.
3. Update sidebar navigation to use the final production routing scheme.
4. Add a Settings hub and Settings layout.
5. Update access guards and breadcrumbs.
6. Add shared route constants and friendly label helpers.
7. Replace all old route links.
8. Use temporary redirects only during migration.
9. Before finishing, remove old legacy route files completely after all links are updated and tests/build pass.
10. Leave no unused redirect files, duplicated page implementations, or dead route code.

Hard rules:
- Do not change backend files.
- Do not change API contracts.
- Do not change database/migrations.
- Do not rename backend module keys.
- Do not change permission behavior.
- Do not add new packages.
- Keep TypeScript clean.
- Keep the existing dark/neutral Lynk UI style.