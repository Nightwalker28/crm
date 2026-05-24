class __Module__Base(BaseModel):
    name: str
    description: str | None = None
    status: str = "active"
    custom_fields: dict[str, Any] | None = None


class __Module__CreateRequest(__Module__Base):
    assigned_to: int | None = None


class __Module__UpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None
    assigned_to: int | None = None
    custom_fields: dict[str, Any] | None = None


class __Module__Response(__Module__Base):
    __id_field__: int
    assigned_to: int | None = None
    created_time: datetime
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class __Module__ListItem(BaseModel):
    __id_field__: int
    name: str | None = None
    description: str | None = None
    status: str | None = None
    assigned_to: int | None = None
    created_time: datetime | None = None
    custom_fields: dict[str, Any] | None = None


class __Module__ListResponse(BaseModel):
    results: list[__Module__ListItem]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int
