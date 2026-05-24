class __Module__(Base):
    __tablename__ = "__table__"
    __table_args__ = (
        Index("ix___table___active_tenant", "tenant_id", postgresql_where=text("deleted_at IS NULL")),
        Index("ix___table___tenant_name_active", "tenant_id", "name", postgresql_where=text("deleted_at IS NULL")),
    )

    __id_field__ = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    status = Column(Text, nullable=False, server_default="active")
    assigned_to = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_time = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    deleted_at = Column(TIMESTAMP(timezone=True), nullable=True)
    search_doc = Column(
        Text,
        Computed(
            "lower(coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(status, ''))",
            persisted=True,
        ),
        nullable=True,
    )

    assigned_user = relationship("User", foreign_keys=[assigned_to], lazy="joined")

    @property
    def custom_data(self) -> dict | None:
        return _get_custom_field_cache(self)

    @custom_data.setter
    def custom_data(self, value: dict | None) -> None:
        _set_custom_field_cache(self, value)

    @property
    def custom_fields(self) -> dict | None:
        return self.custom_data

    @custom_fields.setter
    def custom_fields(self, value: dict | None) -> None:
        self.custom_data = value
