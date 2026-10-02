from sqlalchemy.orm import Session, selectinload

from app.modules.inventory.models import InventoryAdjustment, InventoryTransfer


def adjustment(db: Session, *, tenant_id: int, document_id: int, include_deleted: bool = False, lock: bool = False):
    query = db.query(InventoryAdjustment).options(selectinload(InventoryAdjustment.lines)).filter(
        InventoryAdjustment.tenant_id == tenant_id, InventoryAdjustment.id == document_id,
    )
    if not include_deleted:
        query = query.filter(InventoryAdjustment.deleted_at.is_(None))
    return (query.with_for_update() if lock else query).first()


def transfer(db: Session, *, tenant_id: int, document_id: int, include_deleted: bool = False, lock: bool = False):
    query = db.query(InventoryTransfer).options(selectinload(InventoryTransfer.lines)).filter(
        InventoryTransfer.tenant_id == tenant_id, InventoryTransfer.id == document_id,
    )
    if not include_deleted:
        query = query.filter(InventoryTransfer.deleted_at.is_(None))
    return (query.with_for_update() if lock else query).first()


def adjustment_list(db: Session, *, tenant_id: int, include_deleted: bool = False):
    query = db.query(InventoryAdjustment).options(selectinload(InventoryAdjustment.lines)).filter(InventoryAdjustment.tenant_id == tenant_id)
    return query if include_deleted else query.filter(InventoryAdjustment.deleted_at.is_(None))


def transfer_list(db: Session, *, tenant_id: int, include_deleted: bool = False):
    query = db.query(InventoryTransfer).options(selectinload(InventoryTransfer.lines)).filter(InventoryTransfer.tenant_id == tenant_id)
    return query if include_deleted else query.filter(InventoryTransfer.deleted_at.is_(None))


def deleted_list(db: Session, *, tenant_id: int, kind: str):
    """Removed drafts, newest removal first, for the recycle bin."""
    model = InventoryAdjustment if kind == "adjustments" else InventoryTransfer
    return (db.query(model).options(selectinload(model.lines))
            .filter(model.tenant_id == tenant_id, model.deleted_at.isnot(None))
            .order_by(model.deleted_at.desc(), model.id.desc()))
