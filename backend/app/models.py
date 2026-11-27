from datetime import date, datetime, timezone

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def now():
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Stamped:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)


class User(Base, Stamped):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20))  # ADMIN | CALLER | DOCTOR | CUSTOMER | RETAILER | RIDER | SUPPORT | PHARMACIST
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Doctor(Base, Stamped):
    __tablename__ = "doctors"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(120))
    speciality: Mapped[str] = mapped_column(String(120), default="")
    languages: Mapped[list] = mapped_column(JSON, default=list)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    priority_order: Mapped[int] = mapped_column(Integer, default=100)
    phone: Mapped[str] = mapped_column(String(30), default="")  # shown to the caller for "connect now"
    in_pilot: Mapped[bool] = mapped_column(Boolean, default=False)  # receives cases while pilot_mode is on


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[object] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)
    updated_by: Mapped[int | None] = mapped_column(Integer, nullable=True)


class RuleSet(Base):
    """Versioned medical content (ranges, buckets, aliases, weights...). Edits add a
    new version; each new version needs doctor sign-off again (Part 11.1)."""

    __tablename__ = "rule_sets"
    __table_args__ = (UniqueConstraint("key", "version"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(60), index=True)
    version: Mapped[int] = mapped_column(Integer)
    data: Mapped[object] = mapped_column(JSON)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    signed_off_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    signed_off_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(60))
    entity: Mapped[str] = mapped_column(String(60))
    entity_id: Mapped[str] = mapped_column(String(60), default="")
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    ip: Mapped[str] = mapped_column(String(60), default="")


class ImportBatch(Base, Stamped):
    __tablename__ = "import_batches"
    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(10))  # manual | file | api
    file_name: Mapped[str] = mapped_column(String(200), default="")
    total: Mapped[int] = mapped_column(Integer, default=0)
    new: Mapped[int] = mapped_column(Integer, default=0)
    duplicate: Mapped[int] = mapped_column(Integer, default=0)
    failed: Mapped[int] = mapped_column(Integer, default=0)
    failures: Mapped[list] = mapped_column(JSON, default=list)  # [{value, reason}]
    message: Mapped[str] = mapped_column(Text, default="")
    started_by: Mapped[int | None] = mapped_column(Integer, nullable=True)


class Order(Base, Stamped):
    __tablename__ = "orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id_external: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("import_batches.id"), index=True)
    patient_id: Mapped[int | None] = mapped_column(Integer, nullable=True)  # linked in Phase 4
    status: Mapped[str] = mapped_column(String(20), default="QUEUED", index=True)
    error: Mapped[str] = mapped_column(String(400), default="")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    collected_on: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reported_on: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lab: Mapped[str] = mapped_column(String(30), default="")
    report_path: Mapped[str] = mapped_column(String(300), default="")  # encrypted file under STORAGE_DIR
    report_kind: Mapped[str] = mapped_column(String(10), default="")  # pdf | json
    lab_ref: Mapped[str] = mapped_column(String(64), default="")  # the lab's own order number (LabTrace WO number)
    # Encrypted JSON {"name","age","gender","mobile"} from the lab's booking; fills what the report itself lacks.
    patient_hint_enc: Mapped[str] = mapped_column(Text, default="")


class Report(Base, Stamped):
    __tablename__ = "reports"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), unique=True, index=True)
    patient_name: Mapped[str] = mapped_column(String(120), default="")
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gender: Mapped[str] = mapped_column(String(1), default="")  # M | F | ""
    mobile_enc: Mapped[str] = mapped_column(String(300), default="")  # field-level encrypted (Part 15.1)
    collected_on: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reported_on: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lab_name: Mapped[str] = mapped_column(String(60), default="")
    extraction_confidence: Mapped[int] = mapped_column(Integer, default=0)  # percent
    needs_review: Mapped[bool] = mapped_column(Boolean, default=False)
    review_reasons: Mapped[list] = mapped_column(JSON, default=list)
    classification: Mapped[str] = mapped_column(String(10), default="")  # NORMAL | ABNORMAL


class ReportParameter(Base):
    __tablename__ = "report_parameters"
    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("reports.id"), index=True)
    param_code: Mapped[str] = mapped_column(String(40), default="")
    param_name_raw: Mapped[str] = mapped_column(String(120), default="")
    value_num: Mapped[float | None] = mapped_column(Float, nullable=True)
    value_text: Mapped[str] = mapped_column(String(60), default="")
    unit: Mapped[str] = mapped_column(String(30), default="")
    ref_low: Mapped[float | None] = mapped_column(Float, nullable=True)
    ref_high: Mapped[float | None] = mapped_column(Float, nullable=True)
    ref_text: Mapped[str] = mapped_column(String(60), default="")
    lab_flag: Mapped[str] = mapped_column(String(20), default="")
    system_flag: Mapped[str] = mapped_column(String(10), default="")  # NORMAL | LOW | HIGH | ""
    severity: Mapped[str] = mapped_column(String(10), default="")  # mild | moderate | severe
    deviation_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    ref_source: Mapped[str] = mapped_column(String(10), default="")  # report | fallback | lab_flag


class Patient(Base, Stamped):
    __tablename__ = "patients"
    __table_args__ = (Index("ix_patients_gender_age", "gender", "age"),)  # the duplicate check looks up same-gender, similar-age people
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    name_norm: Mapped[str] = mapped_column(String(120), index=True)
    gender: Mapped[str] = mapped_column(String(1), default="")
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)  # age at latest report
    mobile_enc: Mapped[str] = mapped_column(String(300), default="")  # encrypted for display
    mobile_hash: Mapped[str] = mapped_column(String(64), default="", index=True)  # HMAC for matching/search
    language: Mapped[str] = mapped_column(String(20), default="")
    household_tag: Mapped[str] = mapped_column(String(20), default="", index=True)
    do_not_call: Mapped[bool] = mapped_column(Boolean, default=False)
    merged_into_id: Mapped[int | None] = mapped_column(ForeignKey("patients.id"), nullable=True)


class PatientBucket(Base):
    __tablename__ = "patient_buckets"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("reports.id"), index=True)  # the report that put them here
    bucket_code: Mapped[str] = mapped_column(String(30))
    severity: Mapped[str] = mapped_column(String(10), default="")
    reason: Mapped[str] = mapped_column(String(300), default="")  # visible "why" (AC6)
    active: Mapped[bool] = mapped_column(Boolean, default=True)  # false once a newer report supersedes it


class Followup(Base, Stamped):
    __tablename__ = "followups"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("reports.id"), unique=True)  # one follow-up per report
    bucket_codes: Mapped[list] = mapped_column(JSON, default=list)
    abnormal_codes: Mapped[list] = mapped_column(JSON, default=list)
    finding_codes: Mapped[list] = mapped_column(JSON, default=list)
    due_on: Mapped[date] = mapped_column(Date, index=True)
    priority: Mapped[str] = mapped_column(String(12), default="ROUTINE")  # ROUTINE | ESCALATION
    stage: Mapped[str] = mapped_column(String(20), default="NOT_CALLED", index=True)
    retest_score: Mapped[int] = mapped_column(Integer, default=0)
    retest_tier: Mapped[str] = mapped_column(String(6), default="LOW")
    score_breakdown: Mapped[list] = mapped_column(JSON, default=list)
    assigned_doctor_id: Mapped[int | None] = mapped_column(ForeignKey("doctors.id"), nullable=True, index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    suppressed_reason: Mapped[str] = mapped_column(String(200), default="")
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    tried_doctor_ids: Mapped[list] = mapped_column(JSON, default=list)  # doctors the case already cascaded through
    call_later_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_followup_on: Mapped[date | None] = mapped_column(Date, nullable=True)  # set by the doctor
    retest_window_start: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    retest_window_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    reminder_on: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    reminder_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    treatment_anchor_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    retest_status: Mapped[str] = mapped_column(String(20), default="AUTO_SCHEDULED", index=True)
    protocol_tier: Mapped[str] = mapped_column(String(24), default="LONG_TERM", index=True)
    sla_escalated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    retest_plan: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class Consent(Base):
    __tablename__ = "consents"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    followup_id: Mapped[int | None] = mapped_column(ForeignKey("followups.id"), nullable=True, index=True)
    given_by_user: Mapped[int] = mapped_column(Integer)  # the staff member who took it
    channel: Mapped[str] = mapped_column(String(20))  # caller_call | doctor_call | family_link
    script_version: Mapped[str] = mapped_column(String(20), default="")  # which call card version was read out
    given_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class CallLog(Base):
    __tablename__ = "call_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    followup_id: Mapped[int] = mapped_column(ForeignKey("followups.id"), index=True)
    user_id: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String(10))
    outcome: Mapped[str] = mapped_column(String(20))
    adherence_code: Mapped[str] = mapped_column(String(20), default="")  # TAKING | MISSED | STOPPED
    symptom_code: Mapped[str] = mapped_column(String(20), default="")  # BETTER | SAME | WORSE
    notes: Mapped[str] = mapped_column(String(500), default="")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class Comment(Base):
    __tablename__ = "comments"
    id: Mapped[int] = mapped_column(primary_key=True)
    followup_id: Mapped[int] = mapped_column(ForeignKey("followups.id"), index=True)
    user_id: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String(10))
    text: Mapped[str] = mapped_column(String(1000))
    urgent: Mapped[bool] = mapped_column(Boolean, default=False)
    for_caller: Mapped[bool] = mapped_column(Boolean, default=True)  # doctor notes are hidden from callers unless marked
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # first read by a doctor
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Appointment(Base):
    __tablename__ = "appointments"
    id: Mapped[int] = mapped_column(primary_key=True)
    followup_id: Mapped[int] = mapped_column(ForeignKey("followups.id"), index=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("doctors.id"), index=True)
    slot_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)  # stored in UTC
    slot_end: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(10), default="BOOKED")  # BOOKED | DONE | CANCELLED


class HealthHub(Base, Stamped):
    """Physical diagnostic / consultation hubs (used for hub booking and KPI filtering)."""

    __tablename__ = "health_hubs"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    city: Mapped[str] = mapped_column(String(80), default="")
    address: Mapped[str] = mapped_column(String(300), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    opening_hours: Mapped[str] = mapped_column(String(120), default="07:00-19:00")


class RetestRecommendation(Base):
    __tablename__ = "retest_recommendations"
    id: Mapped[int] = mapped_column(primary_key=True)
    followup_id: Mapped[int] = mapped_column(ForeignKey("followups.id"), index=True)
    doctor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    test_codes: Mapped[list] = mapped_column(JSON, default=list)
    ordered: Mapped[bool] = mapped_column(Boolean, default=False)
    ordered_ref: Mapped[str] = mapped_column(String(60), default="")
    source: Mapped[str] = mapped_column(String(20), default="DOCTOR")  # DOCTOR | PROTOCOL
    next_test_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    window_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    window_end: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    reason_code: Mapped[str] = mapped_column(String(60), default="")
    reason_text_clinical: Mapped[str] = mapped_column(Text, default="")
    approved_by_doctor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    protocol_code: Mapped[str] = mapped_column(String(60), default="")
    protocol_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    previous_results_snapshot: Mapped[list] = mapped_column(JSON, default=list)
    tests: Mapped[list] = mapped_column(JSON, default=list)
    collection_mode: Mapped[str] = mapped_column(String(20), default="")  # "" | HOME | HEALTH_HUB
    health_hub_id: Mapped[int | None] = mapped_column(ForeignKey("health_hubs.id"), nullable=True, index=True)
    slot_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    address_enc: Mapped[str] = mapped_column(Text, default="")
    booking_status: Mapped[str] = mapped_column(String(20), default="NOT_BOOKED")  # NOT_BOOKED | BOOKED | COLLECTED | CANCELLED | NO_SHOW
    lab_order_ref: Mapped[str] = mapped_column(String(64), default="")
    comparison_report_id: Mapped[int | None] = mapped_column(ForeignKey("reports.id"), nullable=True)
    plan_status: Mapped[str] = mapped_column(String(24), default="PLANNED", index=True)  # PLANNED | COMPLETED_IN_WINDOW | COMPLETED_LATE
    completed_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    bundle_code: Mapped[str] = mapped_column(String(40), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    text: Mapped[str] = mapped_column(String(200))
    link: Mapped[str] = mapped_column(String(80), default="")
    urgent: Mapped[bool] = mapped_column(Boolean, default=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class StoredFile(Base):
    """Encrypted lab report bytes when STORAGE_BACKEND=db (hosts with no permanent disk)."""

    __tablename__ = "stored_files"
    name: Mapped[str] = mapped_column(String(80), primary_key=True)
    data: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class CallCard(Base):
    """AI-generated draft (retest scope + doctor script + caller script). Every edit or
    regeneration is a new immutable version; approval belongs to one version."""

    __tablename__ = "call_cards"
    __table_args__ = (UniqueConstraint("followup_id", "version"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    followup_id: Mapped[int] = mapped_column(ForeignKey("followups.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    language: Mapped[str] = mapped_column(String(12))
    content: Mapped[dict] = mapped_column(JSON)
    model: Mapped[str] = mapped_column(String(60))
    prompt_version: Mapped[str] = mapped_column(String(10))
    input_hash: Mapped[str] = mapped_column(String(64))
    validation_status: Mapped[str] = mapped_column(String(14))  # VALID | NEEDS_REVIEW
    validation_errors: Mapped[list] = mapped_column(JSON, default=list)
    notice: Mapped[str] = mapped_column(String(200), default="")  # e.g. language fallback
    edited_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    doctor_approved_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    doctor_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class IdentityReview(Base):
    __tablename__ = "identity_reviews"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_a_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))  # existing patient
    patient_b_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))  # provisional patient from the new report
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"))
    reason: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(10), default="PENDING", index=True)  # PENDING | SAME | DIFFERENT | UNMERGED
    moved_order_ids: Mapped[list] = mapped_column(JSON, default=list)  # lets a merge be undone
    decided_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ReportInsight(Base, Stamped):
    """Doctor-reviewed AI report insights (defects, suggestions, priority, future tests)."""
    __tablename__ = "report_insights"
    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("reports.id"), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="DRAFT", index=True)  # DRAFT | APPROVED | REJECTED
    content: Mapped[dict] = mapped_column(JSON)
    provider: Mapped[str] = mapped_column(String(40), default="template")
    model: Mapped[str] = mapped_column(String(60), default="")
    prompt_version: Mapped[str] = mapped_column(String(20), default="v1")
    input_hash: Mapped[str] = mapped_column(String(64), default="")
    validation_errors: Mapped[list] = mapped_column(JSON, default=list)
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CriticalRule(Base, Stamped):
    """Clinician-approved urgent criteria. Switched off, never deleted."""
    __tablename__ = "critical_rules"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    marker_code: Mapped[str] = mapped_column(String(40), index=True)
    label: Mapped[str] = mapped_column(String(120))
    comparator: Mapped[str] = mapped_column(String(4))  # < | <= | > | >=
    threshold: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(30))
    note: Mapped[str] = mapped_column(String(300), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    approved_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    approved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class CareTouchpoint(Base):
    """Longitudinal patient interactions across the 7 Holistic Health Loop stages."""

    __tablename__ = "care_touchpoints"
    __table_args__ = (UniqueConstraint("patient_id", "ref_entity", "ref_id", "stage", name="uq_care_touchpoint_ref"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    stage: Mapped[str] = mapped_column(String(30), index=True)
    service_code: Mapped[str] = mapped_column(String(60), default="")
    occurred_on: Mapped[date] = mapped_column(Date, index=True)
    source: Mapped[str] = mapped_column(String(10), default="AUTO")  # AUTO | MANUAL
    ref_entity: Mapped[str] = mapped_column(String(40), default="")
    ref_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    amount_inr: Mapped[int | None] = mapped_column(Integer, nullable=True)  # admin-only
    health_hub_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class HealthProfile(Base):
    """Encrypted non-lab clinical data (vitals, history, symptoms, lifestyle, reproductive, caregiver)."""

    __tablename__ = "health_profiles"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), unique=True, index=True)
    payload_enc: Mapped[str] = mapped_column(Text, default="")
    updated_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class ProgramRecommendation(Base):
    """Personalised programme recommendations per patient/report and doctor decisions."""

    __tablename__ = "program_recommendations"
    __table_args__ = (UniqueConstraint("report_id", "program_code", name="uq_program_rec_report_code"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    followup_id: Mapped[int | None] = mapped_column(ForeignKey("followups.id"), nullable=True, index=True)
    report_id: Mapped[int | None] = mapped_column(ForeignKey("reports.id"), nullable=True, index=True)
    program_code: Mapped[str] = mapped_column(String(50), index=True)
    rule_version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(20), default="SUGGESTED", index=True)
    rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    finding_code: Mapped[str] = mapped_column(String(40), default="")
    reason_codes: Mapped[list] = mapped_column(JSON, default=list)
    missing_data: Mapped[list] = mapped_column(JSON, default=list)
    notes: Mapped[list] = mapped_column(JSON, default=list)
    decided_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decline_reason_code: Mapped[str] = mapped_column(String(40), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class PatientMedication(Base, Stamped):
    """Patient medication history (doctor/admin only, dose and prescriber encrypted)."""

    __tablename__ = "patient_medications"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    medicine_code: Mapped[str] = mapped_column(String(50), index=True)
    dose_text_enc: Mapped[str] = mapped_column(Text, default="")
    started_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_changed_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    stopped_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    prescribed_by_enc: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(20), default="DOCTOR")  # DOCTOR | PATIENT_REPORTED


class RefillSchedule(Base):
    """Chronic medication refill reminders and delivery confirmation tracking."""

    __tablename__ = "refill_schedules"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_medication_id: Mapped[int] = mapped_column(ForeignKey("patient_medications.id"), unique=True, index=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    refill_every_days: Mapped[int] = mapped_column(Integer, default=30)
    next_refill_on: Mapped[date] = mapped_column(Date, index=True)
    delivery_mode: Mapped[str] = mapped_column(String(20), default="HOME_DELIVERY")  # HOME_DELIVERY | PICKUP_AT_HUB
    delivery_ref: Mapped[str] = mapped_column(String(60), default="")
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")  # ACTIVE | PAUSED | STOPPED
    reminder_sent_for: Mapped[date | None] = mapped_column(Date, nullable=True)
    task_status: Mapped[str] = mapped_column(String(16), default="")  # "" | DUE | DONE
    task_due_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class Referral(Base):
    """Specialist referrals created by doctors; callers see only neutral booking status."""

    __tablename__ = "referrals"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    followup_id: Mapped[int | None] = mapped_column(ForeignKey("followups.id"), nullable=True, index=True)
    specialty: Mapped[str] = mapped_column(String(60))
    reason_code: Mapped[str] = mapped_column(String(60), default="")
    urgency: Mapped[str] = mapped_column(String(16), default="ROUTINE")  # ROUTINE | SOON | URGENT
    status: Mapped[str] = mapped_column(String(16), default="SUGGESTED")  # SUGGESTED | BOOKED | DONE | DECLINED
    appointment_ref: Mapped[str] = mapped_column(String(80), default="")
    scheduled_for: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class HomeReading(Base):
    """Home health monitoring readings (BP, glucose, weight, SpO2)."""

    __tablename__ = "home_readings"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    kind: Mapped[str] = mapped_column(String(24), index=True)  # BP | GLUCOSE_FASTING | GLUCOSE_RANDOM | WEIGHT | SPO2
    values: Mapped[dict] = mapped_column(JSON, default=dict)
    taken_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    source: Mapped[str] = mapped_column(String(20), default="MANUAL_STAFF")  # MANUAL_STAFF | CSV_IMPORT | DEVICE
    entered_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class HomeVisit(Base):
    """Scheduled home visits for monitoring or caregiver support."""

    __tablename__ = "home_visits"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    purpose_code: Mapped[str] = mapped_column(String(40))
    scheduled_on: Mapped[date] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(20), default="SCHEDULED")  # SCHEDULED | DONE | CANCELLED
    staff_name: Mapped[str] = mapped_column(String(120), default="")
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class FamilyLink(Base):
    """Consent-gated family links across household members."""

    __tablename__ = "family_links"
    __table_args__ = (UniqueConstraint("patient_id", "related_patient_id", name="uq_family_link_pair"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    related_patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    relationship: Mapped[str] = mapped_column(String(40))
    consent_id: Mapped[int | None] = mapped_column(ForeignKey("consents.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class MonitoringSchedule(Base):
    """Non-lab home monitoring schedules (e.g. Hypertension home BP reminders)."""

    __tablename__ = "monitoring_schedules"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    condition_code: Mapped[str] = mapped_column(String(40), index=True)
    kind: Mapped[str] = mapped_column(String(24), default="BP")
    frequency_per_day: Mapped[int] = mapped_column(Integer, default=2)
    duration_days: Mapped[int] = mapped_column(Integer, default=7)
    start_on: Mapped[date] = mapped_column(Date, index=True)
    end_on: Mapped[date] = mapped_column(Date, index=True)
    slots: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE", index=True)  # ACTIVE | COMPLETED | CANCELLED
    note: Mapped[str] = mapped_column(String(300), default="")
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_reminded_on: Mapped[date | None] = mapped_column(Date, nullable=True)


class Payment(Base, Stamped):
    __tablename__ = "payments"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    amount_inr: Mapped[int] = mapped_column(Integer)
    method: Mapped[str] = mapped_column(String(20), default="CASH")  # CASH | UPI | CARD | COUNTER
    reference: Mapped[str] = mapped_column(String(60), default="")
    status: Mapped[str] = mapped_column(String(20), default="PAID", index=True)  # PAID | PENDING | REFUNDED
    health_hub_id: Mapped[int | None] = mapped_column(ForeignKey("health_hubs.id"), nullable=True, index=True)


class CarePlan(Base, Stamped):
    __tablename__ = "care_plans"
    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(10))
    code: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    line: Mapped[str] = mapped_column(String(80), default="")
    name_en: Mapped[str] = mapped_column(String(150))
    name_hi: Mapped[str] = mapped_column(String(150), default="")
    for_text: Mapped[str] = mapped_column(Text, default="")
    colour: Mapped[str] = mapped_column(String(30), default="blue")
    icon: Mapped[str] = mapped_column(String(50), default="")
    tiers: Mapped[list] = mapped_column(JSON, default=list)
    inclusions_plus: Mapped[list] = mapped_column(JSON, default=list)
    essential_covers: Mapped[str] = mapped_column(Text, default="")
    entitlements: Mapped[dict] = mapped_column(JSON, default=dict)
    tracked_measures: Mapped[list] = mapped_column(JSON, default=list)
    charged_separately: Mapped[list] = mapped_column(JSON, default=list)
    footnote: Mapped[str] = mapped_column(Text, default="")
    qr_url: Mapped[str] = mapped_column(String(200), default="")
    linked_programs: Mapped[list] = mapped_column(JSON, default=list)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class PlanEnrollment(Base, Stamped):
    __tablename__ = "plan_enrollments"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    plan_code: Mapped[str] = mapped_column(String(60), ForeignKey("care_plans.code"), index=True)
    tier: Mapped[str] = mapped_column(String(20), default="PLUS")  # ESSENTIAL | PLUS | PROGRAMME
    status: Mapped[str] = mapped_column(String(30), default="SUGGESTED", index=True)  # SUGGESTED | DOCTOR_ASSESSED | ENROLLED | ACTIVE | RENEWAL_DUE | ENDED | DECLINED | NOT_ELIGIBLE
    health_hub_id: Mapped[int | None] = mapped_column(ForeignKey("health_hubs.id"), nullable=True, index=True)
    assessed_by_doctor_id: Mapped[int | None] = mapped_column(ForeignKey("doctors.id"), nullable=True, index=True)
    assessed_on: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    eligibility_note_code: Mapped[str] = mapped_column(String(60), default="")
    period_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_end: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    price_inr: Mapped[int] = mapped_column(Integer, default=0)
    payment_id: Mapped[int | None] = mapped_column(ForeignKey("payments.id"), nullable=True, index=True)
    entitlements_used: Mapped[dict] = mapped_column(JSON, default=dict)
    last_reminded_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    note: Mapped[str] = mapped_column(String(200), default="")
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ClinicalTask(Base):
    """Doctor tasks spawned by protocols (e.g. choosing lab tests for Hypertension)."""

    __tablename__ = "clinical_tasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    followup_id: Mapped[int | None] = mapped_column(ForeignKey("followups.id"), nullable=True, index=True)
    condition_code: Mapped[str] = mapped_column(String(40), index=True)
    task_type: Mapped[str] = mapped_column(String(40), default="CHOOSE_LAB_TESTS")
    title: Mapped[str] = mapped_column(String(160))
    details: Mapped[str] = mapped_column(String(300), default="")
    selected_tests: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(20), default="OPEN", index=True)  # OPEN | DONE | DISMISSED
    assigned_doctor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completed_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class CareJourney(Base):
    """Scheduled Day 0 -> Day 92 follow-up journey instance per abnormal follow-up/condition group (Page 8)."""

    __tablename__ = "care_journeys"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    followup_id: Mapped[int | None] = mapped_column(ForeignKey("followups.id"), nullable=True, index=True)
    condition_group: Mapped[str] = mapped_column(String(40), default="GENERAL", index=True)
    template_code: Mapped[str] = mapped_column(String(40), default="STANDARD_92", index=True)
    template_version: Mapped[int] = mapped_column(Integer, default=1)
    started_on: Mapped[date] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE", index=True)  # ACTIVE | COMPLETED | STOPPED
    stop_reason: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class JourneyStep(Base):
    """Individual scheduled milestones (D0 -> D92) inside a CareJourney."""

    __tablename__ = "journey_steps"
    id: Mapped[int] = mapped_column(primary_key=True)
    journey_id: Mapped[int] = mapped_column(ForeignKey("care_journeys.id"), index=True)
    step_order: Mapped[int] = mapped_column(Integer, default=0)
    step_code: Mapped[str] = mapped_column(String(40), index=True)
    due_on: Mapped[date] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(20), default="PENDING", index=True)  # PENDING | DUE | DONE | SKIPPED | OVERDUE
    completed_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    completed_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_event: Mapped[str] = mapped_column(String(80), default="")
    task_ref: Mapped[str] = mapped_column(String(80), default="")
    waiting_for_data: Mapped[bool] = mapped_column(Boolean, default=False)


class OutboundMessage(Base):
    """Consent- and quiet-hours-guarded patient messaging audit log (Page 8)."""

    __tablename__ = "outbound_messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    followup_id: Mapped[int | None] = mapped_column(ForeignKey("followups.id"), nullable=True, index=True)
    journey_step_id: Mapped[int | None] = mapped_column(ForeignKey("journey_steps.id"), nullable=True, index=True)
    template_code: Mapped[str] = mapped_column(String(40), index=True)
    language: Mapped[str] = mapped_column(String(16), default="en")
    channel: Mapped[str] = mapped_column(String(20), default="CALL_TASK")  # WHATSAPP | SMS | CALL_TASK
    status: Mapped[str] = mapped_column(String(30), default="QUEUED", index=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    provider_ref: Mapped[str] = mapped_column(String(120), default="")
    error: Mapped[str] = mapped_column(String(240), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
