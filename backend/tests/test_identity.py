from sqlalchemy import select

from app import db as dbmod
from app import identity, pipeline, status, storage
from app.models import ImportBatch, Order, Patient, Report

API = "/api/v1"
_n = [0]


def make(name, gender, age, mobile, oid=None):
    """Insert an extracted order+report and run it through the identity step. Returns (order_id_pk, outcome status)."""
    _n[0] += 1
    with dbmod.SessionLocal() as db:
        b = db.scalar(select(ImportBatch)) or ImportBatch(source="manual")
        db.add(b)
        db.flush()
        o = Order(order_id_external=oid or f"T{_n[0]}", batch_id=b.id, status=status.EXTRACTING)
        db.add(o)
        db.flush()
        db.add(Report(order_id=o.id, patient_name=name, age=age, gender=gender,
                      mobile_enc=storage.encrypt_str(mobile) if mobile else ""))
        db.flush()
        pipeline.conclude(db, o, db.scalar(select(Report).where(Report.order_id == o.id)))
        db.commit()
        return o.id, o.status


def patient_of(order_pk):
    with dbmod.SessionLocal() as db:
        return db.get(Order, order_pk).patient_id


def count_patients(live_only=True):
    with dbmod.SessionLocal() as db:
        q = select(Patient)
        if live_only:
            q = q.where(Patient.merged_into_id.is_(None))
        return len(db.scalars(q).all())


def test_normalisation():
    assert identity.norm_name("  Mr.  DELVIN   Nadar ") == "delvin nadar"
    assert identity.norm_name("Dr Smt. Asha") == "asha"
    assert identity.norm_mobile("+91 98765-43210") == identity.norm_mobile("09876543210") == "9876543210"
    assert identity.norm_mobile("12345") == "" and identity.norm_mobile("") == ""


def test_exact_match_auto_links_across_spelling_variants():
    a, s1 = make("Delvin Nadar", "M", 28, "9876543210")
    b, s2 = make("MR. delvin  nadar", "M", 28, "+91 98765 43210")
    assert (s1, s2) == (status.READY, status.READY)
    assert patient_of(a) == patient_of(b) and count_patients() == 1


def test_ac8_same_name_and_age_different_mobile_triggers_review(admin):
    a, _ = make("Delvin", "M", 28, "9876543210")
    b, st = make("Delvin", "M", 28, "9123456780")
    assert st == status.PENDING_IDENTITY and patient_of(a) != patient_of(b)
    rv = admin.get(f"{API}/identity-reviews").json()
    assert len(rv) == 1 and rv[0]["reason"] == "Same name and age, different mobile"
    assert rv[0]["existing"]["mobile"] == "9876543210"  # admin sees full number


def test_merge_then_unmerge_is_reversible(admin):
    a, _ = make("Delvin", "M", 28, "9876543210")
    b, _ = make("Delvin", "M", 28, "9123456780")
    rid = admin.get(f"{API}/identity-reviews").json()[0]["id"]
    assert admin.post(f"{API}/identity-reviews/{rid}/decide", json={"decision": "SAME"}).json()["status"] == "SAME"
    assert patient_of(a) == patient_of(b) and count_patients() == 1
    with dbmod.SessionLocal() as db:
        assert db.get(Order, b).status == status.READY
    assert admin.post(f"{API}/identity-reviews/{rid}/decide", json={"decision": "SAME"}).status_code == 409
    assert admin.post(f"{API}/identity-reviews/{rid}/unmerge").json()["status"] == "UNMERGED"
    assert patient_of(a) != patient_of(b) and count_patients() == 2


def test_different_person_keeps_both_and_releases_order(admin):
    a, _ = make("Delvin", "M", 28, "9876543210")
    b, _ = make("Delvin", "M", 28, "9123456780")
    rid = admin.get(f"{API}/identity-reviews").json()[0]["id"]
    admin.post(f"{API}/identity-reviews/{rid}/decide", json={"decision": "DIFFERENT"})
    assert patient_of(a) != patient_of(b) and count_patients() == 2
    with dbmod.SessionLocal() as db:
        assert db.get(Order, b).status == status.READY
    assert admin.post(f"{API}/identity-reviews/{rid}/unmerge").status_code == 409  # nothing to undo
    assert admin.get(f"{API}/identity-reviews").json() == []


def test_shared_mobile_different_person_is_household_not_merge():
    a, s1 = make("Asha Rao", "F", 50, "9000011111")
    b, s2 = make("Ravi Rao", "M", 52, "9000011111")
    assert s2 == status.READY and patient_of(a) != patient_of(b)
    with dbmod.SessionLocal() as db:
        tags = {p.household_tag for p in db.scalars(select(Patient))}
    assert len(tags) == 1 and tags.pop().startswith("HH-")


def test_same_mobile_similar_name_goes_to_review():
    make("Delvin Nadar", "M", 28, "9876543210")
    _, st = make("Delvin Nadarr", "M", 28, "9876543210")
    assert st == status.PENDING_IDENTITY


def test_missing_mobile_with_same_name_and_age_goes_to_review(admin):
    make("Delvin", "M", 28, "9876543210")
    _, st = make("Delvin", "M", 28, "")
    assert st == status.PENDING_IDENTITY
    assert admin.get(f"{API}/identity-reviews").json()[0]["reason"] == "Same name and age, mobile missing"


def test_different_age_or_gender_is_a_new_patient():
    make("Delvin", "M", 28, "9876543210")
    _, s1 = make("Delvin", "M", 45, "9123456780")
    _, s2 = make("Delvin", "F", 28, "9123456781")
    assert (s1, s2) == (status.READY, status.READY) and count_patients() == 3


def test_roles_and_masking(admin, caller, doctor):
    make("Delvin", "M", 28, "9876543210")
    make("Delvin", "M", 28, "9123456780")
    r = caller.get(f"{API}/identity-reviews")
    assert r.status_code == 200 and r.json()[0]["existing"]["mobile"] == "XXXXXX3210"
    assert "classification" not in str(r.json())  # callers never see results
    assert caller.get(f"{API}/patients").status_code == 403
    assert doctor.get(f"{API}/identity-reviews").status_code == 403
    rid = r.json()[0]["id"]
    assert doctor.post(f"{API}/identity-reviews/{rid}/decide", json={"decision": "SAME"}).status_code == 403
    assert caller.post(f"{API}/identity-reviews/{rid}/decide", json={"decision": "MAYBE"}).status_code == 422
    assert caller.post(f"{API}/identity-reviews/{rid}/decide", json={"decision": "SAME"}).status_code == 200
    assert caller.post(f"{API}/identity-reviews/{rid}/unmerge").status_code == 403  # admin only
    assert doctor.get(f"{API}/patients").json()[0]["mobile"].startswith("XXXXXX")
    assert admin.get(f"{API}/patients").json()[0]["mobile"].isdigit()


def test_search_by_name_and_mobile_and_view_is_audited(admin):
    a, _ = make("Delvin Nadar", "M", 28, "9876543210")
    make("Priya Shah", "F", 40, "9111111111")
    assert [p["name"] for p in admin.get(f"{API}/patients", params={"q": "nadar"}).json()] == ["Delvin Nadar"]
    hit = admin.get(f"{API}/patients", params={"q": "+91 98765 43210"}).json()
    assert len(hit) == 1
    detail = admin.get(f"{API}/patients/{hit[0]['id']}").json()
    assert detail["reports"][0]["order_id"] and detail["name"] == "Delvin Nadar"
    acts = [(x["action"], x["entity"]) for x in admin.get(f"{API}/audit").json()]
    assert ("view", "patient") in acts
    assert admin.patch(f"{API}/patients/{hit[0]['id']}", json={"language": "hi", "do_not_call": True}).json()["do_not_call"]


def test_pipeline_links_two_reports_of_the_same_person(admin):
    admin.post(f"{API}/imports/manual", json={"text": "OK1 OK2"})
    from app import worker

    with dbmod.SessionLocal() as db:
        worker.tick(db)
        worker.extract_tick(db)
    with dbmod.SessionLocal() as db:
        ids = {o.patient_id for o in db.scalars(select(Order))}
    assert len(ids) == 1 and None not in ids  # mock lab gives both the same demographics
