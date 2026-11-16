"""ai_insights

Revision ID: 0010
Revises: 0009
"""
import sqlalchemy as sa
from alembic import op

revision = '0010'
down_revision = '0009'


def upgrade():
    op.create_table(
        'report_insights',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('report_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='DRAFT'),
        sa.Column('content', sa.JSON(), nullable=False),
        sa.Column('provider', sa.String(length=40), nullable=False, server_default='template'),
        sa.Column('model', sa.String(length=60), nullable=False, server_default=''),
        sa.Column('prompt_version', sa.String(length=20), nullable=False, server_default='v1'),
        sa.Column('input_hash', sa.String(length=64), nullable=False, server_default=''),
        sa.Column('validation_errors', sa.JSON(), nullable=False),
        sa.Column('approved_by', sa.Integer(), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['approved_by'], ['users.id']),
        sa.ForeignKeyConstraint(['report_id'], ['reports.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('report_id')
    )
    op.create_index('ix_report_insights_report_id', 'report_insights', ['report_id'])
    op.create_index('ix_report_insights_status', 'report_insights', ['status'])

    op.create_table(
        'critical_rules',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('marker_code', sa.String(length=40), nullable=False),
        sa.Column('label', sa.String(length=120), nullable=False),
        sa.Column('comparator', sa.String(length=4), nullable=False),
        sa.Column('threshold', sa.Float(), nullable=False),
        sa.Column('unit', sa.String(length=30), nullable=False),
        sa.Column('note', sa.String(length=300), nullable=False, server_default=''),
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.text('1')),
        sa.Column('approved_by', sa.Integer(), nullable=False),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['approved_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_critical_rules_marker_code', 'critical_rules', ['marker_code'])


def downgrade():
    op.drop_index('ix_critical_rules_marker_code', table_name='critical_rules')
    op.drop_table('critical_rules')
    op.drop_index('ix_report_insights_status', table_name='report_insights')
    op.drop_index('ix_report_insights_report_id', table_name='report_insights')
    op.drop_table('report_insights')
