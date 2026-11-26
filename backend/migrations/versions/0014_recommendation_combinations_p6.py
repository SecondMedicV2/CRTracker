"""recommendation combinations & diagnostic findings (Page 6)

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-26
"""
import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("followups", sa.Column("finding_codes", sa.JSON(), nullable=True))
    op.add_column("program_recommendations", sa.Column("rank", sa.Integer(), nullable=True))
    op.add_column("program_recommendations", sa.Column("finding_code", sa.String(length=40), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("program_recommendations", "finding_code")
    op.drop_column("program_recommendations", "rank")
    op.drop_column("followups", "finding_codes")
