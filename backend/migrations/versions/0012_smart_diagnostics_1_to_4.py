"""smart_diagnostics_1_to_4: care_touchpoints, health_profiles, program_recommendations

Revision ID: 0012
Revises: 0011
"""
import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"


def upgrade():
    op.create_table(
        "care_touchpoints",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("stage", sa.String(length=30), nullable=False),
        sa.Column("service_code", sa.String(length=60), nullable=False, server_default=""),
        sa.Column("occurred_on", sa.Date(), nullable=False),
        sa.Column("source", sa.String(length=10), nullable=False, server_default="AUTO"),
        sa.Column("ref_entity", sa.String(length=40), nullable=False, server_default=""),
        sa.Column("ref_id", sa.Integer(), nullable=True),
        sa.Column("amount_inr", sa.Integer(), nullable=True),
        sa.Column("health_hub_id", sa.Integer(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("patient_id", "ref_entity", "ref_id", "stage", name="uq_care_touchpoint_ref"),
    )
    op.create_index("ix_care_touchpoints_patient_id", "care_touchpoints", ["patient_id"])
    op.create_index("ix_care_touchpoints_stage", "care_touchpoints", ["stage"])
    op.create_index("ix_care_touchpoints_occurred_on", "care_touchpoints", ["occurred_on"])

    op.create_table(
        "health_profiles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("payload_enc", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_by", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("patient_id"),
    )
    op.create_index("ix_health_profiles_patient_id", "health_profiles", ["patient_id"], unique=True)

    op.create_table(
        "program_recommendations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("followup_id", sa.Integer(), nullable=True),
        sa.Column("report_id", sa.Integer(), nullable=True),
        sa.Column("program_code", sa.String(length=50), nullable=False),
        sa.Column("rule_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="SUGGESTED"),
        sa.Column("reason_codes", sa.JSON(), nullable=False),
        sa.Column("missing_data", sa.JSON(), nullable=False),
        sa.Column("notes", sa.JSON(), nullable=False),
        sa.Column("decided_by", sa.Integer(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decline_reason_code", sa.String(length=40), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["followup_id"], ["followups.id"]),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.ForeignKeyConstraint(["report_id"], ["reports.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("report_id", "program_code", name="uq_program_rec_report_code"),
    )
    op.create_index("ix_program_recommendations_patient_id", "program_recommendations", ["patient_id"])
    op.create_index("ix_program_recommendations_followup_id", "program_recommendations", ["followup_id"])
    op.create_index("ix_program_recommendations_report_id", "program_recommendations", ["report_id"])
    op.create_index("ix_program_recommendations_program_code", "program_recommendations", ["program_code"])
    op.create_index("ix_program_recommendations_status", "program_recommendations", ["status"])


def downgrade():
    for ix, tbl in (
        ("ix_program_recommendations_status", "program_recommendations"),
        ("ix_program_recommendations_program_code", "program_recommendations"),
        ("ix_program_recommendations_report_id", "program_recommendations"),
        ("ix_program_recommendations_followup_id", "program_recommendations"),
        ("ix_program_recommendations_patient_id", "program_recommendations"),
    ):
        op.drop_index(ix, table_name=tbl)
    op.drop_table("program_recommendations")
    op.drop_index("ix_health_profiles_patient_id", table_name="health_profiles")
    op.drop_table("health_profiles")
    for ix in ("ix_care_touchpoints_occurred_on", "ix_care_touchpoints_stage", "ix_care_touchpoints_patient_id"):
        op.drop_index(ix, table_name="care_touchpoints")
    op.drop_table("care_touchpoints")
