"""Canonical marker codes, categories, and plain-language 'what it measures' descriptions
ported from SM-Report-Analyzer.
Order matters: first matching pattern wins (HBA1C before HB, MCHC before MCH, FT3 before T3)."""
from dataclasses import dataclass
import re

Category = str

CATEGORY_LABELS: dict[str, str] = {
    "BLOOD_COUNT": "Complete blood count",
    "GLUCOSE": "Blood glucose / HbA1c",
    "THYROID": "Thyroid profile",
    "LIPID": "Lipid profile",
    "LIVER": "Liver function",
    "KIDNEY": "Kidney function",
    "VITAMIN": "Vitamins",
    "IRON": "Iron studies",
    "ELECTROLYTE": "Electrolytes / minerals",
    "INFLAMMATION": "Inflammation markers",
    "URINE": "Urine examination",
    "OTHER": "Other investigations",
}


@dataclass(frozen=True)
class Marker:
    code: str
    label: str
    cat: str
    pattern: re.Pattern
    info: str


CBC = "BLOOD_COUNT"

MARKERS: list[Marker] = [
    Marker("HBA1C", "HbA1c", "GLUCOSE", re.compile(r"hba1c|glycated|glycosylated|a1c", re.I),
           "HbA1c reflects the average blood sugar level over roughly the previous 2-3 months."),
    Marker("EAG", "Estimated average glucose", "GLUCOSE", re.compile(r"estimated average glucose|\beag\b", re.I),
           "Estimated average glucose is calculated from HbA1c and expresses it as a blood sugar value."),
    Marker("HB", "Haemoglobin", CBC, re.compile(r"\b(h(a)?emoglobin|hb|hgb)\b", re.I),
           "Haemoglobin is the protein in red blood cells that carries oxygen around the body."),
    Marker("MCHC", "MCHC", CBC, re.compile(r"\bmchc\b|mean corpuscular h(a)?emoglobin concentration", re.I),
           "MCHC is the concentration of haemoglobin inside red blood cells."),
    Marker("MCH", "MCH", CBC, re.compile(r"\bmch\b|mean corpuscular h(a)?emoglobin", re.I),
           "MCH is the average amount of haemoglobin in each red blood cell."),
    Marker("MCV", "MCV", CBC, re.compile(r"\bmcv\b|mean corpuscular volume", re.I),
           "MCV is the average size of the red blood cells."),
    Marker("RDW_SD", "RDW-SD", CBC, re.compile(r"rdw.?sd", re.I),
           "RDW shows how much red blood cells vary in size."),
    Marker("RDW_CV", "RDW-CV", CBC, re.compile(r"rdw.?cv|^rdw$|red cell distribution width", re.I),
           "RDW shows how much red blood cells vary in size."),
    Marker("RBC", "RBC count", CBC, re.compile(r"\brbc\b|red blood cell|erythrocyte count|total rbc", re.I),
           "The RBC count is the number of red blood cells, which carry oxygen."),
    Marker("PCV", "PCV / Haematocrit", CBC, re.compile(r"\bpcv\b|h(a)?ematocrit|\bhct\b|packed cell volume", re.I),
           "PCV (haematocrit) is the share of the blood volume made up of red blood cells."),
    Marker("WBC", "Total leucocyte count", CBC, re.compile(r"total leu[ck]ocyte|\bwbc\b|\btlc\b|white blood cell", re.I),
           "The white blood cell count measures the cells that help the body fight infection."),
    Marker("PLT", "Platelet count", CBC, re.compile(r"^platelets?( count)?$|platelet count|\bplt\b", re.I),
           "Platelets are blood cells that help blood to clot."),
    Marker("MPV", "MPV", CBC, re.compile(r"\bmpv\b|mean platelet volume", re.I),
           "MPV is the average size of the platelets."),
    Marker("PDW", "PDW", CBC, re.compile(r"\bpdw\b|platelet distribution width", re.I),
           "PDW shows how much platelets vary in size."),
    Marker("PLCR", "P-LCR", CBC, re.compile(r"p.?lcr|platelet large cell ratio", re.I),
           "P-LCR is the share of larger platelets."),
    Marker("PCT", "Plateletcrit", CBC, re.compile(r"plateletcrit|\bpct\b", re.I),
           "Plateletcrit is the share of blood volume made up of platelets."),
    Marker("MENTZER", "Mentzer index", CBC, re.compile(r"mentzer", re.I),
           "The Mentzer index is a ratio calculated by the laboratory from MCV and the RBC count."),
    Marker("RDWI", "RDWI", CBC, re.compile(r"\brdwi\b", re.I),
           "RDWI is an index calculated by the laboratory from red-cell measurements."),
    Marker("EOS_ABS", "Eosinophils (absolute)", CBC, re.compile(r"absolute eosinophil|eosinophils? (absolute|count)|\baec\b", re.I),
           "Eosinophils are a type of white blood cell involved in allergic reactions and some infections."),
    Marker("EOS_PCT", "Eosinophils %", CBC, re.compile(r"eosinophil", re.I),
           "Eosinophils are a type of white blood cell involved in allergic reactions and some infections."),
    Marker("NEU_ABS", "Neutrophils (absolute)", CBC, re.compile(r"absolute neutrophil|neutrophils? absolute|\banc\b", re.I),
           "Neutrophils are the most common white blood cells and help fight bacterial infection."),
    Marker("NEU_PCT", "Neutrophils %", CBC, re.compile(r"neutrophil", re.I),
           "Neutrophils are the most common white blood cells and help fight bacterial infection."),
    Marker("LYM_ABS", "Lymphocytes (absolute)", CBC, re.compile(r"absolute lymphocyte|lymphocytes? absolute", re.I),
           "Lymphocytes are white blood cells that are part of the immune system."),
    Marker("LYM_PCT", "Lymphocytes %", CBC, re.compile(r"lymphocyte", re.I),
           "Lymphocytes are white blood cells that are part of the immune system."),
    Marker("MONO_PCT", "Monocytes %", CBC, re.compile(r"monocyte", re.I),
           "Monocytes are white blood cells that help remove damaged cells and germs."),
    Marker("BASO_PCT", "Basophils %", CBC, re.compile(r"basophil", re.I),
           "Basophils are a small group of white blood cells involved in allergic responses."),
    Marker("ESR", "ESR", "INFLAMMATION", re.compile(r"\besr\b|erythrocyte sedimentation", re.I),
           "ESR is a general, non-specific measure related to inflammation in the body."),
    Marker("FT3", "Free T3", "THYROID", re.compile(r"free t3|\bft3\b|free triiodothyronine", re.I),
           "Free T3 is the active, unbound form of a thyroid hormone."),
    Marker("FT4", "Free T4", "THYROID", re.compile(r"free t4|\bft4\b|free thyroxine", re.I),
           "Free T4 is the unbound form of the main hormone made by the thyroid gland."),
    Marker("T3", "T3 (total)", "THYROID", re.compile(r"(total )?\bt3\b|triiodothyronine", re.I),
           "T3 is a thyroid hormone that helps control the body's metabolism."),
    Marker("T4", "T4 (total)", "THYROID", re.compile(r"(total )?\bt4\b|thyroxine", re.I),
           "T4 is the main hormone made by the thyroid gland."),
    Marker("TSH", "TSH", "THYROID", re.compile(r"\btsh\b|thyroid stimulating", re.I),
           "TSH is made by the pituitary gland and tells the thyroid gland how much hormone to make."),
    Marker("GLU_F", "Fasting glucose", "GLUCOSE", re.compile(r"fasting (blood |plasma )?(glucose|sugar)|\bfbs\b|glucose.*fasting", re.I),
           "Fasting glucose is the blood sugar level after not eating for several hours."),
    Marker("GLU_PP", "Post-prandial glucose", "GLUCOSE", re.compile(r"post.?prandial|\bppbs\b|glucose.*pp\b", re.I),
           "Post-meal glucose is the blood sugar level measured after eating."),
    Marker("GLU_R", "Random glucose", "GLUCOSE", re.compile(r"random (blood |plasma )?(glucose|sugar)|\brbs\b", re.I),
           "Random glucose is the blood sugar level at any time of day."),
    Marker("CHOL_LDL_HDL", "LDL / HDL ratio", "LIPID", re.compile(r"ldl.*hdl.*ratio|ldl\s*/\s*hdl", re.I),
           "A ratio the laboratory calculates from LDL and HDL cholesterol."),
    Marker("CHOL_TC_HDL", "Total cholesterol / HDL ratio", "LIPID", re.compile(r"(total )?cholesterol.*hdl.*ratio|tc\s*/\s*hdl|chol\s*/\s*hdl", re.I),
           "A ratio the laboratory calculates from total and HDL cholesterol."),
    Marker("TG_HDL", "TG / HDL ratio", "LIPID", re.compile(r"trig.*hdl.*ratio|tg\s*/\s*hdl", re.I),
           "A ratio the laboratory calculates from triglycerides and HDL cholesterol."),
    Marker("NON_HDL", "Non-HDL cholesterol", "LIPID", re.compile(r"non.?hdl", re.I),
           "Non-HDL cholesterol is total cholesterol minus HDL cholesterol."),
    Marker("LDL", "LDL cholesterol", "LIPID", re.compile(r"\bldl\b|low density", re.I),
           "LDL cholesterol is often called 'bad' cholesterol because it can build up in blood vessels."),
    Marker("VLDL", "VLDL cholesterol", "LIPID", re.compile(r"\bvldl\b|very low density", re.I),
           "VLDL carries mainly triglycerides in the blood."),
    Marker("HDL", "HDL cholesterol", "LIPID", re.compile(r"\bhdl\b|high density", re.I),
           "HDL cholesterol is often called 'good' cholesterol because it helps remove cholesterol from blood vessels."),
    Marker("TG", "Triglycerides", "LIPID", re.compile(r"triglyceride", re.I),
           "Triglycerides are a type of fat in the blood."),
    Marker("CHOL", "Total cholesterol", "LIPID", re.compile(r"^(total |serum )?cholesterol( total)?$|^cholesterol", re.I),
           "Total cholesterol is the overall amount of cholesterol in the blood."),
    Marker("VITD", "Vitamin D (25-OH)", "VITAMIN", re.compile(r"vitamin d|25.?oh|25.?hydroxy", re.I),
           "Vitamin D helps the body absorb calcium and keep bones healthy."),
    Marker("B12", "Vitamin B12", "VITAMIN", re.compile(r"\bb.?12\b|cobalamin", re.I),
           "Vitamin B12 is needed to make red blood cells and to keep nerves healthy."),
    Marker("FOLATE", "Folate", "VITAMIN", re.compile(r"folate|folic acid", re.I),
           "Folate is a B vitamin needed to make healthy cells, including red blood cells."),
    Marker("FERRITIN", "Ferritin", "IRON", re.compile(r"ferritin", re.I),
           "Ferritin reflects how much iron the body has stored."),
    Marker("TIBC", "TIBC", "IRON", re.compile(r"\btibc\b|total iron binding", re.I),
           "TIBC measures how much iron the blood could carry."),
    Marker("TSAT", "Transferrin saturation", "IRON", re.compile(r"transferrin saturation|% ?saturation|\btsat\b", re.I),
           "Transferrin saturation is the share of the iron-carrying protein that is carrying iron."),
    Marker("IRON", "Serum iron", "IRON", re.compile(r"^(serum )?iron$|^iron\b", re.I),
           "Serum iron is the amount of iron circulating in the blood."),
    Marker("BUN", "Blood urea nitrogen", "KIDNEY", re.compile(r"\bbun\b|urea nitrogen", re.I),
           "BUN is a waste product filtered by the kidneys."),
    Marker("UREA", "Urea", "KIDNEY", re.compile(r"urea", re.I),
           "Urea is a waste product filtered by the kidneys."),
    Marker("CREAT", "Creatinine", "KIDNEY", re.compile(r"creatinine", re.I),
           "Creatinine is a waste product from muscles that the kidneys filter out."),
    Marker("EGFR", "eGFR", "KIDNEY", re.compile(r"\begfr\b|glomerular filtration", re.I),
           "eGFR is an estimate of how well the kidneys filter the blood."),
    Marker("URIC", "Uric acid", "KIDNEY", re.compile(r"uric acid", re.I),
           "Uric acid is a waste product of the breakdown of certain foods and cells."),
    Marker("ALT", "ALT (SGPT)", "LIVER", re.compile(r"sgpt|\balt\b|alanine", re.I),
           "ALT is an enzyme found mainly in the liver."),
    Marker("AST", "AST (SGOT)", "LIVER", re.compile(r"sgot|\bast\b|aspartate", re.I),
           "AST is an enzyme found in the liver, heart and muscles."),
    Marker("ALP", "Alkaline phosphatase", "LIVER", re.compile(r"alkaline phosphatase|\balp\b", re.I),
           "Alkaline phosphatase is an enzyme found in the liver and bones."),
    Marker("GGT", "GGT", "LIVER", re.compile(r"\bggt\b|gamma", re.I),
           "GGT is an enzyme found mainly in the liver."),
    Marker("BILI_D", "Bilirubin (direct)", "LIVER", re.compile(r"bilirubin.*direct|direct bilirubin|conjugated", re.I),
           "Bilirubin is a yellow substance made when red blood cells break down; the liver processes it."),
    Marker("BILI_I", "Bilirubin (indirect)", "LIVER", re.compile(r"bilirubin.*indirect|indirect bilirubin|unconjugated", re.I),
           "Bilirubin is a yellow substance made when red blood cells break down; the liver processes it."),
    Marker("BILI_T", "Bilirubin (total)", "LIVER", re.compile(r"bilirubin", re.I),
           "Bilirubin is a yellow substance made when red blood cells break down; the liver processes it."),
    Marker("ALB", "Albumin", "LIVER", re.compile(r"^(serum )?albumin$", re.I),
           "Albumin is a protein made by the liver."),
    Marker("PROT", "Total protein", "LIVER", re.compile(r"total protein|^protein$", re.I),
           "Total protein is the amount of protein in the blood."),
    Marker("HSCRP", "hs-CRP", "INFLAMMATION", re.compile(r"hs.?crp|high sensitivity c.?reactive", re.I),
           "hs-CRP is a sensitive measure of a protein that rises with inflammation."),
    Marker("CRP", "CRP", "INFLAMMATION", re.compile(r"c.?reactive protein|\bcrp\b", re.I),
           "CRP is a protein that rises with inflammation in the body."),
    Marker("SODIUM", "Sodium", "ELECTROLYTE", re.compile(r"sodium|^(serum )?na\+?$", re.I),
           "Sodium is a mineral that helps control fluid balance and nerve function."),
    Marker("POTASSIUM", "Potassium", "ELECTROLYTE", re.compile(r"potassium|^(serum )?k\+?$", re.I),
           "Potassium is a mineral important for nerves, muscles and the heart."),
    Marker("CHLORIDE", "Chloride", "ELECTROLYTE", re.compile(r"chloride|^(serum )?cl-?$", re.I),
           "Chloride is a mineral that helps keep fluid and acid balance."),
    Marker("CALCIUM", "Calcium", "ELECTROLYTE", re.compile(r"calcium", re.I),
           "Calcium is a mineral important for bones, muscles and nerves."),
    Marker("U_PROTEIN", "Urine protein", "URINE", re.compile(r"urine.*(protein|albumin)|(protein|albumin).*urine", re.I),
           "Urine protein checks whether protein is passing into the urine."),
    Marker("U_GLUCOSE", "Urine glucose", "URINE", re.compile(r"urine.*(glucose|sugar)|(glucose|sugar).*urine", re.I),
           "Urine glucose checks whether sugar is passing into the urine."),
]


def normalize_marker_name(name: str) -> str:
    s = name.lower()
    s = re.sub(r"[\u2013\u2014]", "-", s)
    s = re.sub(r"[,;]+", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def find_marker(name: str) -> Marker | None:
    norm = normalize_marker_name(name)
    for m in MARKERS:
        if m.pattern.search(norm):
            return m
    return None


def marker_code(name: str) -> str:
    m = find_marker(name)
    if m:
        return m.code
    norm = normalize_marker_name(name)
    slug = re.sub(r"[^A-Z0-9]+", "_", norm.upper()).strip("_")[:60]
    return f"X:{slug}"


def marker_category(name: str, test_name: str | None = None) -> str:
    m = find_marker(name)
    if m:
        return m.cat
    t = (test_name or "").lower()
    if re.search(r"blood count|cbc|haemogram|hemogram", t):
        return CBC
    if "thyroid" in t:
        return "THYROID"
    if "lipid" in t:
        return "LIPID"
    if re.search(r"liver|lft|hepatic", t):
        return "LIVER"
    if re.search(r"kidney|renal|kft|rft", t):
        return "KIDNEY"
    if re.search(r"diabet|glucose|sugar", t):
        return "GLUCOSE"
    if "vitamin" in t:
        return "VITAMIN"
    if "iron" in t:
        return "IRON"
    if "urine" in t:
        return "URINE"
    if "electrolyte" in t:
        return "ELECTROLYTE"
    return "OTHER"


def marker_label(code: str, fallback: str | None = None) -> str:
    for m in MARKERS:
        if m.code == code:
            return m.label
    if fallback:
        return fallback
    return re.sub(r"^X:", "", code).replace("_", " ")


def marker_info(code: str) -> str | None:
    for m in MARKERS:
        if m.code == code:
            return m.info
    return None
