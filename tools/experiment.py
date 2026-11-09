#!/usr/bin/env python3
"""
experiment.py -- урт хугацааны fairness / starvation туршилт (UI-гүй).

Гадаад шүүмж (IV-2-14), 8.1: "симуляцын хугацааг уртасгаж, philosopher бүрийн
хооллолтын тоо, дундаж болон хамгийн их хүлээлтийн хугацааг харьцуулан шинжлэх".
8.2: "5, 12, 32 болон 64 philosopher-той ... харьцуулах".

build/dp-г N (philosopher-ийн тоо) x seed x тохиргоо бүрээр ажиллуулж, бүрэн
event логийг мөр мөрөөр нь задлан end event-д БАЙХГҮЙ нарийвчилсан
үзүүлэлтүүдийг тооцно:
  * хүлээлтийн тархалт (hungry -> eating): дундаж, медиан, p95, p99, max
  * philosopher бүрийн "хоолгүй үргэлжилсэн хамгийн урт хугацаа" (meal gap):
    эхлэлээс эхний хоол, хоол хоорондын, сүүлийн хоолноос төгсгөл хүртэл
  * Jain индекс, min/max, хооллолтын вариацын коэффициент (CV)
  * dp.c-ийн end-ийн fairness талбартай тулгалт (jain_meals)

Гаралт:
  --csv  : нэг мөр = нэг ажиллагаа (тайлан, Excel)
  --json : ui/model.js runRecord()-той ижил талбартай -> UI-ийн
           "Туршилтын түүх -> JSON оруулах"-аар шууд импортлогдоно

Жишээ:
  python3 tools/experiment.py --dur 60000 --seeds 1 2 3 --jobs 2 \
      --csv docs/experiments/long_runs.csv --json docs/experiments/long_runs.json
"""
import argparse
import csv
import json
import math
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = os.path.join(ROOT, "build", "dp")

# Тохиргоонууд: (нэр, tmin, tmax, emin, emax)
CONFIGS = {
    "normal": ("Хэвийн ачаалал", 10, 100, 10, 50),
    "contention": ("Өндөр өрсөлдөөн (think = 0)", 0, 0, 10, 50),
    # think хугацаа starvation-д хэрхэн нөлөөлөхийг харах (contention-тэй ижил идэх хугацаа)
    "think1": ("think 0–1 мс", 0, 1, 10, 50),
    "think5": ("think 0–5 мс", 0, 5, 10, 50),
    "think20": ("think 0–20 мс", 0, 20, 10, 50),
}


def pct(sorted_xs, p):
    if not sorted_xs:
        return 0.0
    k = (len(sorted_xs) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    return sorted_xs[lo] + (sorted_xs[hi] - sorted_xs[lo]) * (k - lo)


def jain(xs):
    q = sum(x * x for x in xs)
    return (sum(xs) ** 2) / (len(xs) * q) if xs and q else None


def analyse(lines, n):
    """JSONL мөрүүд -> нарийвчилсан үзүүлэлт"""
    hungry_since = [None] * n
    prev_state = ["thinking"] * n
    waits = []
    last_meal = [0] * n          # эхлэл (t=0)-өөс
    max_gap = [0] * n
    meals = [0] * n
    end = None
    deadlock = False
    for raw in lines:
        try:
            ev = json.loads(raw)
        except ValueError:
            continue
        typ = ev.get("type")
        if typ == "deadlock":
            deadlock = True
        elif typ == "end":
            end = ev
        elif typ == "state" and not deadlock:
            i, st, t = ev["id"], ev["state"], ev["t"]
            if st == "hungry" and prev_state[i] != "hungry":
                hungry_since[i] = t
            elif st == "eating":
                if hungry_since[i] is not None:
                    waits.append(t - hungry_since[i])
                hungry_since[i] = None
                max_gap[i] = max(max_gap[i], t - last_meal[i])
                last_meal[i] = t
                meals[i] += 1
            prev_state[i] = st
    if end is None:
        raise RuntimeError("end event олдсонгүй")
    t_end = end["t"]
    for i in range(n):
        max_gap[i] = max(max_gap[i], t_end - last_meal[i])
    ws = sorted(waits)
    mean_m = sum(meals) / n
    sd_m = math.sqrt(sum((m - mean_m) ** 2 for m in meals) / n)
    worst_gap = max(range(n), key=lambda i: max_gap[i])
    return {
        "end": end, "meals": meals,
        "waitMean": sum(ws) / len(ws) if ws else 0.0,
        "waitP50": pct(ws, 0.50), "waitP95": pct(ws, 0.95), "waitP99": pct(ws, 0.99),
        "waitMaxObserved": ws[-1] if ws else 0, "waitSamples": len(ws),
        "mealGapMax": max_gap[worst_gap], "mealGapWorstId": worst_gap,
        "mealGapMean": sum(max_gap) / n,
        "mealsCV": sd_m / mean_m if mean_m else None,
        "jainLog": jain(meals),
    }


def run_one(cfg_key, n, seed, dur):
    label, tmin, tmax, emin, emax = CONFIGS[cfg_key]
    argv = [BIN, "-a", "monitor", "-n", str(n), "--think-min", str(tmin), "--think-max", str(tmax),
            "--eat-min", str(emin), "--eat-max", str(emax), "-d", str(dur), "-s", str(seed)]
    p = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1 << 16)
    a = analyse(p.stdout, n)
    p.wait()
    end = a["end"]
    total = sum(end["meals"])
    elapsed = max(1, end["t"])
    thr = max(500, 4 * emax)                               # UI-ийн defaultWarnThreshold
    warned = sum(1 for w in end["max_wait_ms"] if w >= thr)
    rec = {
        # ui/model.js runRecord()-той ижил талбарууд (UI-д импортлогдоно)
        "id": f"exp-{cfg_key}-{n}-{seed}-{dur}",
        "savedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "algo": "monitor", "n": n, "tmin": tmin, "tmax": tmax, "emin": emin, "emax": emax,
        "dur": dur, "seed": seed, "grab": 100, "reason": end["reason"], "elapsedMs": elapsed,
        "totalMeals": total, "mealsPerPhil": total / n, "throughput": total / (elapsed / 1000),
        "avgWait": end["overall_avg_wait_ms"], "maxWait": end["overall_max_wait_ms"],
        "jain": end["jain_meals"], "minMax": end["min_max_ratio"],
        "minMeals": min(end["meals"]), "maxMeals": max(end["meals"]),
        "warnCount": warned, "warnThresholdMs": thr,
        # нэмэлт (зөвхөн CSV/тайланд)
        "config": cfg_key, "configLabel": label, "exitCode": p.returncode,
        "waitP50": round(a["waitP50"], 1), "waitP95": round(a["waitP95"], 1), "waitP99": round(a["waitP99"], 1),
        "waitSamples": a["waitSamples"], "mealGapMax": a["mealGapMax"], "mealGapWorstId": a["mealGapWorstId"],
        "mealGapMean": round(a["mealGapMean"], 1),
        "mealsCV": round(a["mealsCV"], 4) if a["mealsCV"] is not None else None,
    }
    # dp.c-ийн тооцоо ба логоос дахин тооцсон утга таарах ёстой
    if a["meals"] != end["meals"] or (rec["jain"] is not None and abs(rec["jain"] - a["jainLog"]) > 1e-3):
        raise RuntimeError(f"тулгалт таарсангүй: {rec['id']}")
    return rec


COLS = ["config", "n", "seed", "dur", "reason", "totalMeals", "mealsPerPhil", "throughput", "minMeals",
        "maxMeals", "jain", "minMax", "mealsCV", "avgWait", "waitP50", "waitP95", "waitP99", "maxWait",
        "mealGapMean", "mealGapMax", "mealGapWorstId", "warnCount", "warnThresholdMs", "waitSamples"]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--configs", nargs="+", default=list(CONFIGS), choices=list(CONFIGS))
    ap.add_argument("--ns", type=int, nargs="+", default=[5, 12, 32, 64])
    ap.add_argument("--seeds", type=int, nargs="+", default=[1, 2, 3])
    ap.add_argument("--dur", type=int, default=60000, help="нэг ажиллагааны хугацаа, мс")
    ap.add_argument("--jobs", type=int, default=1, help="зэрэг ажиллах dp-ийн тоо")
    ap.add_argument("--csv")
    ap.add_argument("--json")
    a = ap.parse_args()
    if not os.access(BIN, os.X_OK):
        ap.error("build/dp олдсонгүй — эхлээд `make all`")
    jobs = [(c, n, s) for c in a.configs for n in a.ns for s in a.seeds]
    print(f"{len(jobs)} ажиллагаа x {a.dur / 1000:.0f} с, зэрэг {a.jobs}", flush=True)

    def task(j):
        r = run_one(j[0], j[1], j[2], a.dur)
        print(f"  {r['config']:10} N={r['n']:<3} seed={r['seed']}  meals/phil={r['mealsPerPhil']:7.1f}  "
              f"Jain={r['jain']:.4f}  min/max={r['minMax']:.3f}  wait p99={r['waitP99']:6.1f} max={r['maxWait']:5} мс  "
              f"meal gap max={r['mealGapMax']} мс", flush=True)
        return r

    with ThreadPoolExecutor(max_workers=a.jobs) as ex:
        rows = list(ex.map(task, jobs))
    for path, write in ((a.csv, "csv"), (a.json, "json")):
        if not path:
            continue
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="") as f:
            if write == "csv":
                w = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore")
                w.writeheader()
                w.writerows(rows)
            else:
                json.dump(rows, f, ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
