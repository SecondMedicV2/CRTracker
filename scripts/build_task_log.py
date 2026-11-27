"""Build the single-sheet project task log (Changes / Dates / Times / Status / Project)."""
import re
import subprocess
from datetime import date, datetime
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

ROOT = Path(r"C:\Users\DELL\Documents")
OUT = Path(r"C:\Users\DELL\Downloads\All_Projects_Task_Log_13Nov2026_to_26Nov2026.xlsx")
SINCE = "2026-11-13"
TODAY = date(2026, 11, 26)

REPOS = ["CRTracker", "hhcs-crm", "phlebo-os-sync", "SM-HBD-CRM", "Phlebo-Screening",
         "SmMyERP", "DawaDash", "SM-ERP", "VialTrack", "Thyrocare", "HealthHub",
         "MedVerse", "StaffPortal", "Corporate_BD_CRM", "SM-Report-Analyzer"]

# repo -> project name shown in the "Project" column
PROJECT = {
    "CRTracker": "CRTracker",
    "hhcs-crm": "HHCS CRM",
    "phlebo-os-sync": "Phlebo OS",
    "SM-HBD-CRM": "SM-HBD CRM",
    "Phlebo-Screening": "Phlebo Screening",
    "SmMyERP": "SM ERP",
    "DawaDash": "DawaDash",
    "SM-ERP": "SM ERP",
    "VialTrack": "VialTrack",
    "Thyrocare": "Thyrocare",
    "HealthHub": "HealthHub",
    "MedVerse": "MedVerse",
    "StaffPortal": "StaffPortal",
    "Corporate_BD_CRM": "Corporate BD CRM",
    "SM-Report-Analyzer": "SM Report Analyzer",
}

# Dupilcate local clones of the same remote -> count once
DUPLICATES = {"phlebo-os", "hhcs-crm-bmm-release"}

SEP = "\x1f"
REC = "\x1e"


def git(repo, *args, timeout=120):
    r = subprocess.run(["git", "-C", str(ROOT / repo), *args],
                       capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=timeout)
    return r.stdout


def numstat(repo, sha):
    add = dele = 0
    for line in git(repo, "show", "--numstat", "--format=", sha).splitlines():
        p = line.split("\t")
        if len(p) == 3:
            if p[0].isdigit():
                add += int(p[0])
            if p[1].isdigit():
                dele += int(p[1])
    return add, dele


def classify(subject):
    s = subject.lower()
    if s.startswith("merge") or "merge pull request" in s:
        return "Merge"
    for key, label in (
        ("fix", "Bug Fix"), ("bug", "Bug Fix"), ("hotfix", "Bug Fix"),
        ("feat", "Feature"), ("add", "Feature"), ("implement", "Feature"),
        ("creat", "Feature"), ("build", "Feature"), ("new ", "Feature"),
        ("refactor", "Refactor"), ("clean", "Refactor"), ("restructur", "Refactor"),
        ("test", "Testing"), ("qa", "Testing"), ("audit", "Review / Audit"),
        ("doc", "Docs"), ("readme", "Docs"), ("prompt", "Docs"),
        ("deploy", "Deployment"), ("release", "Deployment"), ("ci", "Deployment"),
        ("perf", "Performance"), ("optimi", "Performance"),
        ("style", "UI / Styling"), ("ui", "UI / Styling"), ("design", "UI / Styling"),
        ("mobil", "UI / Styling"), ("css", "UI / Styling"),
        ("chore", "Maintenance"), ("config", "Maintenance"), ("updat", "Maintenance"),
    ):
        if key in s:
            return label
    return "Task"


def clean(subject):
    """Turn a commit subject into a human task description."""
    s = subject.strip()
    s = re.sub(r"^(feat|fix|chore|style|refactor|docs|test|perf|build|ci|ui)"
               r"(\([^)]*\))?\s*:\s*", "", s, flags=re.I)
    s = re.sub(r"^Merge pull request #(\d+) from \S+", r"Merged PR #\1:", s)
    s = re.sub(r"^Merge branch '([^']+)'", r"Merged branch \1:", s)
    s = s.replace("_", " ")
    s = s.replace(" \u2014 ", ": ").replace("\u2014", "-")
    s = re.sub(r":\s*$", "", s)
    s = re.sub(r"\bfeat|fix|chore|docs|(?:[a-z]+(?:\([^)]*\))?):\s*", "", s, flags=re.I)
    s = re.sub(r"\s{2,}", " ", s)
    s = " ".join(s.split())
    if not s:
        return subject.strip()
    s = s[0].upper() + s[1:]
    if not s.endswith((".", "!", "?")):
        s += "."
    return s


def to_local(iso):
    return datetime.fromisoformat(iso)


def main():
    rows = []
    for repo in REPOS:
        if repo in DUPLICATES or not (ROOT / repo / ".git").exists():
            continue
        log = git(repo, "log", f"--since={SINCE}", "--date=iso-strict",
                  f"--pretty=format:%h{SEP}%aI{SEP}%cI{SEP}%s{SEP}%b{REC}")
        for rec in log.split(REC):
            rec = rec.strip("\r\n")
            if not rec:
                continue
            p = rec.split(SEP)
            if len(p) < 5:
                continue
            sha, authored, committed, subject, body = p
            if len(p) > 5:
                body = SEP.join(p[4:])
            start = to_local(authored)
            done = to_local(committed)
            if start.date() < date.fromisoformat(SINCE) and done.date() < date.fromisoformat(SINCE):
                continue
            task = clean(subject)
            if body.strip():
                extra = " ".join(body.split())
                if len(extra) > 180:
                    extra = extra[:177] + "..."
                task = f"{task.rstrip('.')}: {extra}"
                if not task.endswith((".", "!", "?")):
                    task += "."
            rows.append({
                "Changes": task,
                "Assigned Date": start.date(),
                "Completion Date": done.date(),
                "Start Time": start.strftime("%H:%M"),
                "Done Time": done.strftime("%H:%M"),
                "Status": "Completed",
                "Project": PROJECT.get(repo, repo),
                "_sha": sha,
                "_type": classify(subject),
                "_dur": int((done - start).total_seconds() // 60),
                "_add": numstat(repo, sha)[0],
                "_del": numstat(repo, sha)[1],
            })

    rows.sort(key=lambda r: (r["Assigned Date"], r["Start Time"], r["Project"]))

    wb = Workbook()
    ws = wb.active
    ws.title = "Task Log"
    headers = ["Changes", "Assigned Date", "Completion Date", "Start Time",
               "Done Time", "Status", "Project"]
    ws.append(headers)

    hdr_fill = PatternFill("solid", fgColor="1F3864")
    hdr_font = Font(color="FFFFFF", bold=True, size=10)
    thin = Side(style="thin", color="BFBFBF")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    for c in ws[1]:
        c.fill, c.font, c.border = hdr_fill, hdr_font, border
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    for row in rows:
        ws.append([row[h] for h in headers])

    alt = PatternFill("solid", fgColor="F2F5FA")
    done_fill = PatternFill("solid", fgColor="E2EFDA")
    for i, r in enumerate(ws.iter_rows(min_row=2, max_row=ws.max_row, max_col=len(headers)), start=0):
        for c in r:
            c.border = border
            c.font = Font(size=10)
            if c.column == 1:
                c.alignment = Alignment(vertical="top", wrap_text=True)
            elif c.column in (2, 3):
                c.alignment = Alignment(horizontal="center", vertical="top")
                c.number_format = "yyyy-mm-dd"
                c.alignment = Alignment(horizontal="center", vertical="top")
            elif c.column in (4, 5):
                c.alignment = Alignment(horizontal="center", vertical="top")
            else:
                c.alignment = Alignment(horizontal="center", vertical="top", wrap_text=True)
        if i % 2:
            for c in r:
                c.fill = alt
    for r in ws.iter_rows(min_row=2, max_row=ws.max_row, min_col=6, max_col=6):
        for c in r:
            c.fill = done_fill

    for i, w in enumerate([80, 14, 15, 11, 11, 12, 20], start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[1].height = 26
    ws.freeze_panes = "A2"

    if rows:
        ref = f"A1:{get_column_letter(len(headers))}{ws.max_row}"
        t = Table(displayName="tblTaskLog", ref=ref)
        t.tableStyleInfo = TableStyleInfo(name="TableStyleLight1", showRowStripes=True)
        ws.add_table(t)
        ws.auto_filter.ref = ref

    OUT.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT)
    print(f"tasks={len(rows)} projects={len({r['Project'] for r in rows})}")
    print(OUT)


if __name__ == "__main__":
    main()
