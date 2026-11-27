"""Condition monitoring schedules and clinical tasks (Page 11)

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-27
"""
import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "monitoring_schedules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("patient_id", sa.Integer(), sa.ForeignKey("patients.id"), nullable=False),
        sa.Column("condition_code", sa.String(length=40), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False, server_default="BP"),
        sa.Column("frequency_per_day", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("duration_days", sa.Integer(), nullable=False, server_default="7"),
        sa.Column("start_on", sa.Date(), nullable=False),
        sa.Column("end_on", sa.Date(), nullable=False),
        sa.Column("slots", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="ACTIVE"),
        sa.Column("last_reminded_on", sa.Date(), nullable=True),
        sa.Column("note", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_monitoring_schedules_patient_id", "monitoring_schedules", ["patient_id"])
    op.create_index("ix_monitoring_schedules_condition_code", "monitoring_schedules", ["condition_code"])
    op.create_index("ix_monitoring_schedules_status", "monitoring_schedules", ["status"])

    op.create_table(
        "clinical_tasks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("patient_id", sa.Integer(), sa.ForeignKey("patients.id"), nullable=False),
        sa.Column("followup_id", sa.Integer(), sa.ForeignKey("followups.id"), nullable=True),
        sa.Column("condition_code", sa.String(length=40), nullable=False),
        sa.Column("task_type", sa.String(length=40), nullable=False, server_default="CHOOSE_LAB_TESTS"),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("details", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("selected_tests", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="OPEN"),
        sa.Column("assigned_doctor_id", sa.Integer(), nullable=True),
        sa.Column("completed_by", sa.Integer(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_clinical_tasks_patient_id", "clinical_tasks", ["patient_id"])
    op.create_index("ix_clinical_tasks_followup_id", "clinical_tasks", ["followup_id"])
    op.create_index("ix_clinical_tasks_condition_code", "clinical_tasks", ["condition_code"])
    op.create_index("ix_clinical_tasks_status", "clinical_tasks", ["status"])


def downgrade() -> None:
    op.drop_index("ix_clinical_tasks_status", table_name="clinical_tasks")
    op.drop_index("ix_clinical_tasks_condition_code", table_name="clinical_tasks")
    op.drop_index("ix_clinical_tasks_followup_id", table_name="clinical_tasks")
    op.drop_index("ix_clinical_tasks_patient_id", table_name="clinical_tasks")
    op.drop_table("clinical_tasks")

    op.drop_index("ix_monitoring_schedules_status", table_name="monitoring_schedules")
    op.drop_index("ix_monitoring_schedules_condition_code", table_name="monitoring_schedules")
    op.drop_index("ix_monitoring_schedules_patient_id", table_name="monitoring_schedules")
    op.drop_table("monitoring_schedules")
