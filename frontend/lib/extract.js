/**
 * PDF Extraction Engine & Clinical Parameter Validation (ES Module)
 * Ported from backend/app/extract.py and backend/app/analysis.py.
 */

export const UNITS = {
  "mg/dl": "mg/dL",
  "g/dl": "g/dL",
  "ng/ml": "ng/mL",
  "pg/ml": "pg/mL",
  "miu/l": "mIU/L",
  "uiu/ml": "µIU/mL",
  "µiu/ml": "µIU/mL",
  "u/l": "U/L",
  "iu/l": "IU/L",
  "%": "%",
};

export const KNOWN_UNITS = new Set([
  ...Object.keys(UNITS),
  "mmol/l",
  "µmol/l",
  "umol/l",
  "fl",
  "pg",
  "10^3/µl",
  "10^6/µl",
  "x10^3/ul",
  "x10^6/ul",
  "thou/µl",
  "mill/µl",
  "cells/µl",
  "meq/l",
  "mg/l",
  "µg/dl",
  "ug/dl",
  "miu/ml",
  "ng/dl",
  "mm/hr",
  "sec",
  "gm/dl",
  "µg/l",
  "ug/l",
  "ml/min/1.73m2",
]);

export const DEFAULT_REFERENCE_RANGES = {
  HBA1C: { unit: "%", bands: [["normal", null, 5.7], ["prediabetes", 5.7, 6.5], ["diabetes_range", 6.5, null]] },
  GLUCOSE_FASTING: { unit: "mg/dL", bands: [["normal", 70, 100], ["prediabetes", 100, 126], ["diabetes_range", 126, null]] },
  GLUCOSE_PP: { unit: "mg/dL", bands: [["normal", null, 140], ["prediabetes", 140, 200], ["diabetes_range", 200, null]] },
  CHOL_TOTAL: { unit: "mg/dL", bands: [["desirable", null, 200], ["high", 200, null]] },
  LDL: { unit: "mg/dL", bands: [["optimal", null, 100], ["near_optimal", 100, 130], ["borderline", 130, 160], ["high", 160, null]] },
  HDL: { unit: "mg/dL", low_below: { M: 40, F: 50 } },
  TRIGLYCERIDES: { unit: "mg/dL", bands: [["normal", null, 150], ["borderline", 150, 200], ["high", 200, 500], ["very_high", 500, null]] },
  HEMOGLOBIN: { unit: "g/dL", low_below: { M: 13, F: 12 } },
  VITAMIN_D: { unit: "ng/mL", bands: [["deficient", null, 20], ["insufficient", 20, 30], ["sufficient", 30, null]] },
  EGFR: { unit: "mL/min/1.73m2", bands: [["abnormal", null, 60], ["normal", 60, null]] },
};

export const DEFAULT_ALIASES = {
  "glycosylated hemoglobin": "HBA1C",
  "hba1c": "HBA1C",
  "a1c": "HBA1C",
  "fasting blood sugar": "GLUCOSE_FASTING",
  "fbs": "GLUCOSE_FASTING",
  "glucose fasting": "GLUCOSE_FASTING",
  "post prandial glucose": "GLUCOSE_PP",
  "ppbs": "GLUCOSE_PP",
  "total cholesterol": "CHOL_TOTAL",
  "cholesterol total": "CHOL_TOTAL",
  "ldl cholesterol": "LDL",
  "ldl": "LDL",
  "hdl cholesterol": "HDL",
  "hdl": "HDL",
  "triglycerides": "TRIGLYCERIDES",
  "tg": "TRIGLYCERIDES",
  "haemoglobin": "HEMOGLOBIN",
  "hemoglobin": "HEMOGLOBIN",
  "hb": "HEMOGLOBIN",
  "tsh": "TSH",
  "ft3": "FT3",
  "free t3": "FT3",
  "ft4": "FT4",
  "free t4": "FT4",
  "creatinine": "CREATININE",
  "serum creatinine": "CREATININE",
  "sgot": "SGOT",
  "ast": "SGOT",
  "sgpt": "SGPT",
  "alt": "SGPT",
  "vitamin d": "VITAMIN_D",
  "25-oh vitamin d": "VITAMIN_D",
  "egfr": "EGFR",
};

export const DEFAULT_SEVERITY = {
  mild_max_pct: 10,
  moderate_max_pct: 25,
};

const NORMAL_LABELS = new Set(["normal", "desirable", "optimal", "sufficient"]);
const NUM = "-?\\d+(?:\\.\\d+)?";
const METHODS = (
  "(?:C\\.?L\\.?I\\.?A|E\\.?C\\.?L\\.?I\\.?A|C\\.?M\\.?I\\.?A|H\\.?P\\.?L\\.?C|E\\.?L\\.?I\\.?S\\.?A|I\\.?S\\.?E|PHOTOMETRY|" +
  "SPECTROPHOTOMETRY|IMMUNOTURBIDIMETRY|CALCULATED|CALCULATION|DERIVED|FLOW CYTOMETRY|MICROSCOPY|" +
  "LC-?MS/?MS|ICP-?MS|NEPHELOMETRY|TURBIDIMETRY|ENZYMATIC|COLORIMETRY|POTENTIOMETRY)"
);
const ROW = new RegExp(
  `^([A-Za-z0-9(].*?[A-Za-z0-9)\\]])(?:\\s+${METHODS})?\\s+([<>]?\\s?${NUM})(?:\\s+([^\\s\\d<>\\-][^\\s]*))?\\s*(.*)$`,
  "i"
);
const NOT_A_TEST = /\b(age|sex|gender|date|page|barcode|collected|received|reported|printed|mobile|phone|pin|ref|patient|sample|lab code|order|years?|tel|fax)\b|:/i;
const PRIVATE_LINE = /\b(name|patient|address|mobile|phone|e-?mail|ref\.? ?by|referred|barcode|client|booked|aadhaar|pin ?code)\b/i;

/**
 * Normal range parser supporting '<', '<=', '≤', '>', '>=', '≥', '-', 'to', en-dash, em-dash, commas.
 * Returns [low, high, low_excl, high_excl] or null.
 */
export function parseRange(text) {
  if (typeof text !== "string") return null;
  const s = text.trim().replace(/–/g, "-").replace(/—/g, "-").replace(/,/g, "");
  if (!s) return null;

  const opMatch = s.match(new RegExp(`^(<=?|≤|>=?|≥)\\s*(${NUM})$`));
  if (opMatch) {
    const op = opMatch[1];
    const v = parseFloat(opMatch[2]);
    if (op === "<" || op === "<=" || op === "≤") {
      return [null, v, false, op === "<"];
    }
    return [v, null, op === ">", false];
  }

  const rangeMatch = s.match(new RegExp(`^(${NUM})\\s*(?:-|to)\\s*(${NUM})$`));
  if (rangeMatch) {
    return [parseFloat(rangeMatch[1]), parseFloat(rangeMatch[2]), false, false];
  }

  return null;
}

/**
 * Cleans commas, extracts numeric float and raw text.
 * Returns [floatVal, textVal] where textVal is capped at 60 chars.
 */
export function parseValue(raw) {
  if (raw === null || raw === undefined) return [null, ""];
  const text = String(raw).trim();
  const cleaned = text.replace(/,/g, "");
  const m = cleaned.match(new RegExp(`^[<>]?\\s*(${NUM})$`));
  const num = m ? parseFloat(m[1]) : null;
  const strVal = text.slice(0, 60);
  const res = [num, strVal];
  res.value_num = num;
  res.value_text = strVal;
  return res;
}

/**
 * Maps a test name to its canonical code using the provided aliases map.
 * Also checks base name and parenthetical descriptions if compound (e.g. "HbA1c (Glycosylated Hemoglobin)").
 */
export function canonicalCode(name, aliases = DEFAULT_ALIASES) {
  if (!name) return "";
  const key = String(name).trim().toLowerCase().replace(/\s+/g, " ");
  if (aliases[key]) return aliases[key];

  const parenMatch = key.match(/^([^(]+)\s*\(([^)]+)\)$/);
  if (parenMatch) {
    const base = parenMatch[1].trim();
    if (aliases[base]) return aliases[base];
    const inside = parenMatch[2].trim();
    if (aliases[inside]) return aliases[inside];
  }

  // Handle common prefixes like "serum "
  if (key.startsWith("serum ")) {
    const stripped = key.slice(6).trim();
    if (aliases[stripped]) return aliases[stripped];
  }

  return "";
}

/**
 * Normalizes a unit string.
 */
export function normalizeUnit(unit) {
  if (!unit) return "";
  const trimmed = String(unit).trim();
  return UNITS[trimmed.toLowerCase()] || trimmed;
}

/**
 * Determines severity band based on deviation percentage.
 */
export function severityFor(devPct, sev = DEFAULT_SEVERITY) {
  const mildMax = sev?.mild_max_pct ?? 10;
  const modMax = sev?.moderate_max_pct ?? 25;
  if (devPct < mildMax) return "mild";
  return devPct < modMax ? "moderate" : "severe";
}

function normalizeGender(g) {
  const str = String(g || "").trim().toLowerCase();
  return str === "m" || str === "male" ? "M" : str === "f" || str === "female" ? "F" : "";
}

function reportRangeFlag(v, low, high, lowEx, highEx) {
  if (low !== null && (v < low || (lowEx && v === low))) {
    return ["LOW", low];
  }
  if (high !== null && (v > high || (highEx && v === high))) {
    return ["HIGH", high];
  }
  return ["NORMAL", null];
}

function fallbackFlag(code, v, gender, ranges) {
  const spec = ranges?.[code];
  if (!spec) return null;

  if ("low_below" in spec) {
    const thr = spec.low_below?.[gender];
    if (thr === undefined || thr === null || !gender) {
      return null; // sex-specific range but sex unknown: do not guess
    }
    return v < thr ? ["LOW", thr] : ["NORMAL", null];
  }

  const normal = (spec.bands || []).find((b) => NORMAL_LABELS.has(b[0]));
  if (!normal) return null;

  const [, lo, hi] = normal;
  if (lo !== null && v < lo) {
    return ["LOW", lo];
  }
  if (hi !== null && v >= hi) {
    return ["HIGH", hi];
  }
  return ["NORMAL", null];
}

/**
 * Flags a parameter following 3-tier precedence:
 * (1) Report range (report range always wins over fallback)
 * (2) Admin fallback table (reference_ranges, respecting sex-specific low bounds and not guessing for unknown sex)
 * (3) Printed lab flag (H/L mild)
 *
 * Supports signatures:
 *   flagParameter(param, rules, patientSex)
 *   flagParameter(param, patientSex, rules)
 */
export function flagParameter(param, arg2, arg3) {
  let rules = DEFAULT_REFERENCE_RANGES;
  let rawGender = "";

  if (arg2 && typeof arg2 === "object" && (arg2.reference_ranges || arg2.HBA1C || arg2.severity)) {
    rules = arg2;
    rawGender = typeof arg3 === "string" ? arg3 : "";
  } else {
    rawGender = typeof arg2 === "string" ? arg2 : "";
    rules = arg3 && typeof arg3 === "object" ? arg3 : (typeof arg2 === "object" && arg2 ? arg2 : DEFAULT_REFERENCE_RANGES);
  }

  const gender = normalizeGender(rawGender);
  const refRanges = rules.reference_ranges || rules;
  const severityRules = rules.severity || DEFAULT_SEVERITY;

  param.system_flag = "";
  param.severity = "";
  param.deviation_pct = null;
  param.ref_source = "";

  let result = null;
  let source = "";

  if (param.value_num !== null && param.value_num !== undefined) {
    let rng = param.ref_text ? parseRange(param.ref_text) : null;
    if (rng === null && (param.ref_low !== null || param.ref_high !== null)) {
      rng = [param.ref_low ?? null, param.ref_high ?? null, false, false];
    }

    if (rng !== null) {
      result = reportRangeFlag(param.value_num, rng[0], rng[1], rng[2], rng[3]);
      source = "report";
    } else {
      result = fallbackFlag(param.param_code, param.value_num, gender, refRanges);
      if (result !== null) {
        source = "fallback";
      }
    }
  }

  if (result === null) {
    const lf = (param.lab_flag || "").trim().toUpperCase();
    if (lf.startsWith("H") || lf.startsWith("L")) {
      param.system_flag = lf.startsWith("H") ? "HIGH" : "LOW";
      param.severity = "mild";
      param.ref_source = "lab_flag";
    }
    return param;
  }

  param.system_flag = result[0];
  param.ref_source = source;

  if (result[0] !== "NORMAL") {
    const limit = result[1];
    param.deviation_pct = limit
      ? Math.round((Math.abs(param.value_num - limit) / Math.abs(limit)) * 1000) / 10
      : 100.0;
    param.severity = severityFor(param.deviation_pct, severityRules);
  }

  return param;
}

/**
 * Extracts test parameters from text or markdown tables.
 */
export function extractParameters(text, aliases = DEFAULT_ALIASES) {
  if (!text || typeof text !== "string") return [];
  const params = [];
  const seen = new Set();
  const lines = text.split(/\r?\n/);
  let idCounter = 1;

  for (let rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    // Handle markdown table format | col1 | col2 |
    if (line.includes("|")) {
      const cleanedPipes = line.replace(/\|/g, " ").trim();
      if (/^[\s\-:|]+$/.test(cleanedPipes)) continue;
      line = cleanedPipes;
    }
    line = line.replace(/\s+/g, " ");

    const m = line.match(ROW);
    if (!m) continue;

    const name = m[1].trim();
    if (NOT_A_TEST.test(name)) continue;
    const letterCount = (name.match(/[A-Za-z]/g) || []).length;
    if (letterCount < 2) continue;

    const unit = (m[3] || "").trim();
    const rng = (m[4] || "").trim();
    const hasKnownUnit = KNOWN_UNITS.has(unit.toLowerCase());
    const parsedRng = parseRange(rng);
    if (!hasKnownUnit && !parsedRng) continue;

    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());

    const valueStr = m[2].replace(/\s+/g, "");
    const [num, strVal] = parseValue(valueStr);
    const code = canonicalCode(name, aliases);
    const normalizedUnit = normalizeUnit(unit);
    const refLow = parsedRng ? parsedRng[0] : null;
    const refHigh = parsedRng ? parsedRng[1] : null;

    params.push({
      id: idCounter++,
      param_code: code,
      param_name_raw: name,
      value_num: num,
      value_text: strVal,
      unit: normalizedUnit,
      ref_low: refLow,
      ref_high: refHigh,
      ref_text: rng.slice(0, 60),
      system_flag: "",
      severity: "",
      deviation_pct: null,
      ref_source: "",
      lab_flag: "",
    });
  }

  return params;
}

/**
 * Calculates extraction confidence score (0-100) and compiles review reasons.
 * Deductions:
 * - Missing gender: -30
 * - Missing or invalid age (not 0-120): -30
 * - Missing collection date: -10
 * - Inverted reference range (low > high): -20
 * - Unmapped aliases: -min(40, 10 * unmapped)
 * - Non-numeric values: -min(20, 5 * nonnumeric)
 */
export function calculateConfidence(report = {}, parameters = [], unmappedCount, nonnumericCount) {
  let score = 100;
  const reasons = [];

  const gender = normalizeGender(report.gender);
  if (!gender) {
    score -= 30;
    reasons.push("Gender missing");
  }

  const rawAge = report.age;
  const age = rawAge !== null && rawAge !== undefined && rawAge !== "" ? Number(rawAge) : NaN;
  if (isNaN(age) || age < 0 || age > 120 || !Number.isInteger(age)) {
    score -= 30;
    reasons.push("Age missing or invalid");
  }

  if (!report.collected_on) {
    score -= 10;
    reasons.push("Collection date missing");
  }

  for (const p of parameters) {
    if (p.ref_low !== null && p.ref_high !== null && p.ref_low !== undefined && p.ref_high !== undefined && p.ref_low > p.ref_high) {
      score -= 20;
      reasons.push(`Reference range looks wrong for ${p.param_name_raw || p.name || p.param_code}`);
    }
  }

  const unmapped = unmappedCount !== undefined ? unmappedCount : parameters.filter((p) => !p.param_code).length;
  const nonnumeric = nonnumericCount !== undefined ? nonnumericCount : parameters.filter((p) => p.value_num === null || p.value_num === undefined).length;

  if (unmapped > 0) {
    score -= Math.min(40, 10 * unmapped);
    reasons.push(`${unmapped} test name(s) not recognised`);
  }

  if (nonnumeric > 0) {
    score -= Math.min(20, 5 * nonnumeric);
    reasons.push(`${nonnumeric} value(s) are not numbers`);
  }

  score = Math.max(0, score);
  const minConfidence = report.min_confidence ?? 80;
  const needsReview = score < minConfidence;

  const result = {
    score,
    reasons,
    needs_review: needsReview,
  };
  result.valueOf = () => score;
  result.toString = () => String(score);
  result[Symbol.toPrimitive] = (hint) => (hint === "string" ? String(score) : score);
  return result;
}

/**
 * Classifies report as "ABNORMAL" if any parameter has system_flag "LOW" or "HIGH", else "NORMAL".
 */
export function classifyReport(parameters = []) {
  const abnormalCount = countAbnormalParameters(parameters);
  return abnormalCount > 0 ? "ABNORMAL" : "NORMAL";
}

/**
 * Counts abnormal parameters with system_flag "LOW" or "HIGH".
 */
export function countAbnormalParameters(parameters = []) {
  return parameters.filter((p) => p.system_flag === "LOW" || p.system_flag === "HIGH").length;
}

/**
 * Runs full analysis over parameters using provided rules and report demographics.
 */
export function analyse(report, parameters = [], rules = {}) {
  const gender = report?.gender || "";
  for (const p of parameters) {
    flagParameter(p, gender, rules);
  }
  const classification = classifyReport(parameters);
  if (report) {
    report.classification = classification;
    report.abnormal_count = countAbnormalParameters(parameters);
  }
  return classification;
}

/**
 * Scrubs PII from text before sending to any external LLM:
 * - Drops lines matching private metadata patterns
 * - Replaces patient name words (length >= 3) with [name]
 * - Replaces emails with [email]
 * - Replaces 10-digit mobile numbers with [number]
 */
export function redactPII(text, patient = {}) {
  if (!text || typeof text !== "string") return "";

  const lines = text.split(/\r?\n/).filter((ln) => !PRIVATE_LINE.test(ln));
  let out = lines.join("\n");

  const nameParts = String(patient?.name || "").trim().split(/\s+/);
  for (const part of nameParts) {
    if (part.length >= 3) {
      const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(`\\b${escaped}\\b`, "gi"), "[name]");
    }
  }

  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]");
  out = out.replace(/(?<![\d.])(?:\+?91[\s-]?)?\d(?:[\s-]?\d){9}(?![\d.])/g, "[number]");

  return out;
}

/**
 * Cross-checks rule-based extractions against secondary AI parameters and verifies that
 * accepted numeric values literally appear in source markdown.
 * Flags discrepancies with needs_review = true and descriptive reasons.
 */
export function crossCheckExtraction(ruleBasedParams = [], geminiParams = [], sourceMarkdown = "") {
  const discrepancies = [];
  let needsReview = false;

  // 1. Literal source text verification
  if (sourceMarkdown && typeof sourceMarkdown === "string") {
    for (const p of ruleBasedParams) {
      if (p.value_num !== null && p.value_num !== undefined) {
        const textVal = String(p.value_text || "");
        const numVal = String(p.value_num);
        const noCommas = textVal.replace(/,/g, "");

        const appears =
          sourceMarkdown.includes(textVal) ||
          sourceMarkdown.includes(numVal) ||
          sourceMarkdown.includes(noCommas);

        if (!appears) {
          discrepancies.push(
            `Value ${textVal || numVal} for ${p.param_name_raw || p.param_code} not found in source text.`
          );
          needsReview = true;
        }
      }
    }
  }

  // 2. Cross-check against secondary AI params
  if (Array.isArray(geminiParams) && geminiParams.length > 0) {
    const geminiMap = new Map();
    for (const gp of geminiParams) {
      const code = gp.param_code || canonicalCode(gp.name || gp.param_name_raw, DEFAULT_ALIASES);
      if (code) geminiMap.set(code, gp);
      if (gp.name) geminiMap.set(gp.name.trim().toLowerCase(), gp);
      if (gp.param_name_raw) geminiMap.set(gp.param_name_raw.trim().toLowerCase(), gp);
    }

    for (const rp of ruleBasedParams) {
      const gp =
        (rp.param_code && geminiMap.get(rp.param_code)) ||
        (rp.param_name_raw && geminiMap.get(rp.param_name_raw.trim().toLowerCase())) ||
        (rp.name && geminiMap.get(rp.name.trim().toLowerCase()));

      if (gp) {
        const [rbNum] = parseValue(rp.value_num ?? rp.value_text ?? rp.value);
        const [gpNum] = parseValue(gp.value_num ?? gp.value_text ?? gp.value);

        if (rbNum !== null && gpNum !== null) {
          if (Math.abs(rbNum - gpNum) > 0.001) {
            discrepancies.push(
              `Discrepancy in ${rp.param_name_raw || rp.param_code}: rule-based ${rp.value_text ?? rbNum} vs AI ${gp.value_text ?? gp.value ?? gpNum}`
            );
            needsReview = true;
          }
        }

        const rbUnit = normalizeUnit(rp.unit);
        const gpUnit = normalizeUnit(gp.unit);
        if (rbUnit && gpUnit && rbUnit.toLowerCase() !== gpUnit.toLowerCase()) {
          discrepancies.push(
            `Unit mismatch in ${rp.param_name_raw || rp.param_code}: rule-based ${rp.unit} vs AI ${gp.unit}`
          );
          needsReview = true;
        }
      }
    }
  }

  return {
    verifiedParams: ruleBasedParams,
    discrepancies,
    needs_review: needsReview,
    review_reasons: discrepancies,
  };
}
