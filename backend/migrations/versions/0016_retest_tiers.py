"""Retesting protocol 5 urgency tiers and SLA escalation tracking (Page 9)

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-27
"""
import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("followups", sa.Column("protocol_tier", sa.String(length=24), nullable=False, server_default="LONG_TERM"))
    op.add_column("followups", sa.Column("sla_escalated_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_followups_protocol_tier", "followups", ["protocol_tier"])


def downgrade() -> None:
    op.drop_index("ix_followups_protocol_tier", table_name="followups")
    op.drop_column("followups", "sla_escalated_at")
    op.drop_column("followups", "protocol_tier")
