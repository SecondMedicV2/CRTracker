"""Retest protocol windows, reminders, anchor date and recommendation source (Page 7)

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-26
"""
import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("followups", sa.Column("retest_window_start", sa.Date(), nullable=True))
    op.add_column("followups", sa.Column("retest_window_end", sa.Date(), nullable=True))
    op.add_column("followups", sa.Column("reminder_on", sa.Date(), nullable=True))
    op.add_column("followups", sa.Column("reminder_sent_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("followups", sa.Column("treatment_anchor_on", sa.Date(), nullable=True))
    op.add_column("followups", sa.Column("retest_status", sa.String(length=20), nullable=False, server_default="AUTO_SCHEDULED"))
    op.add_column("followups", sa.Column("retest_plan", sa.JSON(), nullable=True))
    op.create_index("ix_followups_retest_window_start", "followups", ["retest_window_start"])
    op.create_index("ix_followups_reminder_on", "followups", ["reminder_on"])
    op.create_index("ix_followups_retest_status", "followups", ["retest_status"])
    op.add_column("retest_recommendations", sa.Column("source", sa.String(length=20), nullable=False, server_default="DOCTOR"))


def downgrade() -> None:
    op.drop_column("retest_recommendations", "source")
    op.drop_index("ix_followups_retest_status", table_name="followups")
    op.drop_index("ix_followups_reminder_on", table_name="followups")
    op.drop_index("ix_followups_retest_window_start", table_name="followups")
    op.drop_column("followups", "retest_plan")
    op.drop_column("followups", "retest_status")
    op.drop_column("followups", "treatment_anchor_on")
    op.drop_column("followups", "reminder_sent_at")
    op.drop_column("followups", "reminder_on")
    op.drop_column("followups", "retest_window_end")
    op.drop_column("followups", "retest_window_start")
