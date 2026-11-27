"""Health profiles & deterministic programme recommendation engine (Pages 2-4)."""
import json
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from . import assign, extended as ext, relationship as rel, status as ord_status, storage
from .analysis import NORMAL_LABELS, load_rules
from .models import (CareTouchpoint, Followup, HealthProfile, HomeReading, Order, Patient, PatientBucket,
                     PatientMedication, ProgramRecommendation, Referral, Report, ReportParameter, RetestRecommendation)
from .timeutil import IST, today_ist

# Bridges biomarkers.py short codes and seed_data.py ALIASES codes without duplicating rules.
SYNONYM_GROUPS = [
    ("HB", "HEMOGLOBIN"),
    ("TG", "TRIGLYCERIDES"),
    ("CHOL", "CHOL_TOTAL"),
    ("VITD", "VITAMIN_D"),
    ("CREAT", "CREATININE"),
    ("ALT", "SGPT"),
    ("AST", "SGOT"),
    ("ALB", "ALBUMIN"),
    ("BILI_T", "BILIRUBIN"),
    ("GLU_F", "GLUCOSE_FASTING"),
    ("GLU_PP", "GLUCOSE_PP"),
    ("GLU_R", "GLUCOSE_RANDOM"),
]
SYNONYMS: dict[str, set[str]] = {}
for _a, _b in SYNONYM_GROUPS:
    SYNONYMS[_a] = SYNONYMS[_b] = {_a, _b}

MISSING_LABELS = {
    "vitals.bmi": "BMI not recorded",
    "lifestyle.activity_level": "Activity level not recorded",
    "functional_status": "Functional status not recorded",
    "reproductive.planning_pregnancy": "Reproductive history not recorded",
    "reproductive.trying_to_conceive_months": "Reproductive history not recorded",
    "reproductive.menstrual_pattern": "Menstrual pattern not recorded",
    "medicine_count": "Medicine count not recorded",
}


@dataclass
class Match:
    program_code: str
    matched_rules: list[str]
    missing_data: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def default_profile() -> dict:
    return {
        "vitals": {"height_cm": None, "weight_kg": None, "bmi": None, "waist_cm": None, "bp_readings": []},
        "family_history": [],
        "symptoms": [],
        "lifestyle": {"activity_level": "", "sleep_hours": None, "smoking": False, "alcohol": "", "diet_type": ""},
        "physical_limitations": [],
        "functional_status": "",
        "screening_history": [],
        "conditions": [],
        "targets": {},
        "imaging_findings": [],
        "reproductive": {"planning_pregnancy": None, "trying_to_conceive_months": None, "menstrual_pattern": "", "pregnancies": None},
        "caregiver": {"name": "", "relationship": "", "phone": "", "phone_consent": False},
        "medicine_count": None,
        "monitoring_requested": False,
    }


def _clean_profile(raw: dict | None) -> dict:
    base = default_profile()
    if not isinstance(raw, dict):
        return base
    for k in ("family_history", "physical_limitations"):
        if isinstance(raw.get(k), list):
            base[k] = [str(x).strip().upper() for x in raw[k] if str(x).strip()]
    if isinstance(raw.get("symptoms"), list):
        out = []
        for s in raw["symptoms"]:
            if isinstance(s, dict) and s.get("code"):
                out.append({"code": str(s["code"]).strip().upper(), "date": str(s.get("date") or "")[:20]})
            elif isinstance(s, str) and s.strip():
                out.append({"code": s.strip().upper(), "date": ""})
        base["symptoms"] = out
    if isinstance(raw.get("vitals"), dict):
        v = raw["vitals"]
        h, w, waist = v.get("height_cm"), v.get("weight_kg"), v.get("waist_cm")
        h = float(h) if h not in (None, "") else None
        w = float(w) if w not in (None, "") else None
        waist = float(waist) if waist not in (None, "") else None
        bmi = round(w / ((h / 100.0) ** 2), 1) if h and w and h > 0 and w > 0 else None
        bps = []
        for r in (v.get("bp_readings") or []):
            if isinstance(r, dict) and r.get("systolic") and r.get("diastolic"):
                where = str(r.get("where") or "CLINIC").strip().upper()
                bps.append({
                    "systolic": int(r["systolic"]), "diastolic": int(r["diastolic"]),
                    "taken_on": str(r.get("taken_on") or "")[:20],
                    "where": where if where in ("CLINIC", "HOME") else "CLINIC",
                })
        base["vitals"] = {"height_cm": h, "weight_kg": w, "bmi": bmi, "waist_cm": waist, "bp_readings": bps}
    if isinstance(raw.get("lifestyle"), dict):
        ls = raw["lifestyle"]
        base["lifestyle"] = {
            "activity_level": str(ls.get("activity_level") or "").strip().upper(),
            "sleep_hours": float(ls["sleep_hours"]) if ls.get("sleep_hours") not in (None, "") else None,
            "smoking": bool(ls.get("smoking", False)),
            "alcohol": str(ls.get("alcohol") or "")[:40],
            "diet_type": str(ls.get("diet_type") or "")[:40],
        }
    base["functional_status"] = str(raw.get("functional_status") or "").strip().upper()
    if isinstance(raw.get("screening_history"), list):
        base["screening_history"] = [
            {"screen_code": str(x.get("screen_code") or "").strip().upper(), "done_on": str(x.get("done_on") or "")[:20]}
            for x in raw["screening_history"] if isinstance(x, dict) and x.get("screen_code")
        ]
    if isinstance(raw.get("conditions"), list):
        base["conditions"] = [
            {
                "code": str(x.get("code") or "").strip().upper(),
                "status": str(x.get("status") or "CONFIRMED").strip().upper(),
                "stage": str(x.get("stage") or "")[:30],
                "since": str(x.get("since") or "")[:20],
                "confirmed_by": int(x["confirmed_by"]) if x.get("confirmed_by") not in (None, "") else None,
            }
            for x in raw["conditions"] if isinstance(x, dict) and x.get("code")
        ]
    if isinstance(raw.get("targets"), dict):
        clean_t = {}
        for k, v in raw["targets"].items():
            code = str(k or "").strip().upper()
            if not code:
                continue
            if isinstance(v, (int, float)):
                clean_t[code] = {"target_op": "<", "target_value": float(v), "unit": "%" if code == "HBA1C" else ""}
            elif isinstance(v, dict):
                op = str(v.get("target_op") or ("RANGE" if v.get("target_low") is not None or v.get("target_high") is not None else "<")).strip().upper()
                if op not in ("<", "<=", ">", ">=", "==", "RANGE"):
                    op = "<"
                direction = str(v.get("direction") or "").strip().upper()
                entry: dict = {"target_op": op, "unit": str(v.get("unit") or ("%" if code == "HBA1C" else ""))[:20]}
                if v.get("target_value") not in (None, ""):
                    entry["target_value"] = float(v["target_value"])
                if v.get("target_low") not in (None, ""):
                    entry["target_low"] = float(v["target_low"])
                if v.get("target_high") not in (None, ""):
                    entry["target_high"] = float(v["target_high"])
                if direction in ("LOWER_IS_BETTER", "HIGHER_IS_BETTER", "RANGE"):
                    entry["direction"] = direction
                if v.get("min_meaningful_change") not in (None, ""):
                    entry["min_meaningful_change"] = float(v["min_meaningful_change"])
                if "target_value" in entry or "target_low" in entry or "target_high" in entry:
                    clean_t[code] = entry
        base["targets"] = clean_t
    if isinstance(raw.get("imaging_findings"), list):
        base["imaging_findings"] = [
            {"code": str(x.get("code") or "").strip().upper(), "done_on": str(x.get("done_on") or "")[:20]}
            for x in raw["imaging_findings"] if isinstance(x, dict) and x.get("code")
        ]
    if isinstance(raw.get("reproductive"), dict):
        rep = raw["reproductive"]
        ttc = rep.get("trying_to_conceive_months")
        preg = rep.get("pregnancies")
        pp = rep.get("planning_pregnancy")
        base["reproductive"] = {
            "planning_pregnancy": bool(pp) if pp is not None else None,
            "trying_to_conceive_months": int(ttc) if ttc not in (None, "") else None,
            "menstrual_pattern": str(rep.get("menstrual_pattern") or "").strip().upper(),
            "pregnancies": int(preg) if preg not in (None, "") else None,
        }
    if isinstance(raw.get("caregiver"), dict):
        cg = raw["caregiver"]
        phone = str(cg.get("phone") or "").strip()[:30]
        consent = bool(cg.get("phone_consent", False))
        if phone and not consent:
            raise ValueError("Caregiver phone consent is required before saving phone number")
        base["caregiver"] = {
            "name": str(cg.get("name") or "").strip()[:120],
            "relationship": str(cg.get("relationship") or "").strip()[:60],
            "phone": phone if consent else "",
            "phone_consent": consent,
        }
    mc = raw.get("medicine_count")
    base["medicine_count"] = int(mc) if mc not in (None, "") else None
    base["monitoring_requested"] = bool(raw.get("monitoring_requested", False))
    return base


def get_profile(db: Session, patient_id: int) -> tuple[dict, bool, HealthProfile | None]:
    root = rel.canonical_patient_id(db, patient_id)
    row = db.scalar(select(HealthProfile).where(HealthProfile.patient_id == root))
    if not row or not row.payload_enc:
        return default_profile(), False, row
    try:
        data = json.loads(storage.decrypt_str(row.payload_enc))
        return _clean_profile(data), True, row
    except Exception:
        return default_profile(), True, row


def save_profile(db: Session, patient_id: int, raw: dict, user_id: int | None) -> tuple[dict, HealthProfile]:
    root = rel.canonical_patient_id(db, patient_id)
    cur_profile, has_cur, row = get_profile(db, root)
    merged = dict(raw) if isinstance(raw, dict) else {}
    if "conditions" not in merged and has_cur:
        merged["conditions"] = cur_profile.get("conditions", [])
    if "targets" not in merged and has_cur:
        merged["targets"] = cur_profile.get("targets", {})
    cleaned = _clean_profile(merged)
    enc = storage.encrypt_str(json.dumps(cleaned, ensure_ascii=False))
    if not row:
        row = HealthProfile(patient_id=root, payload_enc=enc, updated_by=user_id)
        db.add(row)
    else:
        row.payload_enc, row.updated_by = enc, user_id
    db.flush()
    return cleaned, row


def _field(obj: dict, path: str):
    cur = obj
    for part in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def _codes_for(code: str) -> set[str]:
    return SYNONYMS.get(code, {code})


def bp_is_high(profile: dict) -> tuple[bool, bool]:
    """Returns (is_high, has_readings). Average of last 2 readings >= 140/90 (clinic) or 135/85 (home)."""
    readings = _field(profile, "vitals.bp_readings") or []
    if not readings:
        return False, False
    last = readings[-2:]
    avg_s = sum(r["systolic"] for r in last) / len(last)
    avg_d = sum(r["diastolic"] for r in last) / len(last)
    home = all(r.get("where") == "HOME" for r in last)
    s_lim, d_lim = (135, 85) if home else (140, 90)
    return (avg_s >= s_lim or avg_d >= d_lim), True


def bone_risk_from_profile(age: int | None, gender: str, profile: dict, labs: dict[str, list[ReportParameter]]) -> bool:
    has_cond = any(c.get("code") in ("OSTEOPOROSIS", "OSTEOPENIA") and c.get("status") == "CONFIRMED" for c in profile.get("conditions", []))
    has_img = any(i.get("code") in ("OSTEOPOROSIS", "OSTEOPENIA") for i in profile.get("imaging_findings", []))
    vitd_low = any(p.system_flag == "LOW" for p in _matching_labs(labs, "VITD"))
    risk_person = (age is not None and age >= 50) or (gender == "F" and age is not None and age >= 45) or ("OSTEOPOROSIS" in profile.get("family_history", []))
    return has_cond or has_img or (vitd_low and risk_person)


def _matching_labs(labs: dict[str, list[ReportParameter]], code: str) -> list[ReportParameter]:
    out = []
    for c in _codes_for(code):
        out.extend(labs.get(c, []))
    return out


def _cmp(val: float, op: str, target: float) -> bool:
    return {">=": val >= target, "<=": val <= target, ">": val > target, "<": val < target, "==": val == target, "!=": val != target}.get(op, False)


def _eval_node(node: dict, ctx: dict) -> tuple[bool, list[str], list[str]]:
    """Returns (matched, matched_rule_ids, missing_data)."""
    if "any" in node:
        hits, missing = [], []
        for sub in node["any"]:
            ok, m_rules, m_miss = _eval_node(sub, ctx)
            missing.extend(m_miss)
            if ok:
                hits.extend(m_rules)
        return bool(hits), hits, missing

    if "all" in node:
        hits, missing = [], []
        for sub in node["all"]:
            ok, m_rules, m_miss = _eval_node(sub, ctx)
            missing.extend(m_miss)
            if not ok:
                return False, [], missing
            hits.extend(m_rules)
        return True, hits, missing

    labs: dict[str, list[ReportParameter]] = ctx["labs"]
    profile: dict = ctx["profile"]

    if "lab" in node or "lab_any" in node:
        codes = [node["lab"]] if "lab" in node else node["lab_any"]
        flag = node.get("flag")
        op = node.get("op")
        hits = []
        for code in codes:
            for p in _matching_labs(labs, code):
                if flag == "ABNORMAL" and p.system_flag in ("LOW", "HIGH"):
                    hits.append(f"lab:{code}:{p.system_flag}")
                elif flag in ("LOW", "HIGH") and p.system_flag == flag:
                    hits.append(f"lab:{code}:{flag}")
                elif op and p.value_num is not None and _cmp(p.value_num, op, float(node["value"])):
                    hits.append(f"lab:{code}:{op}")
        return bool(hits), hits, []

    if "lab_ratio" in node:
        num_c, den_c = node["lab_ratio"]
        nums = [p.value_num for p in _matching_labs(labs, num_c) if p.value_num is not None]
        dens = [p.value_num for p in _matching_labs(labs, den_c) if p.value_num is not None and p.value_num > 0]
        if nums and dens and _cmp(nums[0] / dens[0], node.get("op", ">="), float(node["value"])):
            return True, [f"lab_ratio:{num_c}_{den_c}"], []
        return False, [], []

    if "bucket" in node:
        b = node["bucket"]
        if b in ctx["buckets"]:
            return True, [f"bucket:{b}"], []
        return False, [], []

    if "condition" in node:
        target, st = node["condition"], node.get("status", "CONFIRMED")
        if any(c.get("code") == target and c.get("status") == st for c in profile.get("conditions", [])):
            return True, [f"condition:{target}"], []
        return False, [], []

    if "imaging" in node:
        target = node["imaging"]
        if any(i.get("code") == target for i in profile.get("imaging_findings", [])):
            return True, [f"imaging:{target}"], []
        return False, [], []

    if "bp_high" in node:
        high, has_bp = bp_is_high(profile)
        if not has_bp:
            return False, [], ["Blood pressure not recorded"]
        return high, (["profile:bp_high"] if high else []), []

    if "metabolic_abnormal" in node:
        hits = []
        for c in ("HBA1C", "GLU_F", "GLU_PP", "GLU_R", "CHOL", "LDL", "TG", "NON_HDL"):
            if any(p.system_flag == "HIGH" for p in _matching_labs(labs, c)):
                hits.append(f"lab:{c}:HIGH")
        if any(p.system_flag == "LOW" for p in _matching_labs(labs, "HDL")):
            hits.append("lab:HDL:LOW")
        bp_high, _ = bp_is_high(profile)
        if bp_high:
            hits.append("profile:bp_high")
        for b in ("DIABETES", "LIPID", "HYPERTENSION"):
            if b in ctx["buckets"]:
                hits.append(f"bucket:{b}")
        return bool(hits), hits, []

    if "age" in node:
        age = ctx["age"]
        if age is None:
            return False, [], ["Age not recorded"]
        if node["age"] == "between":
            ok = int(node["min"]) <= age <= int(node["max"])
            return ok, ([f"age:{node['min']}-{node['max']}"] if ok else []), []
        ok = _cmp(age, node["age"], float(node["value"]))
        return ok, ([f"age{node['age']}{node['value']}"] if ok else []), []

    if "gender" in node:
        g = ctx["gender"]
        if not g:
            return False, [], ["Gender not recorded"]
        return g == node["gender"], ([f"gender:{g}"] if g == node["gender"] else []), []

    if "no_recent_screening_months" in node:
        if not ctx["has_profile"]:
            return False, [], ["Screening history not recorded"]
        cutoff = today_ist() - timedelta(days=30 * int(node["no_recent_screening_months"]))
        recent = False
        for s in profile.get("screening_history", []):
            try:
                if s.get("done_on") and date.fromisoformat(s["done_on"][:10]) >= cutoff:
                    recent = True
                    break
            except ValueError:
                continue
        return (not recent), (["profile:screening_overdue"] if not recent else []), []

    if "chronic_count" in node:
        chronic = {b for b in ctx["buckets"] if b != "OTHER"}
        chronic |= {c["code"] for c in profile.get("conditions", []) if c.get("status") == "CONFIRMED"}
        ok = _cmp(len(chronic), node["chronic_count"], float(node["value"]))
        return ok, ([f"chronic_count>={node['value']}"] if ok else []), []

    if node.get("has_active_meds"):
        return bool(ctx["active_meds"]), (["meds:active"] if ctx["active_meds"] else []), []

    if node.get("has_chronic_meds"):
        return bool(ctx["chronic_meds"]), (["meds:chronic"] if ctx["chronic_meds"] else []), []

    if node.get("drug_nutrient_match"):
        hits = ctx["drug_nutrient_hits"]
        return bool(hits), [f"drug_nutrient:{h['nutrient_marker']}" for h in hits], []

    if node.get("treatment_response"):
        return bool(ctx["treatment_response_hits"]), ctx["treatment_response_hits"], []

    if node.get("any_lab_abnormal"):
        hits = [f"lab:{p.param_code}:{p.system_flag}" for plist in labs.values() for p in plist if p.system_flag in ("LOW", "HIGH")]
        return bool(hits), hits, []

    if node.get("any_lab_severe"):
        hits = [f"lab:{p.param_code}:SEVERE" for plist in labs.values() for p in plist if p.severity == "severe"]
        return bool(hits), hits, []

    if "borderline_pct" in node:
        pct = float(node["borderline_pct"]) / 100.0
        hits = []
        ranges = ctx.get("reference_ranges", {})
        for plist in labs.values():
            for p in plist:
                if p.value_num is None or p.system_flag != "NORMAL":
                    continue
                lo, hi = p.ref_low, p.ref_high
                if lo is None and hi is None and p.param_code in ranges:
                    spec = ranges[p.param_code]
                    if "low_below" in spec:
                        lo = spec["low_below"].get(ctx["gender"])
                    else:
                        norm = next((b for b in spec.get("bands", []) if b[0] in NORMAL_LABELS), None)
                        if norm:
                            lo, hi = norm[1], norm[2]
                if (lo and abs(p.value_num - lo) / abs(lo) <= pct) or (hi and abs(hi - p.value_num) / abs(hi) <= pct):
                    hits.append(f"borderline:{p.param_code}")
        return bool(hits), hits, []

    if "delta_pct" in node:
        pct = float(node["delta_pct"])
        hits = []
        for code, prev_val in ctx.get("prev_labs", {}).items():
            if not prev_val:
                continue
            for p in labs.get(code, []):
                if p.value_num is not None and abs(p.value_num - prev_val) / abs(prev_val) * 100.0 > pct:
                    hits.append(f"delta:{code}")
        return bool(hits), hits, []

    if node.get("has_open_referral"):
        return bool(ctx["open_referrals"]), (["referral:open"] if ctx["open_referrals"] else []), []

    if node.get("is_escalation"):
        return bool(ctx["is_escalation"]), (["followup:escalation"] if ctx["is_escalation"] else []), []

    if node.get("has_home_readings"):
        return bool(ctx["home_readings_count"]), (["home:readings"] if ctx["home_readings_count"] else []), []

    if node.get("family_member_chronic"):
        return bool(ctx["family_chronic"]), (["family:chronic_member"] if ctx["family_chronic"] else []), []

    if "report_classification" in node:
        rep = ctx.get("report")
        cls = (rep.classification or "").upper() if rep else ""
        ok = cls == node["report_classification"].upper()
        return ok, ([f"report:{cls}"] if ok else []), []

    if "profile" in node:
        path = node["profile"]
        val = _field(profile, path)
        if path == "symptoms" and isinstance(val, list):
            codes = {s["code"] for s in val if isinstance(s, dict) and s.get("code")}
            if "contains" in node:
                ok = node["contains"] in codes
                return ok, ([f"symptom:{node['contains']}"] if ok else []), []
            if "contains_any" in node:
                hits = [f"symptom:{c}" for c in node["contains_any"] if c in codes]
                return bool(hits), hits, []
        if isinstance(val, list):
            if "contains" in node:
                ok = node["contains"] in val
                return ok, ([f"profile:{path}:{node['contains']}"] if ok else []), []
            if "contains_any" in node:
                hits = [f"profile:{path}:{c}" for c in node["contains_any"] if c in val]
                return bool(hits), hits, []
            if node.get("any_present"):
                return bool(val), ([f"profile:{path}:present"] if val else []), []
            return False, [], []
        if val is None or val == "":
            miss = MISSING_LABELS.get(path)
            return False, [], ([miss] if miss else [])
        if "in" in node:
            ok = val in node["in"]
            return ok, ([f"profile:{path}:{val}"] if ok else []), []
        if "op" in node:
            target = node["value"]
            if isinstance(target, bool):
                ok = (bool(val) == target) if node["op"] == "==" else (bool(val) != target)
            elif isinstance(target, (int, float)):
                ok = _cmp(float(val), node["op"], float(target))
            else:
                ok = (val == target) if node["op"] == "==" else (val != target)
            return ok, ([f"profile:{path}"] if ok else []), []

    return False, [], []


def _build_context(db: Session, patient: Patient, report: Report | None) -> dict:
    root, pids = rel.patient_family_ids(db, patient.id)
    profile, has_profile, _ = get_profile(db, root)
    rules = load_rules(db)
    labs: dict[str, list[ReportParameter]] = {}
    if report:
        for p in db.scalars(select(ReportParameter).where(ReportParameter.report_id == report.id)):
            if p.param_code:
                labs.setdefault(p.param_code, []).append(p)
    buckets = {
        b.bucket_code for b in db.scalars(
            select(PatientBucket).where(PatientBucket.patient_id.in_(pids), PatientBucket.active.is_(True))
        )
    }
    bp_high, _ = bp_is_high(profile)
    if bp_high or any(c.get("code") == "HYPERTENSION" and c.get("status") == "CONFIRMED" for c in profile.get("conditions", [])):
        buckets.add("HYPERTENSION")
    age = report.age if report and report.age is not None else patient.age
    gender = (report.gender if report and report.gender else patient.gender) or ""
    if bone_risk_from_profile(age, gender, profile, labs):
        buckets.add("BONE")

    # Page 5 context: medications, drug-nutrient interactions, serial labs, referrals, home readings, consenting family.
    med_cat = {m["code"]: m for m in rules.get("medicine_catalogue", [])}
    active_meds = list(db.scalars(
        select(PatientMedication).where(PatientMedication.patient_id.in_(pids), PatientMedication.stopped_on.is_(None))
    ))
    chronic_meds = [m for m in active_meds if med_cat.get(m.medicine_code, {}).get("is_chronic")]
    active_classes = {med_cat[m.medicine_code]["drug_class"] for m in active_meds if m.medicine_code in med_cat}
    drug_nutrient_hits = []
    for r in rules.get("drug_nutrient_rules", []):
        if r.get("drug_class") in active_classes:
            if any(p.system_flag == r.get("direction") for p in _matching_labs(labs, r.get("nutrient_marker", ""))):
                drug_nutrient_hits.append(r)

    prev_labs: dict[str, float] = {}
    serial_codes: set[str] = set()
    if report and report.collected_on:
        earlier = db.execute(
            select(ReportParameter.param_code, ReportParameter.value_num)
            .join(Report, Report.id == ReportParameter.report_id).join(Order, Order.id == Report.order_id)
            .where(Order.patient_id.in_(pids), Order.status == ord_status.READY,
                   Report.id != report.id, Report.collected_on < report.collected_on,
                   ReportParameter.param_code != "", ReportParameter.value_num.is_not(None))
            .order_by(Report.collected_on.desc(), Report.id.desc())
        ).all()
        for code, val in earlier:
            serial_codes.add(code)
            prev_labs.setdefault(code, float(val))

    treatment_response_hits = []
    if report:
        curr_codes = set(labs.keys()) & serial_codes
        linked = {
            c for m in active_meds for lm in med_cat.get(m.medicine_code, {}).get("linked_markers", []) for c in _codes_for(lm)
        }
        for code in sorted(curr_codes & linked):
            treatment_response_hits.append(f"treatment_response:{code}")

    open_referrals = list(db.scalars(select(Referral.id).where(
        Referral.patient_id.in_(pids), Referral.status.in_(("SUGGESTED", "BOOKED"))
    )))
    fu = db.scalar(select(Followup).where(Followup.report_id == report.id)) if report else None
    is_escalation = bool(fu and fu.priority == "ESCALATION")
    home_readings_count = len(list(db.scalars(select(HomeReading.id).where(HomeReading.patient_id.in_(pids)).limit(1))))
    fam_summaries = ext.consenting_family_summaries(db, root)
    family_chronic = any(
        f["has_consent"] and f["summary"] and (f["summary"]["confirmed_conditions"] or f["summary"]["active_buckets"])
        for f in fam_summaries
    )

    return {
        "patient": patient, "report": report, "profile": profile, "has_profile": has_profile,
        "labs": labs, "buckets": buckets, "age": age, "gender": gender,
        "reference_ranges": rules.get("reference_ranges", {}),
        "active_meds": active_meds, "chronic_meds": chronic_meds,
        "drug_nutrient_hits": drug_nutrient_hits, "prev_labs": prev_labs,
        "treatment_response_hits": treatment_response_hits,
        "open_referrals": open_referrals, "is_escalation": is_escalation,
        "home_readings_count": home_readings_count, "family_chronic": family_chronic,
    }


def evaluate_rules(ctx: dict, programs: list[dict]) -> list[Match]:
    matches: list[Match] = []
    for prog in programs:
        ok, matched, missing = _eval_node(prog.get("trigger") or {}, ctx)
        if not ok:
            continue
        notes = []
        if prog.get("clearance_if_limitations"):
            lims = [x for x in (ctx["profile"].get("physical_limitations") or []) if x != "NONE"]
            if lims:
                notes.append("doctor clearance needed")
        if prog["code"] == "DRUG_NUTRIENT_REVIEW":
            notes.extend(h["note"] for h in ctx.get("drug_nutrient_hits", []) if h.get("note"))
        matches.append(Match(
            program_code=prog["code"],
            matched_rules=sorted(set(matched)),
            missing_data=sorted(set(missing)),
            notes=notes,
        ))
    return matches


def evaluate(db: Session, patient_id: int, report_id: int | None = None, commit: bool = True, notify_consider: bool = True) -> list[Match]:
    """Idempotently evaluates care_programs for a patient/report without overwriting doctor decisions."""
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

    rules = load_rules(db)
    programs = rules.get("care_programs", [])
    by_code = {p["code"]: p for p in programs}
    from .models import RuleSet
    rs = db.scalar(select(RuleSet).where(RuleSet.key == "care_programs", RuleSet.active).order_by(RuleSet.version.desc()))
    rule_version = rs.version if rs else 1

    ctx = _build_context(db, patient, report)
    matches = evaluate_rules(ctx, programs)
    by_match = {m.program_code: m for m in matches}

    q = select(ProgramRecommendation).where(ProgramRecommendation.patient_id == root)
    q = q.where(ProgramRecommendation.report_id == rid) if rid is not None else q.where(ProgramRecommendation.report_id.is_(None))
    existing = {r.program_code: r for r in db.scalars(q)}

    new_consider = False
    for code, m in by_match.items():
        if code in existing:
            rec = existing[code]
            if rec.status == "SUGGESTED":
                rec.reason_codes, rec.missing_data, rec.notes, rec.rule_version = m.matched_rules, m.missing_data, m.notes, rule_version
                if fu and not rec.followup_id:
                    rec.followup_id = fu.id
        else:
            rec = ProgramRecommendation(
                patient_id=root, followup_id=fu.id if fu else None, report_id=rid,
                program_code=code, rule_version=rule_version, status="SUGGESTED",
                reason_codes=m.matched_rules, missing_data=m.missing_data, notes=m.notes,
            )
            db.add(rec)
            if by_code.get(code, {}).get("mode") == "DOCTOR_CONSIDER":
                new_consider = True

    for code, rec in existing.items():
        if code not in by_match and rec.status == "SUGGESTED":
            rec.status = "EXPIRED"

    if new_consider and notify_consider:
        doc_id = fu.assigned_doctor_id if fu else None
        link = f"/followups/view?id={fu.id}" if fu else f"/patients/view?id={root}"
        assign.notify(db, assign.doctor_users(db, doc_id), "New consider item", link)

    if commit:
        db.commit()
    else:
        db.flush()
    return matches
