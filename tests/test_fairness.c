/*
 * test_fairness.c -- src/fairness.h-ийн unit тест.
 * Ашиглалт: cc -std=gnu11 -Wall -Wextra -Werror -Isrc tests/test_fairness.c -o build/test_fairness && build/test_fairness
 */
#define _GNU_SOURCE
#include "fairness.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int passed, failed;
#define CHECK(cond, msg) do { if (cond) passed++; else { failed++; fprintf(stderr, "FAIL: %s (%s:%d)\n", msg, __FILE__, __LINE__); } } while (0)
static int near(double a, double b) { return fabs(a - b) < 1e-4; }

/* fairness_print_json-ийн гаралтыг string болгоно */
static char *json_of(const fairness_t *f) {
    char *buf = NULL; size_t len = 0;
    FILE *ms = open_memstream(&buf, &len);
    fairness_print_json(ms, f);
    fclose(ms);
    return buf;
}

int main(void) {
    /* Гадаад шүүмжийн 4.1 туршилт: meals [8,8,6,7,7] */
    {
        long m[5] = {8, 8, 6, 7, 7}, wt[5] = {800, 960, 900, 770, 630}, wm[5] = {200, 260, 300, 210, 180};
        fairness_t f = fairness_compute(5, m, wt, wm);
        CHECK(near(f.jain_meals, 0.98931), "Jain [8,8,6,7,7] = 0.98931");
        CHECK(near(f.min_max_ratio, 0.75), "min/max = 6/8");
        CHECK(f.total_meals == 36, "нийт хооллолт 36");
        CHECK(near(f.overall_avg_wait_ms, 4060.0 / 36.0), "overall avg = Σwait/Σmeals");
        CHECK(f.overall_max_wait_ms == 300 && f.worst_wait_id == 2, "overall max = 300 (P2)");
        CHECK(f.jain_avg_wait > 0.95 && f.jain_avg_wait <= 1.0, "jain_avg_wait (0, 1] муж");
    }
    /* Тэнцүү хуваарилалт -> 1.0 */
    {
        long m[4] = {10, 10, 10, 10}, wt[4] = {50, 50, 50, 50}, wm[4] = {9, 9, 9, 9};
        fairness_t f = fairness_compute(4, m, wt, wm);
        CHECK(near(f.jain_meals, 1.0) && near(f.min_max_ratio, 1.0) && near(f.jain_avg_wait, 1.0), "тэнцүү -> 1.0");
    }
    /* Starvation-тай төстэй: P1 огт идээгүй, 900 мс hungry хэвээр (wait_max-д шингэсэн) */
    {
        long m[3] = {10, 0, 9}, wt[3] = {500, 0, 540}, wm[3] = {120, 900, 140};
        fairness_t f = fairness_compute(3, m, wt, wm);
        CHECK(near(f.min_max_ratio, 0.0), "нэг нь идээгүй -> min/max = 0");
        CHECK(f.jain_meals < 0.7, "шударга бус -> Jain бага");
        CHECK(f.overall_max_wait_ms == 900 && f.worst_wait_id == 1, "дуусаагүй хүлээлт max-д орно (P1)");
        CHECK(near(f.jain_avg_wait, 12100.0 / 12200.0), "jain_avg_wait зөвхөн идсэн 2 philosopher-оор: (50, 60) -> 0.9918");
    }
    /* Naive deadlock: хэн ч идээгүй -> null */
    {
        long m[5] = {0}, wt[5] = {0}, wm[5] = {15, 15, 15, 15, 15};
        fairness_t f = fairness_compute(5, m, wt, wm);
        char *s = json_of(&f);
        CHECK(f.jain_meals == FAIR_UNDEF && f.min_max_ratio == FAIR_UNDEF && f.jain_avg_wait == FAIR_UNDEF,
              "deadlock -> тодорхойгүй");
        CHECK(strstr(s, "\"jain_meals\":null") && strstr(s, "\"min_max_ratio\":null")
              && strstr(s, "\"jain_avg_wait\":null"), "deadlock -> JSON null");
        CHECK(strstr(s, "\"overall_max_wait_ms\":15") != NULL, "deadlock -> overall max = 15");
        CHECK(s[0] == ',', "JSON хэсэг таслалаар эхэлнэ (end-ийн '}'-ийн өмнө)");
        free(s);
    }
    /* JSON хэлбэр: тоонууд, ганц л удаа гарах түлхүүрүүд */
    {
        long m[2] = {3, 1}, wt[2] = {30, 20}, wm[2] = {12, 20};
        fairness_t f = fairness_compute(2, m, wt, wm);
        char *s = json_of(&f);
        CHECK(strstr(s, "\"jain_meals\":0.8000") != NULL, "JSON: jain (3,1) = 0.8");
        CHECK(strstr(s, "\"min_max_ratio\":0.3333") != NULL, "JSON: min/max = 1/3");
        CHECK(strstr(s, "\"overall_avg_wait_ms\":12.5") != NULL, "JSON: avg = 50/4");
        CHECK(strstr(s, "\"worst_wait_id\":1") != NULL, "JSON: worst_wait_id = 1");
        free(s);
    }
    /* Хил: n = 0, n > 64, 64 тэнцүү */
    {
        long m[64], wt[64], wm[64];
        for (int i = 0; i < 64; i++) { m[i] = 5; wt[i] = 50; wm[i] = 20; }
        CHECK(near(fairness_compute(64, m, wt, wm).jain_meals, 1.0), "n = 64 тэнцүү -> 1.0");
        CHECK(fairness_compute(0, m, wt, wm).worst_wait_id == -1, "n = 0 -> хоосон");
        CHECK(fairness_compute(65, m, wt, wm).jain_meals == FAIR_UNDEF, "n = 65 -> хоосон");
    }
    printf("%d passed, %d failed\n", passed, failed);
    return failed ? 1 : 0;
}
