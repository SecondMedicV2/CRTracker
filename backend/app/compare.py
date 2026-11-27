"""AMI Parameter Display comparison service and clinical target evaluation (Page 10)."""
from datetime import date, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import analysis, biomarkers, programs as prog_svc, relationship as rel, status as ord_status, trends as trends_svc
from .analysis import load_rules
from .models import Order, Patient, Report, ReportParameter
from .seed_data import CLINICAL_TARGETS, NEXT_ACTION_RULES
from .timeutil import to_ist_date
from .units import same_unit


def _syn_keys(code: str) -> list[str]:
    u = (code or "").strip().upper()
    if not u:
        return []
    group = prog_svc.SYNONYMS.get(u)
    return [u, *[x for x in sorted(group) if x != u]] if group else [u]


def _group_key(code: str, raw_name: str) -> str:
    u = (code or "").strip().upper()
    if not u and raw_name:
        u = biomarkers.marker_code(raw_name)
    if u in prog_svc.SYNONYMS:
        return sorted(prog_svc.SYNONYMS[u])[0]
    return u or (raw_name or "").strip().upper()


def _units_match(a: str | None, b: str | None) -> bool:
    xa, xb = (a or "").strip(), (b or "").strip()
    if not xa and not xb:
        return True
    return same_unit(xa, xb)


def _fmt_num(val: float) -> str:
    r = round(float(val), 3)
    if abs(r) < 1e-9:
        return "0"
    if abs(r - round(r)) < 1e-9:
        return str(int(round(r)))
    return f"{r:.3f}".rstrip("0").rstrip(".")


def _fmt_signed_abs(delta: float, unit: str) -> str:
    if abs(delta) < 1e-9:
        return "0 percentage points" if unit.strip() == "%" else (f"0 {unit}".strip())
    sign = "\u2212" if delta < 0 else "+"
    mag = _fmt_num(abs(delta))
    if unit.strip() == "%":
        return f"{sign}{mag} percentage points"
    return f"{sign}{mag} {unit}".strip()


def _fmt_signed_pct(pct: float | None) -> str:
    if pct is None:
        return ""
    if abs(pct) < 1e-9:
        return "0%"
    sign = "\u2212" if pct < 0 else "+"
    return f"{sign}{_fmt_num(abs(pct))}%"


def _resolve_target(code: str, gender: str, rules: dict, profile: dict, param: ReportParameter) -> dict[str, Any]:
    keys = _syn_keys(code)
    p_targets = (profile or {}).get("targets") or {}
    spec = None
    source = ""
    for k in keys:
        if isinstance(p_targets.get(k), dict):
            spec = dict(p_targets[k])
            source = "patient_override"
            break
    if spec is None:
        r_targets = rules.get("clinical_targets") or CLINICAL_TARGETS
        for k in keys:
            if isinstance(r_targets.get(k), dict):
                spec = dict(r_targets[k])
                source = "rule_set"
                break

    if spec is not None:
        direction = str(spec.get("direction") or "").upper()
        op = str(spec.get("target_op") or "").strip().upper()
        t_val = spec.get("target_value")
        if gender == "F" and spec.get("target_value_f") is not None:
            t_val = spec["target_value_f"]
        t_low = spec.get("target_low")
        t_high = spec.get("target_high")
        if not direction:
            if op == "RANGE" or (t_low is not None and t_high is not None):
                direction = "RANGE"
            elif op in (">", ">="):
                direction = "HIGHER_IS_BETTER"
            else:
                direction = "LOWER_IS_BETTER"
        if not op:
            op = "RANGE" if direction == "RANGE" else (">=" if direction == "HIGHER_IS_BETTER" else "<")
        min_mc = float(spec.get("min_meaningful_change") or 0.0)
        # Preserve rule_set's min_meaningful_change if a patient override only set target_value
        if source == "patient_override" and spec.get("min_meaningful_change") is None:
            r_targets = rules.get("clinical_targets") or CLINICAL_TARGETS
            for k in keys:
                if isinstance(r_targets.get(k), dict) and r_targets[k].get("min_meaningful_change") is not None:
                    min_mc = float(r_targets[k]["min_meaningful_change"])
                    break
        return {
            "source": source,
            "direction": direction,
            "target_op": op,
            "target_value": float(t_val) if t_val is not None else None,
            "target_low": float(t_low) if t_low is not None else None,
            "target_high": float(t_high) if t_high is not None else None,
            "min_meaningful_change": min_mc,
            "unit": str(spec.get("unit") or param.unit or ""),
        }

    # Fallback to report's reference range or admin reference_ranges rule set
    lo, hi = param.ref_low, param.ref_high
    if lo is None and hi is None and param.ref_text:
        rng = analysis.parse_range(param.ref_text)
        if rng:
            lo, hi = rng[0], rng[1]
    if lo is None and hi is None:
        r_spec = None
        ranges = rules.get("reference_ranges") or {}
        for k in keys:
            if k in ranges:
                r_spec = ranges[k]
                break
        if r_spec:
            if "low_below" in r_spec:
                thr = r_spec["low_below"].get(gender)
                if thr is not None:
                    lo = float(thr)
            else:
                norm = next((b for b in r_spec.get("bands", []) if b[0] in analysis.NORMAL_LABELS), None)
                if norm:
                    lo, hi = norm[1], norm[2]

    if lo is not None and hi is not None:
        return {"source": "reference_range", "direction": "RANGE", "target_op": "RANGE",
                "target_value": None, "target_low": float(lo), "target_high": float(hi),
                "min_meaningful_change": 0.0, "unit": param.unit or ""}
    if hi is not None:
        return {"source": "reference_range", "direction": "LOWER_IS_BETTER", "target_op": "<=",
                "target_value": float(hi), "target_low": None, "target_high": None,
                "min_meaningful_change": 0.0, "unit": param.unit or ""}
    if lo is not None:
        return {"source": "reference_range", "direction": "HIGHER_IS_BETTER", "target_op": ">=",
                "target_value": float(lo), "target_low": None, "target_high": None,
                "min_meaningful_change": 0.0, "unit": param.unit or ""}
    return {"source": "none", "direction": "LOWER_IS_BETTER", "target_op": "",
            "target_value": None, "target_low": None, "target_high": None,
            "min_meaningful_change": 0.0, "unit": param.unit or ""}


def _target_display(tgt: dict) -> str:
    u = f" {tgt['unit']}" if tgt.get("unit") and tgt["unit"] != "%" else ("%" if tgt.get("unit") == "%" else "")
    if tgt["direction"] == "RANGE" and tgt.get("target_low") is not None and tgt.get("target_high") is not None:
        return f"{_fmt_num(tgt['target_low'])}\u2013{_fmt_num(tgt['target_high'])}{u}"
    if tgt.get("target_value") is not None and tgt.get("target_op"):
        return f"{tgt['target_op']} {_fmt_num(tgt['target_value'])}{u}"
    return "\u2014"


def _eval_target_status(val: float | None, tgt: dict, system_flag: str = "") -> str | None:
    if val is None:
        return None
    d = tgt["direction"]
    op = tgt["target_op"]
    tv = tgt["target_value"]
    lo, hi = tgt.get("target_low"), tgt.get("target_high")
    if d == "RANGE":
        if lo is not None and val < lo:
            return "Below target"
        if hi is not None and val > hi:
            return "Above target"
        if lo is not None or hi is not None:
            return "At target"
    elif d == "HIGHER_IS_BETTER" and tv is not None:
        if hi is not None and val > hi:
            return "Above target"
        return "At target" if prog_svc._cmp(val, op, tv) else "Below target"
    elif d == "LOWER_IS_BETTER" and tv is not None:
        if not prog_svc._cmp(val, op, tv):
            return "Above target"
        if lo is not None and val < lo:
            return "Below target"
        return "At target"
    if system_flag == "HIGH":
        return "Above target"
    if system_flag == "LOW":
        return "Below target"
    if system_flag == "NORMAL":
        return "At target"
    return None


def _range_distance(val: float, lo: float | None, hi: float | None) -> float:
    if lo is not None and val < lo:
        return lo - val
    if hi is not None and val > hi:
        return val - hi
    return 0.0


def _eval_change_status(prev_val: float, curr_val: float, tgt: dict) -> str:
    delta = round(curr_val - prev_val, 3)
    min_mc = float(tgt.get("min_meaningful_change") or 0.0)
    if abs(delta) < (min_mc if min_mc > 0 else 0.001):
        return "No meaningful change"
    d = tgt["direction"]
    if d == "HIGHER_IS_BETTER":
        return "Improved" if delta > 0 else "Worsened"
    if d == "RANGE":
        d_prev = _range_distance(prev_val, tgt.get("target_low"), tgt.get("target_high"))
        d_curr = _range_distance(curr_val, tgt.get("target_low"), tgt.get("target_high"))
        if abs(d_curr - d_prev) < 1e-6:
            return "No meaningful change"
        return "Improved" if d_curr < d_prev else "Worsened"
    return "Improved" if delta < 0 else "Worsened"


def _eval_trend(pts: list[trends_svc.TrendPoint], curr_unit: str | None, tgt: dict) -> str | None:
    same_unit_pts = [p for p in pts if p.value is not None and _units_match(p.unit, curr_unit)]
    if len(same_unit_pts) < 3:
        return None
    window = same_unit_pts[-3:]
    first_v, last_v = window[0].value, window[-1].value
    if first_v is None or last_v is None:
        return None
    net = round(last_v - first_v, 3)
    min_mc = float(tgt.get("min_meaningful_change") or 0.0)
    if abs(net) < (min_mc if min_mc > 0 else 0.001):
        return "Stable"
    d = tgt["direction"]
    if d == "HIGHER_IS_BETTER":
        return "Positive trend" if net > 0 else "Negative trend"
    if d == "RANGE":
        d0 = _range_distance(first_v, tgt.get("target_low"), tgt.get("target_high"))
        d1 = _range_distance(last_v, tgt.get("target_low"), tgt.get("target_high"))
        if abs(d1 - d0) < 1e-6:
            return "Stable"
        return "Positive trend" if d1 < d0 else "Negative trend"
    return "Positive trend" if net < 0 else "Negative trend"


def _eval_next_action(rules: dict, target_status: str | None, change_status: str | None) -> str:
    action_rules = rules.get("next_action_rules") or NEXT_ACTION_RULES
    for r in action_rules:
        if not isinstance(r, dict):
            continue
        rt = r.get("target_status")
        rc = r.get("change_status")
        if (rt is None or rt == target_status) and (rc is None or rc == change_status):
            return str(r.get("next_action") or "Individualized")
    return "Individualized"


def _patient_summary_line(row: dict) -> str:
    label = row["label"]
    unit = row["unit"]
    if row["units_differ"]:
        return f"Your {label} was measured in different units across reports and was not compared directly. Discuss this with your doctor."
    if row["previous"] is None:
        t_part = f" ({row['target_status'].lower()})" if row["target_status"] else ""
        return f"Your current {label} is {_fmt_num(row['current'])} {unit}{t_part}. Next step: {row['next_action'].lower()}."
    t_part = f" It is {row['target_status'].lower()}" if row["target_status"] else ""
    tgt_hint = f" (target {row['target_display']})" if row.get("target_display") and row["target_display"] != "\u2014" else ""
    c_part = f" and showed {row['change_status'].lower()}" if row["change_status"] else ""
    u_sfx = f" {unit}" if unit else ""
    return (
        f"Your {label} moved from {_fmt_num(row['previous'])}{u_sfx} to {_fmt_num(row['current'])}{u_sfx} "
        f"({row['change_display']}).{t_part}{tgt_hint}{c_part}. Next step: {row['next_action']}."
    )


def _patient_reports_up_to(db: Session, patient_id: int, report: Report) -> list[tuple[Report, Order]]:
    root = rel.canonical_patient_id(db, patient_id)
    pids = [root, *db.scalars(select(Patient.id).where(Patient.merged_into_id == root))]
    rows = db.execute(
        select(Report, Order).join(Order, Order.id == Report.order_id)
        .where(Order.patient_id.in_(pids), Order.status == ord_status.READY)
        .order_by(Report.collected_on.asc(), Report.id.asc())
    ).all()
    if report.collected_on is not None:
        cutoff = report.collected_on
        rows = [
            (r, o) for r, o in rows
            if r.id == report.id or (r.collected_on is not None and (r.collected_on < cutoff or (r.collected_on == cutoff and r.id <= report.id)))
        ]
    else:
        rows = [(r, o) for r, o in rows if r.id <= report.id]
    if not any(r.id == report.id for r, _ in rows):
        ord_row = db.get(Order, report.order_id)
        if ord_row:
            rows.append((report, ord_row))
            rows.sort(key=lambda pair: (pair[0].collected_on or datetime.min, pair[0].id))
    return rows


def has_comparison(db: Session, patient_id: int, report_id: int) -> bool:
    """Fast check for caller views: True iff an earlier READY report shares at least one marker with report_id."""
    report = db.get(Report, report_id)
    if not report:
        return False
    cur_codes = {_group_key(p.param_code, p.param_name_raw) for p in db.scalars(select(ReportParameter).where(ReportParameter.report_id == report_id)) if p.param_code or p.param_name_raw}
    if not cur_codes:
        return False
    reps = [r.id for r, _ in _patient_reports_up_to(db, patient_id, report) if r.id != report_id]
    if not reps:
        return False
    prior_params = db.scalars(select(ReportParameter).where(ReportParameter.report_id.in_(reps))).all()
    return any(_group_key(p.param_code, p.param_name_raw) in cur_codes and p.value_num is not None for p in prior_params)


def compare(db: Session, patient_id: int, report_id: int) -> list[dict]:
    """Compare parameters in report_id against the patient's most recent previous READY report per marker."""
    report = db.get(Report, report_id)
    if not report:
        return []
    root = rel.canonical_patient_id(db, patient_id)
    patient = db.get(Patient, root)
    if not patient:
        return []
    rep_pairs = _patient_reports_up_to(db, root, report)
    rep_ids = [r.id for r, _ in rep_pairs]
    rep_dates = {
        r.id: to_ist_date(r.collected_on or o.collected_on or r.reported_on or o.reported_on).isoformat()
        for r, o in rep_pairs
    }
    params_all = list(db.scalars(
        select(ReportParameter).where(ReportParameter.report_id.in_(rep_ids)).order_by(ReportParameter.report_id, ReportParameter.id)
    ))
    by_rep: dict[int, list[ReportParameter]] = {rid: [] for rid in rep_ids}
    for p in params_all:
        by_rep.setdefault(p.report_id, []).append(p)

    series_by_key: dict[str, list[trends_svc.TrendPoint]] = {}
    for rid in rep_ids:
        dt = rep_dates.get(rid, "")
        for p in by_rep.get(rid, []):
            if p.value_num is None:
                continue
            gkey = _group_key(p.param_code, p.param_name_raw)
            series_by_key.setdefault(gkey, []).append(trends_svc.TrendPoint(
                date=dt, value=float(p.value_num), value_text=p.value_text or _fmt_num(p.value_num),
                unit=p.unit or "", ref_text=p.ref_text, ref_low=p.ref_low, ref_high=p.ref_high,
                status="HIGH" if p.system_flag == "HIGH" else "LOW" if p.system_flag == "LOW" else "IN_RANGE",
                report_id=rid,
            ))

    rules = load_rules(db)
    profile, _, _ = prog_svc.get_profile(db, root)
    gender = report.gender or patient.gender or ""
    rows: list[dict] = []
    seen_groups: set[str] = set()

    for p in by_rep.get(report_id, []):
        if p.value_num is None:
            continue
        gkey = _group_key(p.param_code, p.param_name_raw)
        if gkey in seen_groups:
            continue
        seen_groups.add(gkey)

        code = (p.param_code or gkey).upper()
        pts = series_by_key.get(gkey, [])
        # Reuse trends.compute_marker_trend for canonical label / direction / unit awareness
        trend_obj = trends_svc.compute_marker_trend(code, p.param_name_raw, pts)
        curr_pt = pts[-1]
        prev_pts = [x for x in pts[:-1] if x.report_id != report_id]
        prev_pt = prev_pts[-1] if prev_pts else None

        tgt = _resolve_target(code, gender, rules, profile, p)
        tgt_status = _eval_target_status(float(p.value_num), tgt, p.system_flag or "")
        unit = p.unit or ""

        units_differ = bool(prev_pt and not _units_match(prev_pt.unit, unit))
        if prev_pt is None:
            change_abs = None
            change_pct = None
            change_display = "\u2014"
            change_pct_display = ""
            change_status = None
        elif units_differ:
            change_abs = None
            change_pct = None
            change_display = "Units differ \u2014 not compared"
            change_pct_display = ""
            change_status = "Units differ \u2014 not compared"
        else:
            delta = round(float(p.value_num) - float(prev_pt.value), 3)
            pct = round((delta / abs(float(prev_pt.value))) * 100.0, 1) if prev_pt.value else None
            change_abs = delta
            change_pct = pct
            change_display = _fmt_signed_abs(delta, unit)
            change_pct_display = _fmt_signed_pct(pct)
            change_status = _eval_change_status(float(prev_pt.value), float(p.value_num), tgt)

        trend_label = _eval_trend(pts, unit, tgt) if not units_differ else None
        next_act = _eval_next_action(rules, tgt_status, change_status)
        spark_pts = [
            {"date": x.date, "value": x.value, "unit": x.unit, "report_id": x.report_id, "flag": x.status}
            for x in pts if x.value is not None and _units_match(x.unit, unit)
        ]

        row = {
            "param_code": code,
            "label": trend_obj.label or biomarkers.marker_label(code, p.param_name_raw),
            "previous": float(prev_pt.value) if prev_pt and prev_pt.value is not None else None,
            "previous_unit": prev_pt.unit if prev_pt else "",
            "previous_date": prev_pt.date if prev_pt else None,
            "previous_report_id": prev_pt.report_id if prev_pt else None,
            "current": float(p.value_num),
            "current_unit": unit,
            "current_date": rep_dates.get(report_id),
            "unit": unit,
            "units_differ": units_differ,
            "change_abs": change_abs,
            "change_pct": change_pct,
            "change_display": change_display,
            "change_pct_display": change_pct_display,
            "target_display": _target_display(tgt),
            "target_op": tgt["target_op"],
            "target_value": tgt["target_value"],
            "target_low": tgt["target_low"],
            "target_high": tgt["target_high"],
            "direction": tgt["direction"],
            "min_meaningful_change": tgt["min_meaningful_change"],
            "target_source": tgt["source"],
            "target_status": tgt_status,
            "change_status": change_status,
            "trend": trend_label,
            "points_count": len(spark_pts),
            "next_action": next_act,
            "system_flag": p.system_flag or "",
            "is_abnormal": (p.system_flag in ("LOW", "HIGH")) or (tgt_status in ("Above target", "Below target")),
            "sparkline": spark_pts,
        }
        row["patient_summary_line"] = _patient_summary_line(row)
        rows.append(row)
    return rows
