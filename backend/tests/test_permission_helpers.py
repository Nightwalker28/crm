"""One permission helper outside route dependencies (13a B6)."""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.core import permissions
from app.core.access_control import PermissionPolicy


class PermissionHelperTests(unittest.TestCase):
    def setUp(self):
        self.user = SimpleNamespace(id=1, tenant_id=10)
        # module -> the actions the role has there; a module absent here is not available.
        self.grants = {"finance_pos": {"view"}, "inventory_deliveries": {"view", "create"}}

    def _patched(self):
        grants = self.grants
        return (
            patch.object(PermissionPolicy, "can_view_module", lambda self, module_key: module_key in grants),
            patch.object(PermissionPolicy, "can_perform_action", lambda self, module_key, action: action in grants.get(module_key, set())),
        )

    def test_can_checks_the_module_and_every_action(self):
        view, act = self._patched()
        with view, act:
            self.assertTrue(permissions.can_access(None, self.user, "finance_pos"))
            self.assertFalse(permissions.can_access(None, self.user, "finance_pos", "edit"))
            self.assertTrue(permissions.can_access(None, self.user, "inventory_deliveries", "view", "create"))
            self.assertFalse(permissions.can_access(None, self.user, "inventory_deliveries", "create", "edit"))
            self.assertFalse(permissions.can_access(None, self.user, "purchase_bills"))

    def test_require_raises_403_with_the_reason(self):
        view, act = self._patched()
        with view, act:
            permissions.require_access(None, self.user, "finance_pos", "view", detail="unused")
            with self.assertRaises(HTTPException) as raised:
                permissions.require_access(None, self.user, "finance_pos", "edit", detail="Issuing an invoice needs edit access to invoices")
        self.assertEqual(raised.exception.status_code, 403)
        self.assertEqual(raised.exception.detail, "Issuing an invoice needs edit access to invoices")

    def test_any_passes_on_one_grant(self):
        view, act = self._patched()
        with view, act:
            permissions.require_any_access(None, self.user, (("purchase_bills", "view"), ("finance_pos", "view")), detail="unused")
            with self.assertRaises(HTTPException):
                permissions.require_any_access(None, self.user, (("purchase_bills", "view"), ("finance_pos", "edit")), detail="No access")

    def test_no_route_keeps_its_own_permission_idiom(self):
        import pathlib
        import re

        root = pathlib.Path(__file__).resolve().parents[1] / "app"
        offenders = []
        for path in root.rglob("*.py"):
            text = path.read_text()
            if re.search(r"^def _(allowed|can|require)\(db", text, re.M) or re.search(r"can_view_module\([^)]*\)\s*\)?\s*and\s+\w*\.?can_perform_action", text):
                offenders.append(str(path.relative_to(root)))
        # PermissionPolicy.can itself is the one place the two layers are combined.
        self.assertEqual([path for path in offenders if path != "core/access_control.py"], [])


if __name__ == "__main__":
    unittest.main()
