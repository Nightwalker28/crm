# Task: Documents Versioning and Templates

## Purpose

Improve document management by adding version history and reusable document templates.

## What this task will accomplish

- Preserve previous versions of uploaded documents.
- Add template classification for reusable files.
- Add version history UI.
- Add safe download/access behavior for versions.

## Backend files to inspect and modify

- `backend/app/modules/documents/models.py`
- `backend/app/modules/documents/schema.py`
- `backend/app/modules/documents/services/document_services.py`
- `backend/app/modules/documents/routes/document_routes.py`
- `backend/alembic/versions/*`
- Backend document tests

## Frontend files to inspect and modify

- `frontend/app/dashboard/documents/*`
- `frontend/components/documents/*`
- Document hooks/API utilities

## Database changes

Create a migration for:

- `document_versions`
  - `id`
  - `tenant_id`
  - `document_id`
  - `version_number`
  - `storage_key`
  - `file_name`
  - `mime_type`
  - `size_bytes`
  - `checksum` nullable
  - `uploaded_by_id`
  - `created_at`

Add to existing documents table if needed:

- `is_template`
- `template_category`
- `current_version_id`

Optional:

- `document_shares`
  - only if sharing permissions are missing and needed

## API changes

- Upload new version
- List document versions
- Download specific version
- Mark/unmark document as template
- List templates

## UI changes

- Document detail version history.
- Upload new version action.
- Template badge/filter.
- Template list or filter in documents page.

## Validation

- Uploading a new version preserves previous file metadata.
- Download current version works.
- Download older version works if authorized.
- Template filter works.
- Permissions remain tenant-safe.
