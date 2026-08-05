"""remove direct module grants from department-assigned teams

Revision ID: 20260731_team_access_hierarchy
Revises: 20260730_doc_version_refs
Create Date: 2026-08-06
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260731_team_access_hierarchy"
down_revision: Union[str, None] = "20260730_doc_version_refs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Department membership is authoritative. Direct grants remain meaningful
    # only for teams that have no parent department.
    op.execute(
        "DELETE FROM team_module_permissions AS permission "
        "USING teams AS team "
        "WHERE permission.team_id = team.id "
        "AND team.department_id IS NOT NULL"
    )


def downgrade() -> None:
    # Removed rows were ambiguous duplicates or invalid overrides and cannot be
    # reconstructed without reintroducing the authorization bypass.
    pass
