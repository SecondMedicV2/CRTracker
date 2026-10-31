"""Call-card generators behind one interface (Part 10.1). The vendor is still an open question (Q3),
so the default `template` provider needs no AI and no key: it fills the admin-editable script
templates from the structured input. The `anthropic` provider is optional and OFF by default.
Both receive only structured, de-identified data (no name, no mobile)."""
import json
import re

from .config import env


class LLMError(Exception):
    pass


class LLMProvider:
    name = "base"
    model = ""
    prompt_version = "v1"

    def generate(self, data: dict, templates: dict) -> dict:
        raise NotImplementedError


def _trend(t: str) -> str:
    return "stable" if t == "stable_abnormal" else t


class TemplateProvider(LLMProvider):
    name, model = "template", "template-v1"

    def generate(self, data: dict, templates: dict) -> dict:
        t = templates[data["language"]]
        d, c = t["doctor"], t["caller"]
        tests = [x["name"] for x in data["recommended"]]
        test_phrase = ", ".join(tests)
        interval = data["followup"]["interval_days"]
        findings = [{**{k: a[k] for k in ("param_code", "name", "value", "unit", "ref_range", "direction", "severity")},
                     "trend_vs_previous": _trend(a["trend_vs_previous"])} for a in data["abnormal"]]
        fill = {"age": data["age"], "lab": data["lab"], "report_age_text": data["report_age_text"],
                "report_date": data["report_date"], "interval_days": interval, "tests": test_phrase}
        recs = [{"test_code": r["code"], "name": r["name"], "priority": i + 1,
                 "rationale": d["rationale"].format(bucket=r["bucket"], **fill)} for i, r in enumerate(data["recommended"])]
        tier = data["score"]["tier"]
        return {
            "schema_version": "1.0", "language": data["language"],
            "summary": {"headline": t["headline"].format(tests=test_phrase or data["buckets"][0]["name"]),
                        "report_date": data["report_date"], "report_age_days": data["report_age_days"], "lab": data["lab"]},
            "abnormal_findings": findings,
            "retest": {"tier": tier, "score": data["score"]["score"], "score_breakdown": data["score"]["breakdown"],
                       "reasons": [r for b in data["buckets"] for r in b["reasons"]], "recommended_tests": recs, "not_needed": [],
                       "ideal_window": data["ideal_window"],
                       "confidence": "high" if tier == "HIGH" else "medium" if tier == "MEDIUM" else "low"},
            "doctor_script": {
                "opening": d["opening"].format(**fill), "discussion_points": list(d["discussion_points"]),
                "scientific_talking_points": [d["finding"].format(**{**f, "trend": _trend_word(f["trend_vs_previous"])}) for f in findings],
                "questions_to_ask": list(d["questions_to_ask"]), "counselling_points": list(d["counselling_points"]),
                "tests_to_suggest": [d["test_line"].format(name=r["name"], rationale=r["rationale"]) for r in recs],
                "red_flags": list(d["red_flags"]), "closing": d["closing"], "next_followup_suggestion": d["next_followup"].format(**fill)},
            "caller_script": {
                "opening": c["opening"], "identity_check": c["identity_check"],
                "free_followup_pitch": c["free_followup_pitch"].format(tests=test_phrase or "health check"),
                "consent_request": c["consent_request"], "slot_offer": c["slot_offer"],
                "objection_handling": list(c["objection_handling"]), "do_not_say": list(c["do_not_say"]),
                "urgent_symptom_protocol": c["urgent_symptom_protocol"], "closing": c["closing"]},
            "needs_doctor_review": True,
        }


def _trend_word(t: str) -> str:
    return {"none": "no earlier result"}.get(t, t)


SYSTEM_PROMPT = """You write a doctor follow-up "call card" as ONE JSON object and nothing else.
Rules: use ONLY numbers, dates, test names and codes that appear in the input; never invent values.
recommended_tests may only use codes from input.recommended. The caller_script is for a non-medical
caller: it must contain NO diagnosis, NO disease names, NO lab values, NO digits, NO interpretation and NO
medicine names; it only pitches the free doctor follow-up, takes consent and offers a slot. Keep the
placeholders {patient_name}, {caller_name}, {company} exactly as written. Write in input.language.
Follow the exact shape of input.template_example and the style of input.templates."""


class AnthropicProvider(LLMProvider):
    """UNTESTED against the live API (no key was available when written). Enable with
    LLM_PROVIDER=anthropic and ANTHROPIC_API_KEY; output goes through the same validators as the template."""

    name = "anthropic"

    def __init__(self):
        self.model = env.llm_model

    def generate(self, data: dict, templates: dict) -> dict:
        import httpx

        if not env.anthropic_api_key:
            raise LLMError("ANTHROPIC_API_KEY is not set")
        example = TemplateProvider().generate(data, templates)
        body = {"model": self.model, "max_tokens": 6000, "system": SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": json.dumps({**data, "templates": templates[data["language"]], "template_example": example}, ensure_ascii=False)}]}
        try:
            r = httpx.post("https://api.anthropic.com/v1/messages", json=body, timeout=90,
                           headers={"x-api-key": env.anthropic_api_key, "anthropic-version": "2023-06-01"})
            r.raise_for_status()
            text = r.json()["content"][0]["text"]
            return json.loads(re.sub(r"^```(?:json)?|```$", "", text.strip()).strip())
        except Exception as e:  # never echo the response body: it may echo the input
            raise LLMError(f"LLM call failed ({type(e).__name__})")


def get_llm() -> LLMProvider:
    return {"template": TemplateProvider, "anthropic": AnthropicProvider}[env.llm_provider]()
