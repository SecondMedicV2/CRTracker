"""Tables for pages 13, 15 and 17 that were only ever created by create_all, plus drifted columns.

Adds: express_nodes, corporate_clients, membership_plans, memberships, payments, care_plans, plan_enrollments;
patients.source_channel / source_ref_id / corporate_client_id; care_touchpoints.express_node_id;
followups.doctor_cleared_at / doctor_cleared_by (safety gate); import_batches.message;
monitoring_schedules.note widened to 300 and users.role widened to 20 to match the models.

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-28
"""
import sqlalchemy as sa
from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('care_plans',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('number', sa.String(length=10), nullable=False),
    sa.Column('code', sa.String(length=60), nullable=False),
    sa.Column('line', sa.String(length=80), nullable=False),
    sa.Column('name_en', sa.String(length=150), nullable=False),
    sa.Column('name_hi', sa.String(length=150), nullable=False),
    sa.Column('for_text', sa.Text(), nullable=False),
    sa.Column('colour', sa.String(length=30), nullable=False),
    sa.Column('icon', sa.String(length=50), nullable=False),
    sa.Column('tiers', sa.JSON(), nullable=False),
    sa.Column('inclusions_plus', sa.JSON(), nullable=False),
    sa.Column('essential_covers', sa.Text(), nullable=False),
    sa.Column('entitlements', sa.JSON(), nullable=False),
    sa.Column('tracked_measures', sa.JSON(), nullable=False),
    sa.Column('charged_separately', sa.JSON(), nullable=False),
    sa.Column('footnote', sa.Text(), nullable=False),
    sa.Column('qr_url', sa.String(length=200), nullable=False),
    sa.Column('linked_programs', sa.JSON(), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_by', sa.Integer(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_care_plans_code'), 'care_plans', ['code'], unique=True)
    op.create_table('corporate_clients',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('code', sa.String(length=60), nullable=False),
    sa.Column('contract_start', sa.Date(), nullable=True),
    sa.Column('contract_end', sa.Date(), nullable=True),
    sa.Column('pricing_model', sa.String(length=20), nullable=False),
    sa.Column('pepm_inr', sa.Integer(), nullable=False),
    sa.Column('covered_members', sa.Integer(), nullable=False),
    sa.Column('contact_enc', sa.Text(), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_by', sa.Integer(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_corporate_clients_code'), 'corporate_clients', ['code'], unique=True)
    op.create_table('membership_plans',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('code', sa.String(length=60), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('target_text', sa.Text(), nullable=False),
    sa.Column('price_inr_monthly', sa.Integer(), nullable=False),
    sa.Column('benefits_text', sa.Text(), nullable=False),
    sa.Column('includes_plan', sa.String(length=60), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('entitlements', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_by', sa.Integer(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_membership_plans_code'), 'membership_plans', ['code'], unique=True)
    op.create_table('express_nodes',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('code', sa.String(length=60), nullable=False),
    sa.Column('node_type', sa.String(length=30), nullable=False),
    sa.Column('city', sa.String(length=80), nullable=False),
    sa.Column('health_hub_id', sa.Integer(), nullable=True),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_by', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['health_hub_id'], ['health_hubs.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_express_nodes_code'), 'express_nodes', ['code'], unique=True)
    op.create_index(op.f('ix_express_nodes_health_hub_id'), 'express_nodes', ['health_hub_id'], unique=False)
    op.create_table('memberships',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('patient_id', sa.Integer(), nullable=False),
    sa.Column('plan_code', sa.String(length=60), nullable=False),
    sa.Column('status', sa.String(length=30), nullable=False),
    sa.Column('payer', sa.String(length=20), nullable=False),
    sa.Column('member_ref', sa.String(length=60), nullable=False),
    sa.Column('signed_off_by', sa.Integer(), nullable=True),
    sa.Column('signed_off_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_reminded_on', sa.Date(), nullable=True),
    sa.Column('renewal_count', sa.Integer(), nullable=False),
    sa.Column('corporate_client_id', sa.Integer(), nullable=True),
    sa.Column('start_on', sa.Date(), nullable=False),
    sa.Column('current_period_end', sa.Date(), nullable=False),
    sa.Column('auto_renew', sa.Boolean(), nullable=False),
    sa.Column('enrolled_by', sa.Integer(), nullable=True),
    sa.Column('health_hub_id', sa.Integer(), nullable=True),
    sa.Column('family_group_id', sa.Integer(), nullable=True),
    sa.Column('entitlements_used', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_by', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['corporate_client_id'], ['corporate_clients.id'], ),
    sa.ForeignKeyConstraint(['health_hub_id'], ['health_hubs.id'], ),
    sa.ForeignKeyConstraint(['patient_id'], ['patients.id'], ),
    sa.ForeignKeyConstraint(['plan_code'], ['membership_plans.code'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_memberships_corporate_client_id'), 'memberships', ['corporate_client_id'], unique=False)
    op.create_index(op.f('ix_memberships_current_period_end'), 'memberships', ['current_period_end'], unique=False)
    op.create_index(op.f('ix_memberships_family_group_id'), 'memberships', ['family_group_id'], unique=False)
    op.create_index(op.f('ix_memberships_health_hub_id'), 'memberships', ['health_hub_id'], unique=False)
    op.create_index(op.f('ix_memberships_patient_id'), 'memberships', ['patient_id'], unique=False)
    op.create_index(op.f('ix_memberships_plan_code'), 'memberships', ['plan_code'], unique=False)
    op.create_index(op.f('ix_memberships_status'), 'memberships', ['status'], unique=False)
    op.create_table('payments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('patient_id', sa.Integer(), nullable=False),
    sa.Column('membership_id', sa.Integer(), nullable=True),
    sa.Column('amount_inr', sa.Integer(), nullable=False),
    sa.Column('method', sa.String(length=30), nullable=False),
    sa.Column('reference', sa.String(length=60), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('health_hub_id', sa.Integer(), nullable=True),
    sa.Column('received_by', sa.Integer(), nullable=True),
    sa.Column('received_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_by', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['health_hub_id'], ['health_hubs.id'], ),
    sa.ForeignKeyConstraint(['membership_id'], ['memberships.id'], ),
    sa.ForeignKeyConstraint(['patient_id'], ['patients.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_payments_health_hub_id'), 'payments', ['health_hub_id'], unique=False)
    op.create_index(op.f('ix_payments_membership_id'), 'payments', ['membership_id'], unique=False)
    op.create_index(op.f('ix_payments_patient_id'), 'payments', ['patient_id'], unique=False)
    op.create_index(op.f('ix_payments_status'), 'payments', ['status'], unique=False)
    op.create_table('plan_enrollments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('patient_id', sa.Integer(), nullable=False),
    sa.Column('plan_code', sa.String(length=60), nullable=False),
    sa.Column('tier', sa.String(length=20), nullable=False),
    sa.Column('status', sa.String(length=30), nullable=False),
    sa.Column('health_hub_id', sa.Integer(), nullable=True),
    sa.Column('assessed_by_doctor_id', sa.Integer(), nullable=True),
    sa.Column('assessed_on', sa.DateTime(timezone=True), nullable=True),
    sa.Column('eligibility_note_code', sa.String(length=60), nullable=False),
    sa.Column('period_start', sa.Date(), nullable=True),
    sa.Column('period_end', sa.Date(), nullable=True),
    sa.Column('price_inr', sa.Integer(), nullable=False),
    sa.Column('payment_id', sa.Integer(), nullable=True),
    sa.Column('entitlements_used', sa.JSON(), nullable=False),
    sa.Column('last_reminded_on', sa.Date(), nullable=True),
    sa.Column('activated_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('renewal_count', sa.Integer(), nullable=False),
    sa.Column('note', sa.String(length=200), nullable=False),
    sa.Column('created_by', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['assessed_by_doctor_id'], ['doctors.id'], ),
    sa.ForeignKeyConstraint(['health_hub_id'], ['health_hubs.id'], ),
    sa.ForeignKeyConstraint(['patient_id'], ['patients.id'], ),
    sa.ForeignKeyConstraint(['payment_id'], ['payments.id'], ),
    sa.ForeignKeyConstraint(['plan_code'], ['care_plans.code'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_plan_enrollments_assessed_by_doctor_id'), 'plan_enrollments', ['assessed_by_doctor_id'], unique=False)
    op.create_index(op.f('ix_plan_enrollments_health_hub_id'), 'plan_enrollments', ['health_hub_id'], unique=False)
    op.create_index(op.f('ix_plan_enrollments_patient_id'), 'plan_enrollments', ['patient_id'], unique=False)
    op.create_index(op.f('ix_plan_enrollments_payment_id'), 'plan_enrollments', ['payment_id'], unique=False)
    op.create_index(op.f('ix_plan_enrollments_period_end'), 'plan_enrollments', ['period_end'], unique=False)
    op.create_index(op.f('ix_plan_enrollments_plan_code'), 'plan_enrollments', ['plan_code'], unique=False)
    op.create_index(op.f('ix_plan_enrollments_status'), 'plan_enrollments', ['status'], unique=False)
    with op.batch_alter_table("care_touchpoints") as b:
        b.add_column(sa.Column("express_node_id", sa.Integer(), nullable=True))
        b.create_index("ix_care_touchpoints_express_node_id", ["express_node_id"])
        b.create_foreign_key("fk_care_touchpoints_express_node_id", "express_nodes", ["express_node_id"], ["id"])
    with op.batch_alter_table("patients") as b:
        b.add_column(sa.Column("source_channel", sa.String(length=30), nullable=False, server_default="DIRECT"))
        b.add_column(sa.Column("source_ref_id", sa.Integer(), nullable=True))
        b.add_column(sa.Column("corporate_client_id", sa.Integer(), nullable=True))
        b.create_index("ix_patients_corporate_client_id", ["corporate_client_id"])
        b.create_foreign_key("fk_patients_corporate_client_id", "corporate_clients", ["corporate_client_id"], ["id"])
    with op.batch_alter_table("followups") as b:
        b.add_column(sa.Column("doctor_cleared_at", sa.DateTime(timezone=True), nullable=True))
        b.add_column(sa.Column("doctor_cleared_by", sa.Integer(), nullable=True))
    with op.batch_alter_table("import_batches") as b:
        b.add_column(sa.Column("message", sa.Text(), nullable=False, server_default=""))
    with op.batch_alter_table("monitoring_schedules") as b:
        b.alter_column("note", existing_type=sa.String(length=200), type_=sa.String(length=300), existing_nullable=False)
    with op.batch_alter_table("users") as b:
        b.alter_column("role", existing_type=sa.String(length=10), type_=sa.String(length=20), existing_nullable=False)


def downgrade() -> None:
    with op.batch_alter_table("users") as b:
        b.alter_column("role", existing_type=sa.String(length=20), type_=sa.String(length=10), existing_nullable=False)
    with op.batch_alter_table("monitoring_schedules") as b:
        b.alter_column("note", existing_type=sa.String(length=300), type_=sa.String(length=200), existing_nullable=False)
    with op.batch_alter_table("import_batches") as b:
        b.drop_column("message")
    with op.batch_alter_table("followups") as b:
        b.drop_column("doctor_cleared_by")
        b.drop_column("doctor_cleared_at")
    with op.batch_alter_table("patients") as b:
        b.drop_constraint("fk_patients_corporate_client_id", type_="foreignkey")
        b.drop_index("ix_patients_corporate_client_id")
        b.drop_column("corporate_client_id")
        b.drop_column("source_ref_id")
        b.drop_column("source_channel")
    with op.batch_alter_table("care_touchpoints") as b:
        b.drop_constraint("fk_care_touchpoints_express_node_id", type_="foreignkey")
        b.drop_index("ix_care_touchpoints_express_node_id")
        b.drop_column("express_node_id")
    for t in ("plan_enrollments", "payments", "memberships", "express_nodes", "membership_plans", "corporate_clients", "care_plans"):
        op.drop_table(t)
