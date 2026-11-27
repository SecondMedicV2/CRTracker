"""Clinically approved 7-step retest model and health hubs (Page 12)

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-27
"""
import sqlalchemy as sa
from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "health_hubs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("city", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("address", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("opening_hours", sa.String(length=120), nullable=False, server_default="07:00-19:00"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
    )

    with op.batch_alter_table("retest_recommendations") as batch_op:
        batch_op.add_column(sa.Column("next_test_date", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("window_start", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("window_end", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("reason_code", sa.String(length=60), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("reason_text_clinical", sa.Text(), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("approved_by_doctor_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("protocol_code", sa.String(length=60), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("protocol_version", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("previous_results_snapshot", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("tests", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("collection_mode", sa.String(length=20), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("health_hub_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("slot_start", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("address_enc", sa.Text(), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("booking_status", sa.String(length=20), nullable=False, server_default="NOT_BOOKED"))
        batch_op.add_column(sa.Column("lab_order_ref", sa.String(length=64), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("comparison_report_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("plan_status", sa.String(length=24), nullable=False, server_default="PLANNED"))
        batch_op.add_column(sa.Column("completed_on", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("bundle_code", sa.String(length=40), nullable=False, server_default=""))
        batch_op.create_foreign_key("fk_retest_recs_health_hub", "health_hubs", ["health_hub_id"], ["id"])
        batch_op.create_foreign_key("fk_retest_recs_comp_report", "reports", ["comparison_report_id"], ["id"])

    op.create_index("ix_retest_recommendations_next_test_date", "retest_recommendations", ["next_test_date"])
    op.create_index("ix_retest_recommendations_window_end", "retest_recommendations", ["window_end"])
    op.create_index("ix_retest_recommendations_health_hub_id", "retest_recommendations", ["health_hub_id"])
    op.create_index("ix_retest_recommendations_plan_status", "retest_recommendations", ["plan_status"])


def downgrade() -> None:
    op.drop_index("ix_retest_recommendations_plan_status", table_name="retest_recommendations")
    op.drop_index("ix_retest_recommendations_health_hub_id", table_name="retest_recommendations")
    op.drop_index("ix_retest_recommendations_window_end", table_name="retest_recommendations")
    op.drop_index("ix_retest_recommendations_next_test_date", table_name="retest_recommendations")

    with op.batch_alter_table("retest_recommendations") as batch_op:
        batch_op.drop_constraint("fk_retest_recs_comp_report", type_="foreignkey")
        batch_op.drop_constraint("fk_retest_recs_health_hub", type_="foreignkey")
        for col in (
            "bundle_code", "completed_on", "plan_status", "comparison_report_id", "lab_order_ref",
            "booking_status", "address_enc", "slot_start", "health_hub_id", "collection_mode", "tests",
            "previous_results_snapshot", "protocol_version", "protocol_code", "approved_by_doctor_id",
            "reason_text_clinical", "reason_code", "window_end", "window_start", "next_test_date",
        ):
            batch_op.drop_column(col)

    op.drop_table("health_hubs")
