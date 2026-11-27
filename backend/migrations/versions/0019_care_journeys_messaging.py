"""Care journeys, journey steps, outbound messages, and CallLog check-in codes (Page 8).

Revision ID: 0019
Revises: 0018
Create Date: 2026-11-27
"""
import sqlalchemy as sa
from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("call_logs") as batch_op:
        batch_op.add_column(sa.Column("adherence_code", sa.String(length=20), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("symptom_code", sa.String(length=20), nullable=False, server_default=""))

    op.create_table(
        "care_journeys",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("patient_id", sa.Integer(), sa.ForeignKey("patients.id"), nullable=False, index=True),
        sa.Column("followup_id", sa.Integer(), sa.ForeignKey("followups.id"), nullable=True, index=True),
        sa.Column("condition_group", sa.String(length=40), nullable=False, server_default="GENERAL", index=True),
        sa.Column("template_code", sa.String(length=40), nullable=False, server_default="STANDARD_92", index=True),
        sa.Column("template_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("started_on", sa.Date(), nullable=False, index=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="ACTIVE", index=True),
        sa.Column("stop_reason", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "journey_steps",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("journey_id", sa.Integer(), sa.ForeignKey("care_journeys.id"), nullable=False, index=True),
        sa.Column("step_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("step_code", sa.String(length=40), nullable=False, index=True),
        sa.Column("due_on", sa.Date(), nullable=False, index=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="PENDING", index=True),
        sa.Column("completed_on", sa.Date(), nullable=True),
        sa.Column("completed_by", sa.Integer(), nullable=True),
        sa.Column("completion_event", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("task_ref", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("waiting_for_data", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    op.create_table(
        "outbound_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("patient_id", sa.Integer(), sa.ForeignKey("patients.id"), nullable=False, index=True),
        sa.Column("followup_id", sa.Integer(), sa.ForeignKey("followups.id"), nullable=True, index=True),
        sa.Column("journey_step_id", sa.Integer(), sa.ForeignKey("journey_steps.id"), nullable=True, index=True),
        sa.Column("template_code", sa.String(length=40), nullable=False, index=True),
        sa.Column("language", sa.String(length=16), nullable=False, server_default="en"),
        sa.Column("channel", sa.String(length=20), nullable=False, server_default="CALL_TASK"),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="QUEUED", index=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("provider_ref", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("error", sa.String(length=240), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("outbound_messages")
    op.drop_table("journey_steps")
    op.drop_table("care_journeys")
    with op.batch_alter_table("call_logs") as batch_op:
        batch_op.drop_column("symptom_code")
        batch_op.drop_column("adherence_code")
