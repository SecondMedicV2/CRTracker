"""lab_patient_hint: LabTrace order number and the booked patient's details on each order

Revision ID: 0011
Revises: 0010
"""
import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"


def upgrade():
    with op.batch_alter_table("orders") as t:
        t.add_column(sa.Column("lab_ref", sa.String(length=64), nullable=False, server_default=""))
        t.add_column(sa.Column("patient_hint_enc", sa.Text(), nullable=False, server_default=""))


def downgrade():
    with op.batch_alter_table("orders") as t:
        t.drop_column("patient_hint_enc")
        t.drop_column("lab_ref")
