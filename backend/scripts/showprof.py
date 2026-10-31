"""python -m scripts.showprof prof.out : the app functions that took longest in a cProfile run."""
import contextlib
import io
import pstats
import sys

p = pstats.Stats(sys.argv[1]).sort_stats("cumulative")
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    p.print_stats(r"app[\\/](identity|followup|assign|pipeline|analysis|extract|callcard|routers)|difflib", 20)
for line in buf.getvalue().splitlines():
    if "ncalls" in line or "app" in line or "difflib" in line:
        print(line[:150].replace("C:\\Users\\DELL\\Documents\\CRTracker\\backend\\", ""))
