// frontend/components/sidebar/Sidebar.tsx
function getCanonicalHref(module: AccessibleModule) {
  if (module.name === "__MODULE_KEY__") return DASHBOARD_ROUTES.__modules__;
  // ...
}
