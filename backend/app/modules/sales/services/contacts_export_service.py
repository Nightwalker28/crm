from __future__ import annotations

from typing import Iterable

from app.modules.sales.models import SalesContact
from app.modules.sales.services import contacts_services


def export_contacts_to_csv(contacts: Iterable[SalesContact], field_keys: list[str] | None = None) -> bytes:
    return contacts_services.export_contacts_to_csv(contacts, field_keys=field_keys)
