"""Custom field values carried on a model instance for its response (13b §3.4).

Values are stored in `field_values`; a service loads them and sets `custom_fields` on the
instance so the response schema can read them. Nothing here touches the database.
"""

from __future__ import annotations


class CustomFieldsMixin:
    """Gives a model `custom_fields` (and the older name `custom_data`) as hydrated data."""

    @property
    def custom_data(self) -> dict | None:
        return getattr(self, "_custom_field_cache", None)

    @custom_data.setter
    def custom_data(self, value: dict | None) -> None:
        self._custom_field_cache = value or None

    @property
    def custom_fields(self) -> dict | None:
        return self.custom_data

    @custom_fields.setter
    def custom_fields(self, value: dict | None) -> None:
        self.custom_data = value
