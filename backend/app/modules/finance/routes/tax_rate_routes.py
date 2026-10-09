"""Settings → Taxes (13d §3.1). Any signed-in user can read the rates, because every line
editor offers them; changing them is an admin setting, like the workspace's other settings."""

from decimal import Decimal

from fastapi import APIRouter, Depends, Query, Response, status
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_admin, require_user
from app.modules.finance.services import tax_rates

router = APIRouter(tags=["Finance tax rates"])


class TaxRateCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    kind: str = Field(default="rate", pattern="^(rate|group)$")
    rate: Decimal | None = Field(default=None, ge=0, le=100)
    member_ids: list[int] | None = Field(default=None, max_length=10)
    is_default_sales: bool | None = None
    is_default_purchases: bool | None = None


class TaxRateUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    rate: Decimal | None = Field(default=None, ge=0, le=100)
    member_ids: list[int] | None = Field(default=None, max_length=10)
    is_active: bool | None = None
    is_default_sales: bool | None = None
    is_default_purchases: bool | None = None


@router.get("/tax-rates")
def list_tax_rates(include_inactive: bool = Query(default=False), db: Session = Depends(get_db), user=Depends(require_user)):
    rates = tax_rates.list_tax_rates(db, tenant_id=user.tenant_id, include_inactive=include_inactive)
    return jsonable_encoder({"items": [tax_rates.serialize_tax_rate(rate) for rate in rates]})


@router.post("/tax-rates", status_code=status.HTTP_201_CREATED)
def create_tax_rate(payload: TaxRateCreate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    rate = tax_rates.create_tax_rate(db, tenant_id=admin.tenant_id, actor_user_id=admin.id, payload=payload.model_dump(exclude_none=True))
    db.commit()
    return jsonable_encoder(tax_rates.serialize_tax_rate(tax_rates.get_tax_rate_or_404(db, tenant_id=admin.tenant_id, rate_id=rate.id)))


@router.patch("/tax-rates/{rate_id}")
def update_tax_rate(rate_id: int, payload: TaxRateUpdate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    rate = tax_rates.get_tax_rate_or_404(db, tenant_id=admin.tenant_id, rate_id=rate_id)
    tax_rates.update_tax_rate(db, rate, actor_user_id=admin.id, payload=payload.model_dump(exclude_unset=True))
    db.commit()
    return jsonable_encoder(tax_rates.serialize_tax_rate(tax_rates.get_tax_rate_or_404(db, tenant_id=admin.tenant_id, rate_id=rate_id)))


@router.delete("/tax-rates/{rate_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tax_rate(rate_id: int, db: Session = Depends(get_db), admin=Depends(require_admin)):
    rate = tax_rates.get_tax_rate_or_404(db, tenant_id=admin.tenant_id, rate_id=rate_id)
    tax_rates.delete_tax_rate(db, rate, actor_user_id=admin.id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
