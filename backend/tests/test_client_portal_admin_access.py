"""Client-portal admin routes clear the client_portal module's access layers (13a B1)."""

import inspect
import unittest

from fastapi.params import Depends

from app.modules.client_portal.routes import client_portal_routes as routes

ADMIN_ROUTES = {
    "get_client_accounts": "view",
    "get_client_accounts_cursor": "view",
    "create_client_account_route": "create",
    "regenerate_client_setup_link_route": "edit",
    "update_client_account_status_route": "edit",
    "get_client_pages": "view",
    "get_client_pages_cursor": "view",
    "create_client_page_route": "create",
    "update_client_page_route": "edit",
    "publish_client_page_link_route": "edit",
}


def _closure_values(dependency) -> set:
    return {cell.cell_contents for cell in (getattr(dependency, "__closure__", None) or ())}


class ClientPortalAdminAccessTests(unittest.TestCase):
    def test_every_admin_route_checks_the_client_portal_module_and_action(self):
        for name, action in ADMIN_ROUTES.items():
            with self.subTest(route=name):
                params = inspect.signature(getattr(routes, name)).parameters.values()
                closures = [_closure_values(param.default.dependency) for param in params if isinstance(param.default, Depends)]
                # require_module_access closes over the key; require_action_access over key and action.
                self.assertIn({"client_portal"}, closures)
                self.assertIn({"client_portal", action}, closures)


if __name__ == "__main__":
    unittest.main()
