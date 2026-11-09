/*
 * fairness.h -- нөөцийн хуваарилалтын шударга байдлын (fairness) үзүүлэлт.
 * Header-only: dp.c-д #include хийхэд хангалттай (Makefile нь dp.c-г ганцаар
 * нь compile хийдэг, tests/run_tests.sh-ийн TSan build ч мөн адил).
 *
 * Гадаад шүүмж (IV-2-14, Suggestion 1): Monitor deadlock-гүй ч philosopher
 * бүр шударгаар идэж байгаа эсэхийг тоон үзүүлэлтээр харуулах.
 *
 * end event-д дараах талбарууд нэмэгдэнэ (одоогийн талбарууд хэвээр):
 *   jain_meals          -- Jain's Fairness Index (Σm)²/(n·Σm²) ∈ [1/n, 1];
 *                          1 бол бүгд тэнцүү идсэн, 1/n бол ганцхан нь идсэн.
 *   min_max_ratio       -- min(meals)/max(meals) ∈ [0, 1]; 0 бол хэн нэг нь огт идээгүй.
 *   jain_avg_wait       -- идсэн philosopher-уудын дундаж хүлээлтийн Jain индекс.
 *   overall_avg_wait_ms -- бүх хооллолтын дундаж хүлээлт = Σwait_total / Σmeals.
 *   overall_max_wait_ms -- бүх philosopher-ийн max_wait_ms-ийн хамгийн их
 *                          (dp.c-д max_wait нь "дуусахад hungry"-г аль хэдийн агуулдаг).
 *   worst_wait_id       -- overall_max_wait_ms-ийг үүсгэсэн philosopher (байхгүй бол -1).
 * Тодорхойгүй (хэн ч идээгүй -> 0/0) утга JSON-д null болно.
 *
 * Яагаад тусдаа event биш вэ: tests/check_log.py нь config/state/deadlock/end-ээс
 * өөр event төрлийг алдаа гэж үздэг. end-ийн нэмэлт талбарыг харин уншдаггүй.
 *
 * Функцууд цэвэр (зөвхөн массив уншина); dp.c тэднийг бүх thread join хийгдсэний
 * дараа дууддаг тул нэмэлт синхрончлол шаардлагагүй.
 */
#ifndef DP_FAIRNESS_H
#define DP_FAIRNESS_H

#include <stdio.h>

#define FAIR_UNDEF (-1.0)

typedef struct {
    long   total_meals;
    double jain_meals, min_max_ratio, jain_avg_wait; /* FAIR_UNDEF боломжтой */
    double overall_avg_wait_ms;
    long   overall_max_wait_ms;
    int    worst_wait_id;
} fairness_t;

/* Jain's Fairness Index. n <= 0 эсвэл бүгд 0 бол FAIR_UNDEF. */
static inline double jain_index(const double *x, int n) {
    double s = 0.0, q = 0.0;
    for (int i = 0; i < n; i++) { s += x[i]; q += x[i] * x[i]; }
    return (n > 0 && q > 0.0) ? (s * s) / ((double)n * q) : FAIR_UNDEF;
}

/* meals, wait_total, wait_max нь dp.c-ийн массивууд (n <= 64). */
static inline fairness_t fairness_compute(int n, const long *meals,
                                          const long *wait_total, const long *wait_max) {
    fairness_t f = {0, FAIR_UNDEF, FAIR_UNDEF, FAIR_UNDEF, 0.0, 0, -1};
    double m[64], aw[64];
    long wsum = 0, mn = -1, mx = 0;
    int eaters = 0;
    if (n <= 0 || n > 64) return f;
    for (int i = 0; i < n; i++) {
        m[i] = (double)meals[i];
        f.total_meals += meals[i];
        wsum += wait_total[i];
        if (mn < 0 || meals[i] < mn) mn = meals[i];
        if (meals[i] > mx) mx = meals[i];
        if (meals[i] > 0) aw[eaters++] = (double)wait_total[i] / (double)meals[i];
        if (wait_max[i] > f.overall_max_wait_ms) {
            f.overall_max_wait_ms = wait_max[i];
            f.worst_wait_id = i;
        }
    }
    f.jain_meals = jain_index(m, n);
    f.min_max_ratio = mx > 0 ? (double)mn / (double)mx : FAIR_UNDEF;
    f.jain_avg_wait = eaters >= 2 ? jain_index(aw, eaters) : FAIR_UNDEF;
    f.overall_avg_wait_ms = f.total_meals > 0 ? (double)wsum / (double)f.total_meals : 0.0;
    return f;
}

static inline void fairness_print_num(FILE *out, const char *key, double v) {
    if (v < 0.0) fprintf(out, ",\"%s\":null", key);
    else fprintf(out, ",\"%s\":%.4f", key, v);
}

/* end event-ийн хаалтын '}'-ийн ӨМНӨ ",\"jain_meals\":...,..." хэсгийг бичнэ. */
static inline void fairness_print_json(FILE *out, const fairness_t *f) {
    fairness_print_num(out, "jain_meals", f->jain_meals);
    fairness_print_num(out, "min_max_ratio", f->min_max_ratio);
    fairness_print_num(out, "jain_avg_wait", f->jain_avg_wait);
    fprintf(out, ",\"overall_avg_wait_ms\":%.1f,\"overall_max_wait_ms\":%ld,\"worst_wait_id\":%d",
            f->overall_avg_wait_ms, f->overall_max_wait_ms, f->worst_wait_id);
}

#endif /* DP_FAIRNESS_H */
