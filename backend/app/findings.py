"""10 diagnostic findings & ranked Primary -> Secondary -> Third recommendation sets (Page 6)."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import programs as prog_svc, relationship as rel, status as ord_status
from .analysis import load_rules
from .models import Followup, Order, Patient, ProgramRecommendation, Report, RuleSet

SEVERITY_WEIGHT = {"severe": 3, "moderate": 2, "mild": 1, "": 0}
SERVICE_LOOP_STAGE = {
    "RETEST": "DIAGNOSTICS",
    "LIFESTYLE_MONITORING": "ONGOING_MONITORING",
    "DIETITIAN_CONSULT": "EATING_WELL",
    "INTEGRATED_CHRONIC_CARE": "CHRONIC_CONDITIONS",
    "SCREENING_SCHEDULE": "PREVENTION",
}


def _severity_key(f_rule: dict, ctx: dict, idx: int) -> tuple:
    if f_rule["code"] == "MULTI_CHRONIC":
        chronic = {b for b in ctx["buckets"] if b != "OTHER"} | {
            c.get("code") for c in ctx["profile"].get("conditions", []) if c.get("status") == "CONFIRMED"
        }
        return (-1, -len(chronic), idx)
    max_sev, max_dev = 0, 0.0
    for m in f_rule.get("severity_markers", []):
        for p in prog_svc._matching_labs(ctx["labs"], m):
            if p.system_flag in ("LOW", "HIGH"):
                max_sev = max(max_sev, SEVERITY_WEIGHT.get(p.severity or "", 0))
                max_dev = max(max_dev, float(p.deviation_pct or 0.0))
    return (-max_sev, -max_dev, idx)


def detect(db: Session, patient_id: int, report_id: int | None = None, *, _ctx: dict | None = None) -> list[str]:
    """Detects the shared 10 diagnostic findings for a patient/report, ordered by severity."""
    root = rel.canonical_patient_id(db, patient_id)
    patient = db.get(Patient, root)
    if not patient:
        return []
    report = db.get(Report, report_id) if report_id else None
    if report is None:
        _, pids = rel.patient_family_ids(db, root)
        report = db.scalar(
            select(Report).join(Order, Order.id == Report.order_id)
            .where(Order.patient_id.in_(pids), Order.status == ord_status.READY)
            .order_by(Report.collected_on.desc(), Report.id.desc()).limit(1)
        )
    ctx = _ctx or prog_svc._build_context(db, patient, report)
    findings = load_rules(db).get("diagnostic_findings", [])
    hits = []
    for idx, f_rule in enumerate(findings):
        ok, _, _ = prog_svc._eval_node(f_rule.get("trigger") or {}, ctx)
        if ok:
            hits.append((_severity_key(f_rule, ctx, idx), f_rule["code"]))
    hits.sort(key=lambda x: x[0])
    codes = [code for _, code in hits]
    if report:
        fu = db.scalar(select(Followup).where(Followup.report_id == report.id))
        if fu:
            fu.finding_codes = codes
    return codes


def _if_prescribed_ok(spec: dict, ctx: dict, med_cat: dict[str, dict]) -> bool:
    if spec.get("condition") != "IF_PRESCRIBED":
        return True
    active = ctx.get("active_meds") or []
    req_classes = set(spec.get("drug_classes") or [])
    if not req_classes:
        return len(active) > 0
    return any(med_cat.get(m.medicine_code, {}).get("drug_class") in req_classes for m in active)


def sync_combinations(db: Session, patient_id: int, report_id: int | None = None, *, commit: bool = False) -> list[str]:
    """Writes/merges ranked Primary->Secondary->Third combinations into program_recommendations."""
    root = rel.canonical_patient_id(db, patient_id)
    patient = db.get(Patient, root)
    if not patient:
        return []
    report = db.get(Report, report_id) if report_id else None
    if report is None:
        _, pids = rel.patient_family_ids(db, root)
        report = db.scalar(
            select(Report).join(Order, Order.id == Report.order_id)
            .where(Order.patient_id.in_(pids), Order.status == ord_status.READY)
            .order_by(Report.collected_on.desc(), Report.id.desc()).limit(1)
        )
    rid = report.id if report else None
    fu = db.scalar(select(Followup).where(Followup.report_id == rid)) if rid else None
    ctx = prog_svc._build_context(db, patient, report)
    codes = detect(db, root, rid, _ctx=ctx)

    rules = load_rules(db)
    combos = rules.get("recommendation_combinations", {})
    med_cat = {m["code"]: m for m in rules.get("medicine_catalogue", [])}
    rs = db.scalar(select(RuleSet).where(RuleSet.key == "recommendation_combinations", RuleSet.active).order_by(RuleSet.version.desc()))
    combo_ver = rs.version if rs else 1

    merged: dict[str, tuple[int, str]] = {}
    for f_code in codes:
        c_def = combos.get(f_code) or {}
        for rank, slot in ((1, "primary"), (2, "secondary"), (3, "third")):
            spec = c_def.get(slot)
            if not spec or not _if_prescribed_ok(spec, ctx, med_cat):
                continue
            target = spec["target"]
            cur = merged.get(target)
            if cur is None or rank < cur[0]:
                merged[target] = (rank, f_code)

    q = select(ProgramRecommendation).where(ProgramRecommendation.patient_id == root)
    q = q.where(ProgramRecommendation.report_id == rid) if rid is not None else q.where(ProgramRecommendation.report_id.is_(None))
    existing = {r.program_code: r for r in db.scalars(q)}

    for target, (rank, f_code) in merged.items():
        if target in existing:
            rec = existing[target]
            if rec.rank is None or rank < rec.rank or not rec.finding_code:
                rec.rank = min(rec.rank, rank) if rec.rank is not None else rank
                rec.finding_code = f_code
            if fu and not rec.followup_id:
                rec.followup_id = fu.id
        else:
            db.add(ProgramRecommendation(
                patient_id=root, followup_id=fu.id if fu else None, report_id=rid,
                program_code=target, rule_version=combo_ver, status="SUGGESTED",
                rank=rank, finding_code=f_code, reason_codes=[f"finding:{f_code}"],
            ))

    if commit:
        db.commit()
    else:
        db.flush()
    return codes


def combinations_for_followup(db: Session, fid: int) -> dict:
    f = db.get(Followup, fid)
    if not f:
        return {"followup_id": fid, "finding_codes": [], "combinations": []}
    root = rel.canonical_patient_id(db, f.patient_id)
    patient = db.get(Patient, root)
    report = db.get(Report, f.report_id)
    ctx = prog_svc._build_context(db, patient, report)
    rules = load_rules(db)
    f_map = {x["code"]: x for x in rules.get("diagnostic_findings", [])}
    combos = rules.get("recommendation_combinations", {})
    med_cat = {m["code"]: m for m in rules.get("medicine_catalogue", [])}

    codes = f.finding_codes if isinstance(f.finding_codes, list) and f.finding_codes else detect(db, root, f.report_id, _ctx=ctx)
    recs = {
        r.program_code: r for r in db.scalars(
            select(ProgramRecommendation).where(ProgramRecommendation.patient_id == root, ProgramRecommendation.report_id == f.report_id)
        )
    }

    rows = []
    for code in codes:
        meta = f_map.get(code, {})
        c_def = combos.get(code) or {}
        row = {"finding_code": code, "finding_label": meta.get("label", code), "icon": meta.get("icon", "•")}
        for rank, slot in ((1, "primary"), (2, "secondary"), (3, "third")):
            spec = c_def.get(slot)
            if not spec or not _if_prescribed_ok(spec, ctx, med_cat):
                row[slot] = None
                continue
            target = spec["target"]
            rec = recs.get(target)
            row[slot] = {
                "recommendation_id": rec.id if rec else None,
                "target": target,
                "label": spec["label"],
                "condition": spec.get("condition", "ALWAYS"),
                "status": rec.status if rec else "SUGGESTED",
                "rank": rank,
                "effective_rank": rec.rank if rec else rank,
                "owner_finding": rec.finding_code if rec else code,
            }
        rows.append(row)
    return {"followup_id": f.id, "finding_codes": codes, "combinations": rows}
