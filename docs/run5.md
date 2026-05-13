You are working on the `nightwalker/crm` repo.

Current requirements:

1. Fix search first — highest priority
Search is currently broken across the CRM.
This includes:
- module search
- linked record searches
- global search
- any search input used inside modules

Current bug:
- Search works when typing around 1–2 characters.
- When typing more than 2 characters, it behaves incorrectly and often returns “No results found”.
- Investigate the full search flow: frontend filtering, debounce logic, API calls, query params, minimum character conditions, normalization, and backend response handling if involved.
- Fix the root cause, not just one search box.
- Make sure search works reliably for partial terms longer than 2 characters.
- Search should be case-insensitive where appropriate.
- Search should not clear valid results incorrectly while typing.
- Keep loading / empty states clean and consistent.

2. Sidebar behavior cleanup
The sidebar is still messy and needs to behave more like a production CRM/ERP sidebar.

Change the sidebar from hover-based expand/collapse to click-based expand/collapse.

Requirements:
- Sidebar should NOT expand on hover.
- Add a clear collapse/expand button.
- Clicking the button should toggle collapsed/expanded state.
- The collapsed state should be wide enough to look clean, not cramped.
- In collapsed mode, still show the user profile picture/avatar.
- The profile/avatar should remain visually aligned and not look broken in collapsed mode.
- Sidebar state should feel stable and not distract the user when the mouse accidentally moves over it.

3. Sidebar items cleanup
Remove the following direct sidebar items:
- Dashboard
- Tasks
- Calendar
- Mail
- Documents

Behavior:
- Clicking the app logo / Lynk branding should open the Dashboard.
- Do not keep Dashboard as a normal sidebar menu item.
- Tasks, Calendar, Mail, and Documents should be accessible from the Dashboard instead.
- If the Dashboard does not already contain cards/links/shortcuts for Tasks, Calendar, Mail, and Documents, add them there.

4. Sidebar should only show module groups/tabs
The sidebar should mainly contain module tabs/groups such as:
- Sales
- Finance
- Settings
- Other existing module groups

Only modules should live inside these tabs.

Accordion behavior:
- Bring back/keep collapsible module tabs.
- Only one tab/group should be open at a time.
- Example: if Sales is open and the user opens Finance, Sales should automatically close.
- If Settings is opened, Sales/Finance/etc. should close.
- Make this behavior clean and predictable.

5. Do not rename Delete
Do NOT change “Delete” wording to “Move to Trash”.

Current intended behavior:
- Normal users should only see a “Delete” action/button.
- Admins may see/access a Recycle Bin feature.
- The wording “Delete” is intentional.
- Keep all delete buttons/actions labeled as “Delete”.

6. Keep Account and Contact areas for now
Do not remove or heavily rework Account and Contact sections right now.
The structure is not finalized yet and will be workshopped later.
Only make changes if required to keep the sidebar/module grouping clean.

7. Keep Dashboard catalog idea for later
Do not remove or deeply redesign any dashboard catalog/module catalog concept unless it is directly causing UI issues.
This will be workshopped later.

8. Remove “Custom Modules” section from sidebar
There should no longer be a separate sidebar section called “Custom Modules”.

Instead:
- Custom modules should live under a selected module tab/group.
- Existing custom modules should be assigned to any sensible existing tab for now.
- This can be changed later once the tab assignment functionality is working.

9. Module Builder: assign module to tab
Update the Module Builder flow so that when a user creates a module, they can choose which sidebar tab/group the module should live under.

Requirements:
- Add a “Tab” or “Module Group” selection field during module creation/editing.
- Existing tabs should be available as options.
- Custom-created tabs should also appear as options.
- The selected tab controls where the module appears in the sidebar.
- This can be a client-facing mapping layer. You do not need to rename internal/backend module identifiers unless the app already supports it cleanly.
- Avoid breaking existing module routes or internal names.

10. Add simple tab builder functionality
Create a small client-facing tab/group management feature.

Users should be able to:
- Create a new sidebar tab/group.
- Rename an existing custom tab/group.
- Assign modules to tabs/groups.
- Rename the display name of a module if needed.

Important:
- This can be implemented as a mapping/display configuration layer.
- Internal module keys/routes can remain unchanged.
- The goal is to let users control the visible sidebar organization without breaking app internals.

11. Module rename/display rename
Allow users to rename the display label of a module.
This should not necessarily rename the internal module key or route.
Use a display-name mapping if that is safer.

Example:
- Internal module key: `custom_module_1`
- Display name shown in sidebar: `Suppliers`
- Route/internal behavior remains unchanged.

12. Existing custom modules
For the existing two custom modules:
- Move them out of the “Custom Modules” sidebar section.
- Assign them to any sensible existing tab/group for now.
- Make sure they still open/work correctly.
- Once tab assignment works, the user can move them later.

13. UX expectations
Keep the UI clean, consistent, and production-like.
Avoid messy spacing, inconsistent icons, and random sidebar behavior.

Make sure:
- Sidebar expanded and collapsed states both look polished.
- Module groups are visually clear.
- Active module/tab state is obvious.
- Dashboard shortcuts/cards are clear and easy to click.
- Empty states and search result states are consistent.

14. Do not add redirects
No need to create redirects for removed sidebar items.
This app is still being built and no users are actively using it.

15. Deliverables
After making changes, provide:
- A summary of files changed.
- A short explanation of the search bug root cause and how it was fixed.
- A short explanation of the new sidebar behavior.
- A short explanation of the module tab/module display-name mapping approach.
- Any manual testing steps needed.

Manual testing checklist:
- Search works with 1, 2, 3, 4+ characters.
- Search works in global search.
- Search works in module search.
- Search works in linked record search.
- Sidebar does not expand on hover.
- Sidebar expands/collapses only on click.
- Collapsed sidebar still shows user avatar.
- Logo/Lynk opens Dashboard.
- Dashboard, Tasks, Calendar, Mail, and Documents are no longer direct sidebar items.
- Dashboard contains links/cards for Tasks, Calendar, Mail, and Documents.
- Only one module tab is open at a time.
- Custom Modules sidebar section is removed.
- Existing custom modules appear under normal tabs.
- New module can be assigned to a tab.
- User can create a tab/group.
- User can rename a tab/group.
- User can change module display name.
- Delete buttons still say “Delete”.