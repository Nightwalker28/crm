Fix the Module Settings page and Settings sidebar.

Requirements:

1. Remove the secondary/internal Settings sidebar from the Settings page. Settings navigation should only exist in the main app sidebar.

2. Add Activity Log and Recycle Bin to the main sidebar under the Settings group. Recycle Bin can keep danger/red styling, but it should not live in a separate inner sidebar.

3. Remove stale/internal modules from front end, backend , the db and any refenrce to old or stale routes or codebases that do not exist anymore pls ( i dont mean remove the funtionality i mean remove the old refernces since these have been moved into new places right)
- WhatsApp
- Sales
- Website Integrations (this should only live inside the intigrations folder it doesnt need its own refenrce in the module settings page)
- Users
- Modules
- Settings

These are not real configurable user modules and should not appear in this page.

4. In the Module column, only show the module display name. Remove the small secondary text underneath that shows the original/sidebar group.

5. Change default sidebar group for Dashboard, Mail, Tasks, and Documents to None/null so they do not appear in the sidebar by default. Keep the dropdown functionality so users can manually assign them to Sales, Finance, Products & Services, Other, Settings, or custom groups later.

6. Remove these columns from the Module Settings table:
- Route
- Description
- Status
- Access

7. Remove the Access Settings button. Instead, make the entire module row clickable and navigate to that module’s access settings page.

8. Prevent row navigation when interacting with inputs, selects, dropdowns, or the enable/disable button by using event.stopPropagation().

9. Keep only these table columns:
- Module
- Sidebar Label
- Sidebar Group
- Duplicate Handling
- Enable / Disable

10. Rebuild the table using the same shared table/card structure used by the other Settings pages, so the styling and spacing match the rest of the CRM.

Also make sure stale modules are filtered both from the frontend render and from whatever sidebar/module registry source is generating this data, so they do not come back after refresh.