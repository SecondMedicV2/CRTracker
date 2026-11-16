"""FETCHED -> EXTRACTING -> (NEEDS_REVIEW | EXTRACTED -> ANALYSED -> READY), or FAILED_EXTRACT."""
import json

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from . import followup, identity, status, storage
from .analysis import analyse, load_rules
from .extract import ExtractError, build_report, pdf_to_data
from .models import Order, Report, ReportParameter
from .settings_store import get_setting


def conclude(db: Session, order: Order, report: Report) -> None:
    """EXTRACTED -> ANALYSED -> READY, unless the patient identity needs a human decision first."""
    status.move(order, status.EXTRACTED)
    status.move(order, status.ANALYSED)
    held = identity.resolve(db, order, report) == "pending"
    status.move(order, status.PENDING_IDENTITY if held else status.READY)
    if not held:
        followup.build(db, order)
        try:
            from . import ai_insights
            ai_insights.generate_insight_for_report(db, report)
        except Exception:
            pass  # retryable on failure, idempotent


def extract_order(db: Session, order: Order) -> None:
    oid = order.id
    status.move(order, status.EXTRACTING)
    db.commit()
    try:
        raw = storage.load(order.report_path)
        data = json.loads(raw) if order.report_kind == "json" else pdf_to_data(raw)
        rules = load_rules(db)
        old = db.scalar(select(Report).where(Report.order_id == oid))
        if old:  # re-run after retry: replace, never duplicate
            db.execute(delete(ReportParameter).where(ReportParameter.report_id == old.id))
            db.delete(old)
            db.flush()
        report, params = build_report(order, data, rules, get_setting(db, "extraction_min_confidence_pct"))
        db.add(report)
        db.flush()
        for p in params:
            p.report_id = report.id
        db.add_all(params)
        analyse(report, params, rules)  # flags are shown to the reviewer too
        order.error = ""
        if report.needs_review:
            status.move(order, status.NEEDS_REVIEW)
        else:
            conclude(db, order, report)
        db.commit()
    except Exception as e:
        db.rollback()
        order = db.get(Order, oid)
        # only ExtractError text is safe to show; anything else may carry patient data
        order.error = (str(e) if isinstance(e, ExtractError) else f"Unexpected error ({type(e).__name__})")[:400]
        status.move(order, status.FAILED_EXTRACT)
        db.commit()


def approve_review(db: Session, order: Order, report: Report) -> None:
    """After a human fixed the extraction: re-flag and continue the pipeline."""
    params = db.scalars(select(ReportParameter).where(ReportParameter.report_id == report.id)).all()
    analyse(report, params, load_rules(db))
    report.needs_review = False
    conclude(db, order, report)
    db.commit()
