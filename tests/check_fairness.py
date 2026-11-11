#!/usr/bin/env python3
"""
check_fairness.py -- dp-ийн end event-ийн fairness талбаруудыг бие даан шалгагч.

end.meals / avg_wait_ms / max_wait_ms массиваас Python-оор ДАХИН тооцож,
dp.c-ийн (src/fairness.h) гаргасан утгатай тулгана:
  1. jain_meals, min_max_ratio, jain_avg_wait, overall_avg_wait_ms,
     overall_max_wait_ms, worst_wait_id талбарууд байгаа.
  2. jain_meals = (Σm)² / (n·Σm²);  хэн ч идээгүй бол null.
  3. min_max_ratio = min/max;  хэн ч идээгүй бол null.
  4. jain_meals ∈ [1/n, 1],  min_max_ratio ∈ [0, 1].
  5. overall_max_wait_ms = max(max_wait_ms), worst_wait_id нь түүний индекс.
  6. overall_avg_wait_ms ≈ Σ(avgᵢ·mᵢ) / Σm  (avg нь 0.1 мс-ээр тоймлогдсон тул зөрүү зөвшөөрнө).

Ашиглалт:  check_fairness.py [--expect-null] [файл]   (файлгүй бол stdin)
"""
import argparse
import json
import sys

FIELDS = ("jain_meals", "min_max_ratio", "jain_avg_wait",
          "overall_avg_wait_ms", "overall_max_wait_ms", "worst_wait_id")


def jain(xs):
    q = sum(x * x for x in xs)
    return (sum(xs) ** 2) / (len(xs) * q) if xs and q > 0 else None


def check(lines, expect_null=False):
    errors = []
    end = None
    for raw in lines:
        raw = raw.strip()
        if raw:
            try:
                ev = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if ev.get("type") == "end":
                end = ev
    if end is None:
        return ["end event олдсонгүй"], None
    missing = [f for f in FIELDS if f not in end]
    if missing:
        return [f"end-д талбар алга: {', '.join(missing)}"], None

    meals, avg, mx = end["meals"], end["avg_wait_ms"], end["max_wait_ms"]
    n = len(meals)

    def close(a, b, tol, name):
        if a is None or b is None:
            if a is not b:
                errors.append(f"{name}: dp={a} != тооцоолсон {b}")
        elif abs(a - b) > tol:
            errors.append(f"{name}: dp={a} != тооцоолсон {b:.4f}")

    j = jain(meals)
    close(end["jain_meals"], j, 1e-3, "jain_meals")
    mm = (min(meals) / max(meals)) if max(meals) > 0 else None
    close(end["min_max_ratio"], mm, 1e-3, "min_max_ratio")
    eaters = [a for a, m in zip(avg, meals) if m > 0]
    close(end["jain_avg_wait"], jain(eaters) if len(eaters) >= 2 else None, 2e-3, "jain_avg_wait")

    if end["jain_meals"] is not None and not (1 / n - 1e-3 <= end["jain_meals"] <= 1 + 1e-9):
        errors.append(f"jain_meals {end['jain_meals']} муж [1/n, 1]-ээс гарсан")
    if end["min_max_ratio"] is not None and not (0 <= end["min_max_ratio"] <= 1):
        errors.append(f"min_max_ratio {end['min_max_ratio']} муж [0, 1]-ээс гарсан")

    worst = max(mx) if mx else 0
    if end["overall_max_wait_ms"] != worst:
        errors.append(f"overall_max_wait_ms {end['overall_max_wait_ms']} != max(max_wait_ms) {worst}")
    if worst > 0 and mx[end["worst_wait_id"]] != worst:
        errors.append(f"worst_wait_id {end['worst_wait_id']} нь хамгийн их хүлээлттэй philosopher биш")

    total = sum(meals)
    exp_avg = sum(a * m for a, m in zip(avg, meals)) / total if total else 0.0
    close(end["overall_avg_wait_ms"], exp_avg, 0.2, "overall_avg_wait_ms")

    if expect_null and end["jain_meals"] is not None:
        errors.append("хэн ч идээгүй (deadlock) үед jain_meals null байх ёстой")
    return errors, {"n": n, "jain": end["jain_meals"], "min_max": end["min_max_ratio"],
                    "avg": end["overall_avg_wait_ms"], "max": end["overall_max_wait_ms"]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file", nargs="?")
    ap.add_argument("--expect-null", action="store_true",
                    help="хэн ч идээгүй (naive deadlock) тул Jain/min-max null байх ёстой")
    a = ap.parse_args()
    lines = open(a.file, encoding="utf-8").read().splitlines() if a.file else sys.stdin.read().splitlines()
    errors, info = check(lines, a.expect_null)
    if errors:
        for e in errors:
            print("FAIL:", e)
        sys.exit(1)
    print(f"OK: n={info['n']} jain={info['jain']} min/max={info['min_max']} "
          f"avg={info['avg']} мс max={info['max']} мс")


if __name__ == "__main__":
    main()
