"""extended_programs_p5: medicines, refills, referrals, home monitoring, family links

Revision ID: 0013
Revises: 0012
"""
import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"


def upgrade():
    with op.batch_alter_table("consents") as t:
        t.alter_column("followup_id", existing_type=sa.Integer(), nullable=True)
        t.alter_column("channel", existing_type=sa.String(length=12), type_=sa.String(length=20))

    op.create_table(
        "patient_medications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("medicine_code", sa.String(length=50), nullable=False),
        sa.Column("dose_text_enc", sa.Text(), nullable=False, server_default=""),
        sa.Column("started_on", sa.Date(), nullable=True),
        sa.Column("last_changed_on", sa.Date(), nullable=True),
        sa.Column("stopped_on", sa.Date(), nullable=True),
        sa.Column("prescribed_by_enc", sa.Text(), nullable=False, server_default=""),
        sa.Column("source", sa.String(length=20), nullable=False, server_default="DOCTOR"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_patient_medications_patient_id", "patient_medications", ["patient_id"])
    op.create_index("ix_patient_medications_medicine_code", "patient_medications", ["medicine_code"])

    op.create_table(
        "refill_schedules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_medication_id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("refill_every_days", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("next_refill_on", sa.Date(), nullable=False),
        sa.Column("delivery_mode", sa.String(length=20), nullable=False, server_default="HOME_DELIVERY"),
        sa.Column("delivery_ref", sa.String(length=60), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="ACTIVE"),
        sa.Column("reminder_sent_for", sa.Date(), nullable=True),
        sa.Column("task_status", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("task_due_on", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.ForeignKeyConstraint(["patient_medication_id"], ["patient_medications.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("patient_medication_id"),
    )
    op.create_index("ix_refill_schedules_patient_id", "refill_schedules", ["patient_id"])
    op.create_index("ix_refill_schedules_next_refill_on", "refill_schedules", ["next_refill_on"])

    op.create_table(
        "referrals",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("followup_id", sa.Integer(), nullable=True),
        sa.Column("specialty", sa.String(length=60), nullable=False),
        sa.Column("reason_code", sa.String(length=60), nullable=False, server_default=""),
        sa.Column("urgency", sa.String(length=16), nullable=False, server_default="ROUTINE"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="SUGGESTED"),
        sa.Column("appointment_ref", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("scheduled_for", sa.Date(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["followup_id"], ["followups.id"]),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_referrals_patient_id", "referrals", ["patient_id"])
    op.create_index("ix_referrals_followup_id", "referrals", ["followup_id"])

    op.create_table(
        "home_readings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("values", sa.JSON(), nullable=False),
        sa.Column("taken_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False, server_default="MANUAL_STAFF"),
        sa.Column("entered_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_home_readings_patient_id", "home_readings", ["patient_id"])
    op.create_index("ix_home_readings_kind", "home_readings", ["kind"])
    op.create_index("ix_home_readings_taken_at", "home_readings", ["taken_at"])

    op.create_table(
        "home_visits",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("purpose_code", sa.String(length=40), nullable=False),
        sa.Column("scheduled_on", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="SCHEDULED"),
        sa.Column("staff_name", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_home_visits_patient_id", "home_visits", ["patient_id"])
    op.create_index("ix_home_visits_scheduled_on", "home_visits", ["scheduled_on"])

    op.create_table(
        "family_links",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("related_patient_id", sa.Integer(), nullable=False),
        sa.Column("relationship", sa.String(length=40), nullable=False),
        sa.Column("consent_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["consent_id"], ["consents.id"]),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.ForeignKeyConstraint(["related_patient_id"], ["patients.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("patient_id", "related_patient_id", name="uq_family_link_pair"),
    )
    op.create_index("ix_family_links_patient_id", "family_links", ["patient_id"])
    op.create_index("ix_family_links_related_patient_id", "family_links", ["related_patient_id"])


def downgrade():
    op.drop_index("ix_family_links_related_patient_id", table_name="family_links")
    op.drop_index("ix_family_links_patient_id", table_name="family_links")
    op.drop_table("family_links")
    op.drop_index("ix_home_visits_scheduled_on", table_name="home_visits")
    op.drop_index("ix_home_visits_patient_id", table_name="home_visits")
    op.drop_table("home_visits")
    op.drop_index("ix_home_readings_taken_at", table_name="home_readings")
    op.drop_index("ix_home_readings_kind", table_name="home_readings")
    op.drop_index("ix_home_readings_patient_id", table_name="home_readings")
    op.drop_table("home_readings")
    op.drop_index("ix_referrals_followup_id", table_name="referrals")
    op.drop_index("ix_referrals_patient_id", table_name="referrals")
    op.drop_table("referrals")
    op.drop_index("ix_refill_schedules_next_refill_on", table_name="refill_schedules")
    op.drop_index("ix_refill_schedules_patient_id", table_name="refill_schedules")
    op.drop_table("refill_schedules")
    op.drop_index("ix_patient_medications_medicine_code", table_name="patient_medications")
    op.drop_index("ix_patient_medications_patient_id", table_name="patient_medications")
    op.drop_table("patient_medications")
    with op.batch_alter_table("consents") as t:
        t.alter_column("channel", existing_type=sa.String(length=20), type_=sa.String(length=12))
        t.alter_column("followup_id", existing_type=sa.Integer(), nullable=False)
