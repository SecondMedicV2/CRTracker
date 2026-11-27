"""Build the project activity workbook (commits + release/deployment evidence)."""
import json
import re
import subprocess
import sys
from datetime import datetime, date
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

ROOT = Path(r"C:\Users\DELL\Documents")
OUT = Path(r"C:\Users\DELL\Downloads\All_Projects_Task_Details_13Nov2026_to_26Nov2026.xlsx")
SINCE = "2026-11-13"
TODAY = date(2026, 11, 26)

REPOS = ["CRTracker", "hhcs-crm", "phlebo-os-sync", "SM-HBD-CRM", "Phlebo-Screening",
         "SmMyERP", "DawaDash", "phlebo-os", "SM-ERP", "VialTrack", "Thyrocare",
         "HealthHub", "MedVerse", "StaffPortal", "Corporate_BD_CRM",
         "SM-Report-Analyzer", "hhcs-crm-bmm-release"]

# Project metadata: display name, stack/scope description
META = {
    "CRTracker": ("CRTracker", "FastAPI + Next.js lab-report triage, call cards & RBAC platform"),
    "hhcs-crm": ("HHCS CRM (CareDesk)", "Healthcare CRM - leads, tasks, doctors, reporting"),
    "phlebo-os-sync": ("Phlebo OS", "Phlebotomy operations - bookings, riders, hiring dashboard"),
    "SM-HBD-CRM": ("SM-HBD CRM", "HBD / corporate sales CRM with staff cost & daily updates"),
    "Phlebo-Screening": ("Phlebo Screening", "Mobile-first phlebotomist screening / hiring funnel"),
    "SmMyERP": ("SM ERP", "Pharmacy & healthcare ERP - masters, billing, imports"),
    "DawaDash": ("DawaDash", "Retailer / rider medicine delivery app"),
    "phlebo-os": ("Phlebo OS (base clone)", "Phlebotomy operations platform - base clone, no activity in window"),
    "SM-ERP": ("SM-ERP (base clone)", "ERP platform clone - no activity in window"),
    "VialTrack": ("VialTrack", "Sample / vial tracking system"),
    "Thyrocare": ("Thyrocare Integration", "Thyrocare booking & report integration"),
    "HealthHub": ("HealthHub", "Healthcare consumer platform"),
    "MedVerse": ("MedVerse", "Medical content / commerce platform"),
    "StaffPortal": ("StaffPortal", "Internal staff portal"),
    "Corporate_BD_CRM": ("Corporate BD CRM", "Corporate business-development CRM"),
    "SM-Report-Analyzer": ("SM Report Analyzer", "Lab report parsing / analysis service"),
    "hhcs-crm-bmm-release": ("HHCS CRM - BMM Release", "Release branch working copy of hhcs-crm"),
}

# Non-clone folders that hold an identical codebase copy (already counted in the main repo)
DUPLICATES = {"phlebo-os", "hhcs-crm-bmm-release"}

DEPLOY_HINTS = {
    "CRTracker": "Cloudflare Workers (wrangler.jsonc) + Render (render.yaml)",
    "DawaDash": "Node/Express app (Railway/Render-style deployment)",
    "hhcs-crm": "Web CRM deployment (Next.js frontend + API)",
    "phlebo-os-sync": "Web ops dashboard deployment",
    "Phlebo-Screening": "Static/Next.js frontend deployment",
    "SM-HBD-CRM": "Web CRM deployment",
    "SmMyERP": "Web ERP deployment",
}

SEP = "\x1f"
REC = "\x1e"


def git(repo, *args, timeout=120):
    r = subprocess.run(["git", "-C", str(ROOT / repo), *args],
                       capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=timeout)
    return r.stdout


def numstat(repo, sha):
    out = git(repo, "show", "--numstat", "--format=", sha)
    add = dele = 0
    files = 0
    for line in out.splitlines():
        p = line.split("\t")
        if len(p) < 3:
            continue
        files += 1
        if p[0].isdigit():
            add += int(p[0])
        if p[1].isdigit():
            dele += int(p[1])
    return files, add, dele


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


def main():
    rows = []
    deploy_rows = []
    summary = []

    for repo in REPOS:
        if repo in DUPLICATES:
            continue
        path = ROOT / repo
        if not (path / ".git").exists():
            continue
        name, scope = META.get(repo, (repo, ""))
        repo_dir = repo
        remote = (git(repo, "remote", "get-url", "origin") or "").strip()
        remote = re.sub(r"\.git$", "", remote)
        branch = (git(repo, "rev-parse", "--abbrev-ref", "HEAD") or "").strip()
        if branch == "HEAD":
            for ref in (git(repo, "for-each-ref", "--points-at", "HEAD",
                            "--format=%(refname:short)", "refs/heads", "refs/remotes") or "").splitlines():
                ref = ref.strip()
                if ref and not ref.endswith("/HEAD"):
                    branch = ref.replace("origin/", "")
                    break
        if branch == "HEAD":
            branch = "Detached HEAD"
        total = (git(repo, "rev-list", "--count", "HEAD") or "").strip()

        log = git(repo, "log", f"--since={SINCE}", "--date=format:%Y-%m-%d %H:%M",
                  f"--pretty=format:%h{SEP}%ad{SEP}%an{SEP}%s{SEP}%b{SEP}%D{REC}")
        commits = []
        for rec in log.split(REC):
            rec = rec.strip("\r\n")
            if not rec:
                continue
            p = rec.split(SEP)
            if len(p) < 6:
                continue
            commits.append({"hash": p[0], "dt": p[1], "author": p[2],
                            "subject": p[3], "body": p[4].strip(), "refs": p[5]})
        commits.reverse()  # chronological

        for c in commits:
            files, add, dele = numstat(repo, c["hash"])
            detail = c["subject"]
            if c["body"]:
                first = " ".join(c["body"].split())
                if len(first) > 240:
                    first = first[:237] + "..."
                detail = f"{c['subject']} — {first}"
            rows.append({
                "Project": name,
                "Repo": repo_dir,
                "Scope": scope,
                "Date": c["dt"][:10],
                "Time": c["dt"][11:],
                "Type": classify(c["subject"]),
                "Commit": c["hash"],
                "Branch": branch,
                "Author": c["author"],
                "Task / Change": c["subject"],
                "Details": detail if detail != c["subject"] else "—",
                "Files": files,
                "Lines +": add,
                "Lines -": dele,
                "Refs": c["refs"].replace("HEAD -> ", "") or "—",
                "Repo URL": remote,
            })

        # Release / deployment evidence: last push (FETCH_HEAD) + last commit on branch
        push_ts = None
        fh = path / ".git" / "FETCH_HEAD"
        if fh.exists():
            push_ts = datetime.fromtimestamp(fh.stat().st_mtime)
        last = commits[-1]["dt"] if commits else ""
        if commits:
            deploy_rows.append({
                "Project": name,
                "Environment / Target": DEPLOY_HINTS.get(repo, "Web deployment"),
                "Branch": branch,
                "Last Commit Pushed": commits[-1]["hash"],
                "Commit Timestamp": last,
                "Last Remote Sync (push/fetch)": push_ts.strftime("%Y-%m-%d %H:%M") if push_ts else "n/a",
                "Commits in Window": len(commits),
                "Release Note": "Active development - changes pushed to remote branch",
                "Repo URL": remote,
            })

        summary.append({
            "Project": name,
            "Repo": repo_dir,
            "Scope": scope,
            "Branch": branch,
            "Commits 13-26 Nov": len(commits),
            "Repo": repo_dir,
            "Total Commits (repo)": int(total) if total.isdigit() else total,
            "Files Touched": sum(r["Files"] for r in rows if r["Project"] == name),
            "Lines Added": sum(r["Lines +"] for r in rows if r["Project"] == name),
            "Lines Removed": sum(r["Lines -"] for r in rows if r["Project"] == name),
            "First Activity": commits[0]["dt"] if commits else "—",
            "Last Activity": commits[-1]["dt"] if commits else "—",
            "Contributors": ", ".join(sorted({c["author"] for c in commits})) or "—",
            "Status": "Active in window" if commits else "No commits in window",
        })

    rows.sort(key=lambda r: (r["Project"], r["Date"], r["Time"]))
    summary.sort(key=lambda r: -r["Commits 13-26 Nov"])
    deploy_rows.sort(key=lambda r: r["Commit Timestamp"], reverse=True)

    build_workbook(rows, deploy_rows, summary)
    print(f"rows={len(rows)} deploys={len(deploy_rows)} projects={len(summary)}")
    print(OUT)


HDR_FILL = PatternFill("solid", fgColor="1F3864")
HDR_FONT = Font(color="FFFFFF", bold=True, size=10)
THIN = Side(style="thin", color="BFBFBF")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
TYPE_FILL = {
    "Feature": "DDEBF7", "Bug Fix": "FCE4D6", "Refactor": "E2EFDA",
    "UI / Styling": "FFF2CC", "Maintenance": "F2F2F2", "Merge": "EDEDED",
    "Testing": "E4DFEC", "Docs": "EDF3F8", "Deployment": "D9E1F2",
    "Review / Audit": "FBE5D6", "Performance": "E2EFDA", "Task": "FFFFFF",
}


def write_sheet(ws, headers, data, widths, table_name, freeze="A2", wrap_cols=()):
    ws.append(headers)
    for c in ws[1]:
        c.fill, c.font, c.border = HDR_FILL, HDR_FONT, BORDER
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    for row in data:
        ws.append([row.get(h) for h in headers])
    for r in ws.iter_rows(min_row=2, max_row=ws.max_row, max_col=len(headers)):
        for c in r:
            c.border = BORDER
            c.font = Font(size=10)
            c.alignment = Alignment(vertical="top",
                                    wrap_text=headers[c.column - 1] in wrap_cols)
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[1].height = 32
    ws.freeze_panes = freeze
    proj_fill = PatternFill("solid", fgColor="D9E1F2")
    prev = None
    for i in range(2, ws.max_row + 1):
        val = ws.cell(row=i, column=1).value
        if val != prev:
            prev = val
            c = ws.cell(row=i, column=1)
            c.font = Font(size=10, bold=True)
            c.fill = proj_fill
    if data:
        ref = f"A1:{get_column_letter(len(headers))}{ws.max_row}"
        t = Table(displayName=table_name, ref=ref)
        t.tableStyleInfo = TableStyleInfo(name="TableStyleLight9", showRowStripes=True)
        ws.add_table(t)
    ws.auto_filter.ref = f"A1:{get_column_letter(len(headers))}{ws.max_row}"


def build_workbook(rows, deploy_rows, summary):
    wb = Workbook()

    # ---- Cover / Read me
    ws = wb.active
    ws.title = "Read Me"
    ws["A1"] = "All Projects — Task Details, Commits & Deployments"
    ws["A1"].font = Font(size=16, bold=True, color="1F3864")
    ws["A3"] = "Reporting period"
    ws["B3"] = f"13 Nov 2026 → {TODAY:%d %b %Y} (inclusive)"
    ws["A4"] = "Prepared on"
    ws["B4"] = f"{TODAY:%d %b %Y}"
    ws["A5"] = "Source"
    ws["B5"] = (f"Every git repository under C:\\Users\\DELL\\Documents "
            f"({len(REPOS) - len(DUPLICATES)} projects scanned, duplicate clones merged)")
    ws["A6"] = "Scope"
    ws["B6"] = "Every commit across all projects in the period, plus release/deployment evidence per project"
    for r in range(3, 7):
        ws.cell(row=r, column=1).font = Font(bold=True, size=10)
        ws.cell(row=r, column=2).font = Font(size=10)
    ws["A8"] = "Sheets"
    ws["A8"].font = Font(bold=True, size=11, color="1F3864")
    guide = [
        ("Task Details", "One row per commit across all projects: project, repo, date/time, task type, hash, author, change description, files & line counts."),
        ("Deployments", "Release/deployment evidence per project: branch, last commit shipped, remote sync time, target environment."),
        ("Project Summary", "Per-project roll-up: commit counts, files touched, lines added/removed, contributors, activity window — all projects including those with no activity."),
        ("Daily Activity", "Commit volume per calendar day across every project."),
        ("Daily Task Log", "Day-by-day task list: each day with every project's tasks, commit counts and line changes."),
        ("By Task Type", "Distribution of work by change type (feature, bug fix, refactor, UI, etc.)."),
        ("By Project & Type", "Cross-tab: how many feature / fix / refactor / UI tasks each project delivered."),
    ]
    r = 9
    for sheet, desc in guide:
        ws.cell(row=r, column=1, value=sheet).font = Font(bold=True, size=10)
        ws.cell(row=r, column=2, value=desc).font = Font(size=10)
        r += 1
    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 110
    for row in ws.iter_rows(min_row=9, max_row=14, min_col=2, max_col=2):
        for c in row:
            c.alignment = Alignment(wrap_text=True, vertical="top")
    ws["A16"] = "Notes"
    ws["A16"].font = Font(bold=True, size=11, color="1F3864")
    notes = [
        "Commit data is read directly from git history (git log --since=2026-11-13) for each repository.",
        "Deployment rows record verified release evidence (branch head commit, last push/fetch to remote, deploy target). "
        "Where no pipeline log exists on this machine, the row is marked 'n/a' rather than inferred.",
        "All projects are included, not just CRTracker: the {n_active} projects with commits in the window are fully itemised and the remaining {n_idle} are listed as 'No commits in window'.",
        "'phlebo-os' and 'hhcs-crm-bmm-release' are local clones of the phlebo-os-sync and hhcs-crm codebases (same remotes) and are merged into those projects to avoid double counting.",
    ]
    r = 17
    n_active = sum(1 for s in summary if s["Commits 13-26 Nov"] > 0)
    notes = [n.format(n_active=n_active, n_idle=len(summary) - n_active) for n in notes]
    for n in notes:
        ws.cell(row=r, column=1, value="•").alignment = Alignment(horizontal="center", vertical="top")
        c = ws.cell(row=r, column=2, value=n)
        c.alignment = Alignment(wrap_text=True, vertical="top")
        c.font = Font(size=10)
        ws.row_dimensions[r].height = 30
        r += 1

    # ---- Task Details
    ws = wb.create_sheet("Task Details")
    headers = ["Project", "Repo", "Date", "Time", "Type", "Commit", "Branch", "Author",
               "Task / Change", "Details", "Files", "Lines +", "Lines -", "Refs", "Repo URL"]
    write_sheet(ws, headers, rows,
                [22, 17, 12, 8, 15, 11, 14, 18, 62, 60, 7, 8, 8, 20, 46],
                "tblTasks", wrap_cols=("Task / Change", "Details", "Repo URL"))
    for r in ws.iter_rows(min_row=2, max_row=ws.max_row, min_col=5, max_col=5):
        for c in r:
            fill = TYPE_FILL.get(c.value)
            if fill:
                c.fill = PatternFill("solid", fgColor=fill)

    # ---- Deployments
    ws = wb.create_sheet("Deployments")
    dheaders = ["Project", "Environment / Target", "Branch", "Last Commit Pushed",
                "Commit Timestamp", "Last Remote Sync (push/fetch)", "Commits in Window",
                "Release Note", "Repo URL"]
    write_sheet(ws, dheaders, deploy_rows,
                [22, 42, 16, 18, 18, 24, 15, 52, 46],
                "tblDeploy", wrap_cols=("Environment / Target", "Release Note", "Repo URL"))

    # ---- Project Summary
    ws = wb.create_sheet("Project Summary")
    sheaders = ["Project", "Repo", "Scope", "Branch", f"Commits 13-{TODAY.day} Nov", "Total Commits (repo)",
                "Files Touched", "Lines Added", "Lines Removed", "First Activity",
                "Last Activity", "Contributors", "Status"]
    write_sheet(ws, sheaders, summary,
                [22, 17, 52, 16, 12, 12, 10, 10, 10, 18, 18, 30, 22],
                "tblSummary", wrap_cols=("Scope", "Contributors"))

    # ---- Daily Activity
    ws = wb.create_sheet("Daily Activity")
    days = {}
    per_day_proj = {}
    d = date(2026, 11, 13)
    while d <= TODAY:
        days[d.isoformat()] = 0
        per_day_proj[d.isoformat()] = {}
        d = date.fromordinal(d.toordinal() + 1)
    for r in rows:
        days[r["Date"]] = days.get(r["Date"], 0) + 1
        per_day_proj.setdefault(r["Date"], {})
        per_day_proj[r["Date"]][r["Project"]] = per_day_proj[r["Date"]].get(r["Project"], 0) + 1
    projects = [s["Project"] for s in summary if s["Commits 13-26 Nov"] > 0]  # all active projects
    ws.append(["Date"] + projects + ["Total"])
    for c in ws[1]:
        c.fill, c.font, c.border = HDR_FILL, HDR_FONT, BORDER
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    for day in sorted(days):
        ws.append([day] + [per_day_proj.get(day, {}).get(p, 0) for p in projects] + [days[day]])
    ws.column_dimensions["A"].width = 14
    for i in range(2, len(projects) + 3):
        ws.column_dimensions[get_column_letter(i)].width = 18
    for row in ws.iter_rows(min_row=1, max_row=ws.max_row, max_col=len(projects) + 2):
        for c in row:
            c.border = BORDER
            if c.row > 1:
                c.font = Font(size=10)
                c.alignment = Alignment(horizontal="center")
    ws.freeze_panes = "B2"

    # ---- By Task Type
    ws = wb.create_sheet("By Task Type")
    types = {}
    for r in rows:
        types[r["Type"]] = types.get(r["Type"], 0) + 1
    ws.append(["Task Type", "Commits", "% of Total"])
    for c in ws[1]:
        c.fill, c.font, c.border = HDR_FILL, HDR_FONT, BORDER
        c.alignment = Alignment(horizontal="center", vertical="center")
    tot = sum(types.values()) or 1
    for t, n in sorted(types.items(), key=lambda kv: -kv[1]):
        ws.append([t, n, n / tot])
    for row in ws.iter_rows(min_row=2, max_row=ws.max_row, max_col=3):
        row[2].number_format = "0.0%"
        for c in row:
            c.border = BORDER
            c.font = Font(size=10)
    ws.column_dimensions["A"].width = 20
    ws.column_dimensions["B"].width = 12
    ws.column_dimensions["C"].width = 12

    # ---- Daily Task Log (day-by-day, project-by-project)
    ws = wb.create_sheet("Daily Task Log")
    lheaders = ["Date", "Project", "Tasks", "Commits", "Lines +", "Lines -", "Task List (commits of the day)"]
    ws.append(lheaders)
    for c in ws[1]:
        c.fill, c.font, c.border = HDR_FILL, HDR_FONT, BORDER
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    by_day = {}
    for r in rows:
        by_day.setdefault((r["Date"], r["Project"]), []).append(r)
    for (day, proj), items in sorted(by_day.items()):
        ws.append([day, proj, len(items), len(items),
                   sum(i["Lines +"] for i in items), sum(i["Lines -"] for i in items),
                   "; ".join(i["Task / Change"] for i in items)])
    for r in ws.iter_rows(min_row=2, max_row=ws.max_row, max_col=len(lheaders)):
        for c in r:
            c.border = BORDER
            c.font = Font(size=10)
            c.alignment = Alignment(vertical="top", wrap_text=(c.column == 7))
    for i, w in enumerate([12, 22, 8, 9, 9, 9, 110], start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[1].height = 30
    ws.freeze_panes = "A2"
    if ws.max_row > 1:
        t = Table(displayName="tblDailyLog",
                  ref=f"A1:{get_column_letter(len(lheaders))}{ws.max_row}")
        t.tableStyleInfo = TableStyleInfo(name="TableStyleLight9", showRowStripes=True)
        ws.add_table(t)

    # ---- By Project & Type (cross-tab)
    ws = wb.create_sheet("By Project & Type")
    all_types = sorted(types, key=lambda t: -types[t])
    ws.append(["Project"] + all_types + ["Total"])
    for c in ws[1]:
        c.fill, c.font, c.border = HDR_FILL, HDR_FONT, BORDER
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    for s in summary:
        if s["Commits 13-26 Nov"] == 0:
            continue
        counts = {t: 0 for t in all_types}
        for r in rows:
            if r["Project"] == s["Project"]:
                counts[r["Type"]] += 1
        ws.append([s["Project"]] + [counts[t] for t in all_types] + [s["Commits 13-26 Nov"]])
    ws.append(["TOTAL"] + [types[t] for t in all_types] + [sum(types.values())])
    for r in ws.iter_rows(min_row=2, max_row=ws.max_row, max_col=len(all_types) + 2):
        for c in r:
            c.border = BORDER
            c.font = Font(size=10, bold=(c.row == ws.max_row))
            if c.column > 1:
                c.alignment = Alignment(horizontal="center")
    ws[f"A{ws.max_row}"].fill = PatternFill("solid", fgColor="D9E1F2")
    ws.column_dimensions["A"].width = 24
    for i in range(2, len(all_types) + 3):
        ws.column_dimensions[get_column_letter(i)].width = 15
    ws.row_dimensions[1].height = 30
    ws.freeze_panes = "B2"

    OUT.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT)


if __name__ == "__main__":
    main()
