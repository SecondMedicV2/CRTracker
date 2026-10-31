from datetime import date, datetime, timezone

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, LargeBinary, String, UniqueConstraint
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
    role: Mapped[str] = mapped_column(String(10))  # ADMIN | CALLER | DOCTOR
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


class Consent(Base):
    __tablename__ = "consents"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    followup_id: Mapped[int] = mapped_column(ForeignKey("followups.id"), index=True)
    given_by_user: Mapped[int] = mapped_column(Integer)  # the staff member who took it
    channel: Mapped[str] = mapped_column(String(12))  # caller_call | doctor_call
    script_version: Mapped[str] = mapped_column(String(20), default="")  # which call card version was read out
    given_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class CallLog(Base):
    __tablename__ = "call_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    followup_id: Mapped[int] = mapped_column(ForeignKey("followups.id"), index=True)
    user_id: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String(10))
    outcome: Mapped[str] = mapped_column(String(20))
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


class RetestRecommendation(Base):
    __tablename__ = "retest_recommendations"
    id: Mapped[int] = mapped_column(primary_key=True)
    followup_id: Mapped[int] = mapped_column(ForeignKey("followups.id"), index=True)
    doctor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    test_codes: Mapped[list] = mapped_column(JSON, default=list)
    ordered: Mapped[bool] = mapped_column(Boolean, default=False)
    ordered_ref: Mapped[str] = mapped_column(String(60), default="")
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
