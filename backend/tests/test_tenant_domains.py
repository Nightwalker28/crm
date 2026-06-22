import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.platform.models import ActivityLog
from app.modules.user_management.models import Tenant, TenantDomain
from app.modules.user_management.services import tenant_domains


class TenantDomainServiceTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(bind=engine, tables=[Tenant.__table__, TenantDomain.__table__, ActivityLog.__table__])
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all([Tenant(id=1, slug="default", name="Default"), Tenant(id=2, slug="other", name="Other")])
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_create_tenant_domain_normalizes_and_generates_verification_record(self):
        with patch.object(tenant_domains, "invalidate_tenant_context_cache") as invalidate:
            domain = tenant_domains.create_tenant_domain(
                self.db,
                tenant_id=1,
                actor_user_id=7,
                hostname="HTTPS://CRM.Example.com/path",
                is_primary=True,
            )

        self.assertEqual(domain.hostname, "crm.example.com")
        self.assertEqual(domain.status, "pending")
        self.assertTrue(domain.verification_token.startswith("lynk-domain-verification="))
        self.assertTrue(domain.is_primary)
        self.assertEqual(self.db.query(ActivityLog).filter(ActivityLog.action == "tenant_domain.created").count(), 1)
        invalidate.assert_called_once_with("crm.example.com")

    def test_create_tenant_domain_rejects_cross_tenant_duplicate(self):
        self.db.add(TenantDomain(tenant_id=2, hostname="crm.example.com", status="verified"))
        self.db.commit()

        with self.assertRaises(HTTPException) as ctx:
            tenant_domains.create_tenant_domain(self.db, tenant_id=1, actor_user_id=7, hostname="crm.example.com")

        self.assertEqual(ctx.exception.status_code, 409)

    @patch("app.modules.user_management.services.tenant_domains._verify_dns", return_value={"verified": True, "message": "ok"})
    def test_verify_tenant_domain_marks_verified(self, _verify):
        domain = tenant_domains.create_tenant_domain(self.db, tenant_id=1, actor_user_id=7, hostname="crm.example.com")

        with patch.object(tenant_domains, "invalidate_tenant_context_cache") as invalidate:
            verified = tenant_domains.verify_tenant_domain(self.db, tenant_id=1, actor_user_id=7, domain_id=domain.id)

        self.assertEqual(verified.status, "verified")
        self.assertIsNotNone(verified.verified_at)
        self.assertEqual(self.db.query(ActivityLog).filter(ActivityLog.action == "tenant_domain.verified").count(), 1)
        invalidate.assert_called_once_with("crm.example.com")

    def test_delete_tenant_domain_invalidates_tenant_context_cache(self):
        domain = tenant_domains.create_tenant_domain(self.db, tenant_id=1, actor_user_id=7, hostname="crm.example.com")

        with patch.object(tenant_domains, "invalidate_tenant_context_cache") as invalidate:
            tenant_domains.delete_tenant_domain(self.db, tenant_id=1, actor_user_id=7, domain_id=domain.id)

        self.assertIsNone(self.db.query(TenantDomain).filter(TenantDomain.id == domain.id).first())
        invalidate.assert_called_once_with("crm.example.com")

    def test_verification_txt_record_uses_account_domain(self):
        domain = tenant_domains.create_tenant_domain(self.db, tenant_id=1, actor_user_id=7, hostname="lynk.maadmustafa.dev")

        payload = tenant_domains.serialize_tenant_domain(domain)

        self.assertEqual(payload["txt_record_name"], "maadmustafa.dev")
        self.assertTrue(payload["txt_record_value"].startswith("lynk-domain-verification="))
        self.assertNotIn("cname_target", payload)

    @patch("app.modules.user_management.services.tenant_domains._lookup_txt")
    def test_verify_dns_requires_txt_at_account_domain(self, lookup_txt):
        lookup_txt.return_value = {"lynk-domain-verification=token"}

        result = tenant_domains._verify_dns("lynk.maadmustafa.dev", "lynk-domain-verification=token")

        self.assertTrue(result["verified"])
        self.assertEqual(result["txt_host"], "maadmustafa.dev")
        lookup_txt.assert_called_once()
        self.assertEqual(lookup_txt.call_args.args[0], "maadmustafa.dev")

    def test_tenant_domain_email_domains_use_verified_custom_domains(self):
        self.db.add_all(
            [
                TenantDomain(tenant_id=1, hostname="crm.example.com", status="verified"),
                TenantDomain(tenant_id=1, hostname="portal.example.com", status="verified"),
                TenantDomain(tenant_id=1, hostname="crm.pending.com", status="pending"),
                TenantDomain(tenant_id=1, hostname="crm.example.co.uk", status="verified"),
                TenantDomain(tenant_id=1, hostname="deep.crm.example.com", status="verified"),
            ]
        )
        self.db.commit()

        self.assertEqual(tenant_domains.tenant_domain_email_domains(self.db, tenant_id=1), ["example.co.uk", "example.com"])


if __name__ == "__main__":
    unittest.main()
