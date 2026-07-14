from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.like_patterns import LIKE_ESCAPE, contains_pattern
from app.modules.platform.models import RecordTag, RecordTagLink


MAX_RECORD_TAGS = 20
MAX_RECORD_TAG_LENGTH = 50


def normalize_record_tags(values: Sequence[str] | None) -> list[tuple[str, str]]:
    if values is None:
        return []
    if len(values) > MAX_RECORD_TAGS:
        raise ValueError(f"A record can have at most {MAX_RECORD_TAGS} tags")

    normalized: list[tuple[str, str]] = []
    seen: set[str] = set()
    for raw_value in values:
        name = " ".join(str(raw_value).strip().split())
        if not name:
            continue
        if len(name) > MAX_RECORD_TAG_LENGTH:
            raise ValueError(f"Tags must be {MAX_RECORD_TAG_LENGTH} characters or fewer")
        key = name.casefold()
        if key in seen:
            continue
        seen.add(key)
        normalized.append((name, key))
    return normalized


def sync_record_tags(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    entity_id: str | int,
    tags: Sequence[str],
) -> list[str]:
    normalized = normalize_record_tags(tags)
    normalized_names = [key for _name, key in normalized]
    existing_tags = (
        db.query(RecordTag)
        .filter(RecordTag.tenant_id == tenant_id, RecordTag.normalized_name.in_(normalized_names))
        .all()
        if normalized_names
        else []
    )
    tags_by_name = {tag.normalized_name: tag for tag in existing_tags}
    for name, normalized_name in normalized:
        if normalized_name in tags_by_name:
            continue
        tag = RecordTag(tenant_id=tenant_id, name=name, normalized_name=normalized_name)
        db.add(tag)
        db.flush()
        tags_by_name[normalized_name] = tag

    entity_key = str(entity_id)
    current_links = (
        db.query(RecordTagLink)
        .filter(
            RecordTagLink.tenant_id == tenant_id,
            RecordTagLink.module_key == module_key,
            RecordTagLink.entity_id == entity_key,
        )
        .all()
    )
    desired_tag_ids = {tags_by_name[key].id for key in normalized_names}
    current_by_tag_id = {link.tag_id: link for link in current_links}
    for tag_id, link in current_by_tag_id.items():
        if tag_id not in desired_tag_ids:
            db.delete(link)
    for tag_id in desired_tag_ids - set(current_by_tag_id):
        db.add(
            RecordTagLink(
                tenant_id=tenant_id,
                module_key=module_key,
                entity_id=entity_key,
                tag_id=tag_id,
            )
        )
    return [tags_by_name[key].name for key in normalized_names]


def hydrate_record_tags(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    records: Sequence[object],
    record_id_attr: str,
) -> Sequence[object]:
    record_list = list(records)
    entity_ids = [str(getattr(record, record_id_attr)) for record in record_list]
    tags_by_entity: dict[str, list[str]] = {entity_id: [] for entity_id in entity_ids}
    if entity_ids:
        rows = (
            db.query(RecordTagLink.entity_id, RecordTag.name)
            .join(
                RecordTag,
                (RecordTag.id == RecordTagLink.tag_id) & (RecordTag.tenant_id == RecordTagLink.tenant_id),
            )
            .filter(
                RecordTagLink.tenant_id == tenant_id,
                RecordTagLink.module_key == module_key,
                RecordTagLink.entity_id.in_(entity_ids),
            )
            .order_by(func.lower(RecordTag.name).asc(), RecordTag.id.asc())
            .all()
        )
        for entity_id, tag_name in rows:
            tags_by_entity.setdefault(str(entity_id), []).append(tag_name)
    for record in record_list:
        setattr(record, "_record_tags_cache", tags_by_entity.get(str(getattr(record, record_id_attr)), []))
    return record_list


def list_record_tag_options(db: Session, *, tenant_id: int, module_key: str, query: str, limit: int = 10) -> list[str]:
    normalized = query.strip()
    tags_query = db.query(RecordTag).filter(
        RecordTag.tenant_id == tenant_id,
        RecordTag.links.any(
            (RecordTagLink.tenant_id == tenant_id) & (RecordTagLink.module_key == module_key)
        ),
    )
    if normalized:
        tags_query = tags_query.filter(
            func.lower(RecordTag.name).like(contains_pattern(normalized.casefold()), escape=LIKE_ESCAPE)
        )
    return [tag.name for tag in tags_query.order_by(func.lower(RecordTag.name).asc()).limit(limit).all()]
