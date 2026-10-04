"""E1 of docs/crm-evolution/12-erp-inventory.md: products and services, first class.

Covers line-item catalog links on quotes, orders and invoices (tenant integrity and the
new-link permission rule), categories, the new product and service fields, the line-item
picker search, and each item's sales list.
"""

import unittest
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog import models as catalog_models  # noqa: F401
from app.modules.catalog.models import CatalogCategory, CatalogProduct, CatalogService
from app.modules.catalog.services import category_services, item_services, line_links, product_services, service_services
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.finance.models import FinancePosInvoice
from app.modules.finance.services import pos_invoice_services
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.sales.models import SalesOrder
from app.modules.sales.services import quotes_services
from app.modules.sales.services.orders_services import convert_quote_to_order, create_sales_order, update_sales_order
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


def _no_custom_fields():
    return (
        patch.object(quotes_services, "validate_custom_field_payload", return_value={}),
        patch.object(quotes_services, "save_custom_field_values"),
        patch.object(quotes_services, "hydrate_custom_field_record", side_effect=lambda *args, **kwargs: kwargs["record"]),
    )


class CatalogFirstClassTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.user = SimpleNamespace(id=1, tenant_id=10)
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=99, slug="other", name="Other"),
                User(id=1, tenant_id=10, email="owner@example.com", first_name="Owner", last_name="User", is_active=UserStatus.active),
                CatalogProduct(id=1, tenant_id=10, name="Camera kit", sku="CAM-1", barcode="4006381333931", currency="USD", public_unit_price=Decimal("250"), unit="box"),
                CatalogProduct(id=2, tenant_id=10, name="Retired lens", sku="LENS-OLD", currency="USD", public_unit_price=Decimal("80"), is_active=0),
                CatalogProduct(id=3, tenant_id=10, name="Euro tripod", sku="TRI-EU", currency="EUR", public_unit_price=Decimal("40")),
                CatalogProduct(id=9, tenant_id=99, name="Other tenant camera", sku="CAM-1", currency="USD", public_unit_price=Decimal("1")),
                CatalogService(id=5, tenant_id=10, name="Camera installation", sku="SVC-INSTALL", currency="USD", public_unit_price=Decimal("120"), unit="hour"),
                CatalogService(id=8, tenant_id=99, name="Other tenant service", currency="USD", public_unit_price=Decimal("1")),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def _quote(self, items, **extra):
        a, b, c = _no_custom_fields()
        with a, b, c:
            return quotes_services.create_sales_quote(
                self.db,
                {"quote_number": extra.pop("quote_number", "Q-1"), "customer_name": "Acme", "currency": "USD", "items": items, **extra},
                self.user,
            )

    # Line-item links -----------------------------------------------------------------

    def test_quote_lines_keep_catalog_links_through_conversion_to_order(self):
        quote = self._quote(
            [
                {"name": "Camera kit", "quantity": "2", "unit_price": "250", "catalog_product_id": 1},
                {"name": "Installation", "quantity": "3", "unit_price": "120", "catalog_service_id": 5},
                {"name": "Custom mounting bracket", "quantity": "1", "unit_price": "45"},
            ]
        )
        self.assertEqual([(item.catalog_product_id, item.catalog_service_id) for item in quote.items], [(1, None), (None, 5), (None, None)])

        quote.status = "accepted"
        self.db.commit()
        order = convert_quote_to_order(self.db, quote, self.user)

        self.assertEqual([(item.catalog_product_id, item.catalog_service_id) for item in order.items], [(1, None), (None, 5), (None, None)])
        self.assertEqual([item.name for item in order.items], ["Camera kit", "Installation", "Custom mounting bracket"])

    def test_another_tenants_item_is_refused_on_quotes_orders_and_invoices(self):
        with self.assertRaises(HTTPException) as quote_error:
            self._quote([{"name": "Camera", "quantity": "1", "unit_price": "1", "catalog_product_id": 9}])
        self.assertEqual(quote_error.exception.status_code, 400)
        self.assertEqual(quote_error.exception.detail, "Line 1: product not found")

        with self.assertRaises(HTTPException) as order_error:
            create_sales_order(
                self.db,
                {"status": "confirmed", "items": [{"name": "Ok", "unit_price": "1"}, {"name": "Svc", "unit_price": "1", "catalog_service_id": 8}]},
                self.user,
            )
        self.assertEqual(order_error.exception.detail, "Line 2: service not found")

        invoice = FinancePosInvoice(tenant_id=10, invoice_number="INV-1", customer_name="Acme")
        invoice.lines = []
        with self.assertRaises(HTTPException) as invoice_error:
            pos_invoice_services._apply_lines(self.db, invoice, [{"description": "Camera", "quantity": 1, "unit_price": 1, "catalog_product_id": 9}])
        self.assertEqual(invoice_error.exception.detail, "Line 1: product not found")

    def test_invoice_lines_store_validated_links(self):
        invoice = FinancePosInvoice(tenant_id=10, invoice_number="INV-2", customer_name="Acme")
        invoice.lines = []
        pos_invoice_services._apply_lines(
            self.db,
            invoice,
            [
                {"description": "Camera kit", "quantity": 1, "unit_price": 250, "catalog_product_id": "1"},
                {"description": "Walk-in labour", "quantity": 1, "unit_price": 20},
            ],
        )
        self.assertEqual([(line.catalog_product_id, line.catalog_service_id) for line in invoice.lines], [(1, None), (None, None)])

    def test_a_line_links_to_one_catalog_item_at_most(self):
        with self.assertRaises(HTTPException) as error:
            self._quote([{"name": "Both", "quantity": "1", "unit_price": "1", "catalog_product_id": 1, "catalog_service_id": 5}])
        self.assertEqual(error.exception.status_code, 400)
        self.assertIn("not both", error.exception.detail)

    def test_retired_and_binned_items_stay_linkable_so_old_documents_still_save(self):
        product = self.db.get(CatalogProduct, 1)
        product_services.soft_delete_product(self.db, product=product, actor_user_id=None)
        quote = self._quote(
            [
                {"name": "Retired lens", "quantity": "1", "unit_price": "80", "catalog_product_id": 2},
                {"name": "Camera kit", "quantity": "1", "unit_price": "250", "catalog_product_id": 1},
            ]
        )
        self.assertEqual([item.catalog_product_id for item in quote.items], [2, 1])

    def test_order_update_revalidates_links(self):
        order = create_sales_order(self.db, {"status": "confirmed", "items": [{"name": "Camera kit", "unit_price": "250", "catalog_product_id": 1}]}, self.user)
        self.db.commit()  # the service flushes; the caller commits (13a E5)
        with self.assertRaises(HTTPException):
            update_sales_order(self.db, order, {"items": [{"name": "Camera", "unit_price": "1", "catalog_product_id": 9}]})
        self.db.rollback()
        updated = update_sales_order(self.db, self.db.get(SalesOrder, order.id), {"items": [{"name": "Installation", "unit_price": "120", "catalog_service_id": 5}]})
        self.assertEqual([(item.catalog_product_id, item.catalog_service_id) for item in updated.items], [(None, 5)])

    def test_only_new_links_need_catalog_view(self):
        denied = HTTPException(status_code=403, detail="You do not have access to the record you are trying to link.")
        with patch.object(line_links, "require_linked_record_access", side_effect=denied) as check:
            # Re-saving lines the document already had: no catalog permission needed.
            line_links.require_catalog_line_link_access(
                self.db,
                user=self.user,
                lines=[{"catalog_product_id": 1}, {"catalog_service_id": 5}, {}],
                existing_links={("catalog_product_id", 1), ("catalog_service_id", 5)},
            )
            check.assert_not_called()

            with self.assertRaises(HTTPException) as error:
                line_links.require_catalog_line_link_access(
                    self.db,
                    user=self.user,
                    lines=[{"catalog_product_id": 1}, {"catalog_service_id": 5}],
                    existing_links={("catalog_product_id", 1)},
                )
            self.assertEqual(error.exception.status_code, 403)
            check.assert_called_once_with(self.db, user=self.user, module_key="catalog_services")

    # Categories ----------------------------------------------------------------------

    def test_categories_nest_one_level_and_names_are_unique_per_level(self):
        cameras = category_services.create_category(self.db, tenant_id=10, actor_user_id=1, payload={"name": "Cameras"})
        mirrorless = category_services.create_category(self.db, tenant_id=10, actor_user_id=1, payload={"name": "Mirrorless", "parent_id": cameras["id"]})
        self.assertEqual(mirrorless["full_name"], "Cameras / Mirrorless")

        with self.assertRaises(HTTPException) as too_deep:
            category_services.create_category(self.db, tenant_id=10, actor_user_id=1, payload={"name": "Full frame", "parent_id": mirrorless["id"]})
        self.assertEqual(too_deep.exception.status_code, 400)

        with self.assertRaises(HTTPException) as duplicate:
            category_services.create_category(self.db, tenant_id=10, actor_user_id=1, payload={"name": "cameras"})
        self.assertEqual(duplicate.exception.status_code, 409)

        # The same name under a different parent is fine, and another tenant has its own names.
        category_services.create_category(self.db, tenant_id=10, actor_user_id=1, payload={"name": "Accessories", "parent_id": cameras["id"]})
        category_services.create_category(self.db, tenant_id=99, actor_user_id=None, payload={"name": "Cameras"})

        listed = category_services.list_categories(self.db, tenant_id=10)
        self.assertEqual([row["full_name"] for row in listed], ["Cameras", "Cameras / Accessories", "Cameras / Mirrorless"])

    def test_category_parent_must_be_in_the_tenant_and_a_parent_cannot_become_a_child(self):
        other = category_services.create_category(self.db, tenant_id=99, actor_user_id=None, payload={"name": "Other"})
        with self.assertRaises(HTTPException) as foreign_parent:
            category_services.create_category(self.db, tenant_id=10, actor_user_id=1, payload={"name": "Cameras", "parent_id": other["id"]})
        self.assertEqual(foreign_parent.exception.detail, "Parent category not found.")

        cameras = category_services.create_category(self.db, tenant_id=10, actor_user_id=1, payload={"name": "Cameras"})
        lenses = category_services.create_category(self.db, tenant_id=10, actor_user_id=1, payload={"name": "Lenses"})
        category_services.create_category(self.db, tenant_id=10, actor_user_id=1, payload={"name": "Zoom", "parent_id": lenses["id"]})
        lens_row = category_services.get_category_or_404(self.db, tenant_id=10, category_id=lenses["id"])
        with self.assertRaises(HTTPException):
            category_services.update_category(self.db, category=lens_row, actor_user_id=1, payload={"name": "Lenses", "parent_id": cameras["id"]})
        with self.assertRaises(HTTPException):
            category_services.get_category_or_404(self.db, tenant_id=10, category_id=other["id"])

    def test_category_in_use_or_with_children_cannot_be_deleted(self):
        cameras = category_services.create_category(self.db, tenant_id=10, actor_user_id=1, payload={"name": "Cameras"})
        child = category_services.create_category(self.db, tenant_id=10, actor_user_id=1, payload={"name": "Mirrorless", "parent_id": cameras["id"]})
        product = product_services.create_product(
            self.db, tenant_id=10, actor_user_id=1, payload={"name": "Body", "public_unit_price": "1", "category_id": child["id"]}
        )

        parent_row = category_services.get_category_or_404(self.db, tenant_id=10, category_id=cameras["id"])
        with self.assertRaises(HTTPException) as has_children:
            category_services.delete_category(self.db, category=parent_row, actor_user_id=1)
        self.assertEqual(has_children.exception.status_code, 409)

        # A product in the recycle bin still holds its category.
        product_services.soft_delete_product(self.db, product=product, actor_user_id=1)
        child_row = category_services.get_category_or_404(self.db, tenant_id=10, category_id=child["id"])
        with self.assertRaises(HTTPException) as in_use:
            category_services.delete_category(self.db, category=child_row, actor_user_id=1)
        self.assertIn("recycle bin", in_use.exception.detail)

        product_services.update_product(self.db, product=product, actor_user_id=1, payload={"category_id": None})
        category_services.delete_category(self.db, category=child_row, actor_user_id=1)
        category_services.delete_category(self.db, category=parent_row, actor_user_id=1)
        self.assertEqual(category_services.list_categories(self.db, tenant_id=10), [])

    # Product and service fields ------------------------------------------------------

    def test_products_and_services_carry_category_cost_unit_and_codes(self):
        cameras = category_services.create_category(self.db, tenant_id=10, actor_user_id=1, payload={"name": "Cameras"})
        product = product_services.create_product(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"name": "Body", "public_unit_price": "900", "cost_price": "610.50", "unit": "  piece ", "barcode": " 0123 ", "category_id": cameras["id"]},
        )
        serialized = product_services.serialize_product(product)
        self.assertEqual(serialized["category_name"], "Cameras")
        self.assertEqual(serialized["cost_price"], Decimal("610.50"))
        self.assertEqual(serialized["unit"], "piece")
        self.assertEqual(serialized["barcode"], "0123")

        service = service_services.create_service(
            self.db, tenant_id=10, actor_user_id=1, payload={"name": "Calibration", "public_unit_price": "60", "sku": "SVC-CAL", "unit": "hour"}
        )
        self.assertEqual(service_services.serialize_service(service)["sku"], "SVC-CAL")
        self.assertEqual(service_services.serialize_service(service)["unit"], "hour")

        # A partial update leaves omitted fields alone and can clear the optional ones.
        product_services.update_product(self.db, product=product, actor_user_id=1, payload={"cost_price": None})
        self.assertIsNone(product.cost_price)
        self.assertEqual(product.unit, "piece")
        self.assertEqual(product.category_id, cameras["id"])

    def test_product_field_validation(self):
        other_category = category_services.create_category(self.db, tenant_id=99, actor_user_id=None, payload={"name": "Foreign"})
        cases = [
            ({"category_id": other_category["id"]}, "Category not found"),
            ({"cost_price": "-1"}, "cost_price must be non-negative"),
            ({"unit": "   "}, "unit cannot be blank"),
        ]
        for extra, detail in cases:
            with self.subTest(extra=extra), self.assertRaises(HTTPException) as error:
                product_services.create_product(self.db, tenant_id=10, actor_user_id=1, payload={"name": "X", "public_unit_price": "1", **extra})
            self.assertEqual(error.exception.status_code, 400)
            self.assertEqual(error.exception.detail, detail)

    def test_barcode_and_service_sku_are_unique_among_active_items(self):
        with self.assertRaises(HTTPException) as barcode:
            product_services.create_product(self.db, tenant_id=10, actor_user_id=1, payload={"name": "Barcode copy", "public_unit_price": "1", "barcode": "4006381333931"})
        self.assertEqual(barcode.exception.status_code, 409)
        self.db.rollback()

        with self.assertRaises(HTTPException) as sku:
            service_services.create_service(self.db, tenant_id=10, actor_user_id=1, payload={"name": "SKU copy", "public_unit_price": "1", "sku": "SVC-INSTALL"})
        self.assertEqual(sku.exception.status_code, 409)
        self.db.rollback()

        # Another tenant may reuse both.
        product_services.create_product(self.db, tenant_id=99, actor_user_id=None, payload={"name": "Barcode copy", "public_unit_price": "1", "barcode": "4006381333931"})
        service_services.create_service(self.db, tenant_id=99, actor_user_id=None, payload={"name": "SKU copy", "public_unit_price": "1", "sku": "SVC-INSTALL"})

    def test_product_list_searches_barcode_and_filters_by_category(self):
        cameras = category_services.create_category(self.db, tenant_id=10, actor_user_id=1, payload={"name": "Cameras"})
        product_services.update_product(self.db, product=self.db.get(CatalogProduct, 1), actor_user_id=1, payload={"category_id": cameras["id"]})

        by_barcode, _ = product_services.list_products(self.db, tenant_id=10, search="4006381333931")
        self.assertEqual([row.id for row in by_barcode], [1])
        by_category, total = product_services.list_products(
            self.db, tenant_id=10, all_filter_conditions=[{"field": "category_name", "operator": "is", "value": "Cameras"}]
        )
        self.assertEqual((total, [row.id for row in by_category]), (1, [1]))

    # Picker search -------------------------------------------------------------------

    def test_picker_search_is_tenant_scoped_active_only_and_currency_aware(self):
        everything = item_services.search_catalog_items(
            self.db, tenant_id=10, query="", currency=None, include_products=True, include_services=True
        )
        self.assertEqual({(row["kind"], row["id"]) for row in everything}, {("product", 1), ("product", 3), ("service", 5)})

        usd = item_services.search_catalog_items(self.db, tenant_id=10, query="", currency="USD", include_products=True, include_services=True)
        self.assertEqual({(row["kind"], row["id"]) for row in usd}, {("product", 1), ("service", 5)})

        products_only = item_services.search_catalog_items(self.db, tenant_id=10, query="cam", currency=None, include_products=True, include_services=False)
        self.assertEqual([(row["kind"], row["id"]) for row in products_only], [("product", 1)])

        option = products_only[0]
        self.assertEqual((option["unit"], option["unit_price"], option["sku"]), ("box", Decimal("250.0000"), "CAM-1"))

    def test_picker_finds_an_exact_barcode_and_puts_exact_codes_first(self):
        scanned = item_services.search_catalog_items(self.db, tenant_id=10, query="4006381333931", currency=None, include_products=True, include_services=True)
        self.assertEqual([(row["kind"], row["id"]) for row in scanned], [("product", 1)])

        self.db.add(CatalogProduct(id=4, tenant_id=10, name="A svc-install manual", currency="USD", public_unit_price=Decimal("5")))
        self.db.commit()
        by_code = item_services.search_catalog_items(self.db, tenant_id=10, query="SVC-INSTALL", currency=None, include_products=True, include_services=True)
        self.assertEqual((by_code[0]["kind"], by_code[0]["id"]), ("service", 5))

    # Sales list on the record --------------------------------------------------------

    def test_item_sales_lists_quote_and_order_lines_for_that_item_only(self):
        self._quote([{"name": "Camera kit", "quantity": "2", "unit_price": "250", "catalog_product_id": 1}], quote_number="Q-A")
        self._quote([{"name": "Installation", "quantity": "1", "unit_price": "120", "catalog_service_id": 5}], quote_number="Q-B")
        create_sales_order(self.db, {"status": "confirmed", "items": [{"name": "Camera kit", "quantity": "3", "unit_price": "250", "catalog_product_id": 1}]}, self.user)
        create_sales_order(self.db, {"status": "cancelled", "items": [{"name": "Camera kit", "quantity": "7", "unit_price": "250", "catalog_product_id": 1}]}, self.user)

        sales = item_services.list_catalog_item_sales(self.db, tenant_id=10, kind="product", item_id=1, include_quotes=True, include_orders=True)
        self.assertEqual((sales["quote_line_count"], sales["order_line_count"]), (1, 2))
        self.assertEqual(sales["ordered_quantity"], Decimal("3"))
        self.assertEqual(sorted(line["document_type"] for line in sales["results"]), ["order", "order", "quote"])

        orders_hidden = item_services.list_catalog_item_sales(self.db, tenant_id=10, kind="product", item_id=1, include_quotes=True, include_orders=False)
        self.assertEqual([line["document_type"] for line in orders_hidden["results"]], ["quote"])
        self.assertEqual(orders_hidden["ordered_quantity"], Decimal("0"))

        other_tenant = item_services.list_catalog_item_sales(self.db, tenant_id=99, kind="product", item_id=1, include_quotes=True, include_orders=True)
        self.assertEqual(other_tenant["results"], [])

        service_sales = item_services.list_catalog_item_sales(self.db, tenant_id=10, kind="service", item_id=5, include_quotes=True, include_orders=True)
        self.assertEqual([line["document_number"] for line in service_sales["results"]], ["Q-B"])


if __name__ == "__main__":
    unittest.main()
