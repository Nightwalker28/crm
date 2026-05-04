from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


class CustomerGroupCreateRequest(BaseModel):
    group_key: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    discount_type: str = Field(default="none", max_length=20)
    discount_value: Decimal | None = None
    is_default: bool = False
    is_active: bool = True


class CustomerGroupUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    discount_type: str | None = Field(default=None, max_length=20)
    discount_value: Decimal | None = None
    is_default: bool | None = None
    is_active: bool | None = None


class CustomerGroupResponse(BaseModel):
    id: int
    group_key: str
    name: str
    description: str | None = None
    discount_type: str
    discount_value: Decimal | None = None
    is_default: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CustomerGroupAssignmentRequest(BaseModel):
    customer_group_id: int | None = None


class ClientAccountCreateRequest(BaseModel):
    email: EmailStr
    contact_id: int | None = None
    organization_id: int | None = None
    status: str = Field(default="pending", max_length=20)

    @model_validator(mode="after")
    def validate_link(self):
        if bool(self.contact_id) == bool(self.organization_id):
            raise ValueError("Link the client account to exactly one contact or organization")
        return self


class ClientAccountStatusRequest(BaseModel):
    status: str = Field(max_length=20)


class ClientAccountResponse(BaseModel):
    id: int
    email: EmailStr
    status: str
    contact_id: int | None = None
    organization_id: int | None = None
    has_password: bool
    setup_link: str | None = None
    setup_token_expires_at: datetime | None = None
    last_login_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ClientSetupPasswordRequest(BaseModel):
    token: str = Field(min_length=16)
    password: str = Field(min_length=1)


class ClientLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class ClientLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    account: ClientAccountResponse


class ClientMeResponse(BaseModel):
    id: int
    email: EmailStr
    tenant_id: int
    contact_id: int | None = None
    organization_id: int | None = None
    customer_group: CustomerGroupResponse | None = None
