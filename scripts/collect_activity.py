"""Collect git commits from every local repo since a given date (JSON output)."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(r"C:\Users\DELL\Documents")
SINCE = sys.argv[1] if len(sys.argv) > 1 else "2026-11-13"
SEP = "\x1f"
REC = "\x1e"

out = []
for d in sorted(ROOT.iterdir()):
    if not d.is_dir() or not (d / ".git").exists():
        continue
    try:
        branch = subprocess.run(
            ["git", "-C", str(d), "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, timeout=20).stdout.strip()
        total = subprocess.run(
            ["git", "-C", str(d), "rev-list", "--count", "HEAD"],
            capture_output=True, text=True, timeout=20).stdout.strip()
        log = subprocess.run(
            ["git", "-C", str(d), "log", f"--since={SINCE}",
             f"--pretty=format:%h{SEP}%ad{SEP}%an{SEP}%s{SEP}%D", "--date=iso-strict"],
            capture_output=True, text=True, timeout=120).stdout
        files = subprocess.run(
            ["git", "-C", str(d), "log", f"--since={SINCE}", "--pretty=format:", "--name-only"],
            capture_output=True, text=True, timeout=120).stdout
    except Exception as e:  # noqa: BLE001
        print(f"ERR {d.name}: {e}", file=sys.stderr)
        continue
    commits = []
    for line in log.split(REC):
        line = line.strip("\r\n")
        if not line:
            continue
        parts = line.split(SEP)
        if len(parts) < 5:
            continue
        commits.append({"hash": parts[0], "date": parts[1], "author": parts[2],
                        "subject": parts[3], "refs": parts[4]})
    names = [f.strip() for f in files.splitlines() if f.strip()]
    out.append({"repo": d.name, "branch": branch, "total_commits": total,
                "commits": commits, "changed_files": names})

json.dump(out, open(Path(__file__).with_name("activity.json"), "w", encoding="utf-8"),
          indent=1, ensure_ascii=False)
for r in out:
    print(f"{r['repo']:<28} {len(r['commits']):>4} commits  files={len(set(r['changed_files']))}")
