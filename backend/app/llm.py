"""Call-card and report insight generators behind one interface (Part 10.1).
The default `template` provider needs no AI and no key: it produces fully deterministic,
valid insights and call cards from structured input and rule sets.
`anthropic` and `gemini` providers are available behind the same interface.
All providers receive only structured, de-identified data (no name, no mobile, no address)."""
import json
import re

from .config import env


class LLMError(Exception):
    pass


INSIGHT_SYSTEM_PROMPT = """You write draft AI report insights for a doctor at CRTracker, who reviews and edits them before anything reaches a caller or patient. You receive de-identified lab results that were already classified against printed ranges.

Rules:
- Do not diagnose disease, name a clinical condition the patient "has", prescribe or suggest medication, supplements or doses, or set testing intervals. Say "outside the laboratory's printed range" and "worth discussing with the doctor".
- Refer to results ONLY by their "ref". Never mention a value, test or range that is not in the input.
- overview: 2-4 short sentences in plain language: what was tested, how many results are outside the printed ranges, what needs manual review. Never call the report normal: results inside the printed ranges do not by themselves mean the patient is healthy.
- defects: one entry per flagged or abnormal result: ref, marker, status, severity, what_it_measures, explanation (plain sentence relative to printed range), related_refs (refs of other results in input that point the same way), priority (HIGH/MEDIUM/LOW).
- suggestions:
  - doctor_discussion: clinical discussion points (symptoms, diet, medicines, prior tests).
  - caller_questions: questions for a non-medical caller to ask (symptom inquiry, report receipt). MUST contain NO digits, NO disease names, and NO drug names.
  - clarifications_for_doctor: notes on missing ranges, unit ambiguities, or interim tests.
- doctor_connect: priority MUST be either "PRIORITY" or "ROUTINE" (you can NEVER set URGENT; urgent review is decided only by doctor-approved critical rules), source="ai", reason (one sentence), connect_within_hours (integer).
- future: monitoring_tests (codes from recommended list only), suggested_window_days (integer or null), trend_notes (plain observations from history), watch_markers (codes of tests to watch).
- red_flag_protocol: protocol for urgent warning symptoms (chest pain, breathlessness at rest, fainting, heavy bleeding, confusion) directing patient to immediate care.
- limitations: note that reference ranges represent population statistics and require clinical correlation.
- needs_doctor_review: true.
- Output MUST be valid JSON matching the schema."""


EXTRACT_SYSTEM_PROMPT = """You copy lab test results out of the text of a pathology report. Identifying details were removed.
Return JSON: {"collected_on": ISO date or null, "reported_on": ISO date or null, "parameters": [{"name", "value", "unit", "ref_range"}]}.
- One entry per measured test, exactly as printed: do not convert units, round, guess, or add tests that are not in the text.
- value is the printed result (a number, or text such as "Negative"); ref_range is the printed reference range, or "".
- Skip headings, method/technology names, comments and interpretation notes."""


class LLMProvider:
    name = "base"
    model = ""
    prompt_version = "v1"

    def generate(self, data: dict, templates: dict) -> dict:
        raise NotImplementedError

    def generate_insight(self, data: dict) -> dict:
        raise NotImplementedError

    def extract_results(self, text: str) -> dict:
        raise LLMError(f"{self.name} cannot read report text")


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

    def generate_insight(self, data: dict) -> dict:
        from .ai_insights import generate_rules_insight
        return generate_rules_insight(data)


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
        except Exception as e:
            raise LLMError(f"LLM call failed ({type(e).__name__})")

    def generate_insight(self, data: dict) -> dict:
        return self._ask(INSIGHT_SYSTEM_PROMPT, json.dumps(data, ensure_ascii=False))

    def extract_results(self, text: str) -> dict:
        return self._ask(EXTRACT_SYSTEM_PROMPT, text[:60000], max_tokens=8000)

    def _ask(self, system: str, content: str, max_tokens: int = 4000) -> dict:
        import httpx

        if not env.anthropic_api_key:
            raise LLMError("ANTHROPIC_API_KEY is not set")
        body = {"model": self.model, "max_tokens": max_tokens, "system": system, "messages": [{"role": "user", "content": content}]}
        try:
            r = httpx.post("https://api.anthropic.com/v1/messages", json=body, timeout=90,
                           headers={"x-api-key": env.anthropic_api_key, "anthropic-version": "2023-06-01"})
            r.raise_for_status()
            text = r.json()["content"][0]["text"]
            return json.loads(re.sub(r"^```(?:json)?|```$", "", text.strip()).strip())
        except Exception as e:
            raise LLMError(f"LLM call failed ({type(e).__name__})")


class GeminiProvider(LLMProvider):
    name = "gemini"

    def __init__(self):
        self.model = env.llm_model or "gemini-2.5-flash"
        self.api_key = env.google_api_key

    def _call_gemini(self, system_prompt: str, user_content: str, response_schema: dict | None = None) -> dict:
        import httpx

        if not self.api_key:
            raise LLMError("GOOGLE_API_KEY is not set")

        models = [self.model, "gemini-2.5-flash", "gemini-1.5-flash"]
        # remove duplicates keeping order
        models = list(dict.fromkeys(models))

        gen_config = {"temperature": 0.1, "responseMimeType": "application/json"}
        if response_schema:
            gen_config["responseSchema"] = response_schema

        payload = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"role": "user", "parts": [{"text": user_content}]}],
            "generationConfig": gen_config,
        }

        last_error = None
        for m in models:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={self.api_key}"
            try:
                r = httpx.post(url, json=payload, timeout=60, headers={"Content-Type": "application/json"})
                if r.status_code in (429, 500, 502, 503):
                    continue
                r.raise_for_status()
                res = r.json()
                cand = res.get("candidates", [])[0]
                text = cand["content"]["parts"][0]["text"].strip()
                cleaned = re.sub(r"^```(?:json)?|```$", "", text.strip()).strip()
                return json.loads(cleaned)
            except Exception as e:
                last_error = e
                continue

        raise LLMError(f"Gemini call failed ({type(last_error).__name__ if last_error else 'No response'})")

    def generate(self, data: dict, templates: dict) -> dict:
        example = TemplateProvider().generate(data, templates)
        user_content = json.dumps({**data, "templates": templates[data["language"]], "template_example": example}, ensure_ascii=False)
        return self._call_gemini(SYSTEM_PROMPT, user_content)

    def generate_insight(self, data: dict) -> dict:
        user_content = json.dumps(data, ensure_ascii=False)
        return self._call_gemini(INSIGHT_SYSTEM_PROMPT, user_content)

    def extract_results(self, text: str) -> dict:
        return self._call_gemini(EXTRACT_SYSTEM_PROMPT, text[:60000])


def get_llm() -> LLMProvider:
    providers = {
        "template": TemplateProvider,
        "anthropic": AnthropicProvider,
        "gemini": GeminiProvider,
    }
    provider_cls = providers.get(env.llm_provider, TemplateProvider)
    return provider_cls()
