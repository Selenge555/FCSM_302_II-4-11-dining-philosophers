/*
 * model.js -- UI-ийн DOM-оос хамааралгүй логик.
 * Хөтөч дээр window.DPModel, Node дээр module.exports болж ажиллана
 * (tests/test_model.js-ээр шалгагдана).
 */
(function (root) {
  'use strict';

  var LIMITS = {
    n: [2, 64], ms: [0, 600000], dur: [100, 600000],
    seed: [0, 2000000000], grab: [0, 10000]
  };
  var ALGOS = ['monitor', 'naive'];
  var COLORS = { thinking: '#4f8cff', hungry: '#ff9f1a', eating: '#2ecc71', free: '#8a949e' };

  function toInt(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? v : NaN;
    if (typeof v !== 'string' || !/^\s*-?\d+\s*$/.test(v)) return NaN;
    return parseInt(v, 10);
  }

  /* Формын утгыг шалгана. Буцаах: {ok, errors[], params{}} */
  function validateParams(p) {
    var errors = [], out = {};
    var fields = [
      ['n', 'Philosopher-ийн тоо', LIMITS.n],
      ['tmin', 'Бодох доод хугацаа (мс)', LIMITS.ms],
      ['tmax', 'Бодох дээд хугацаа (мс)', LIMITS.ms],
      ['emin', 'Идэх доод хугацаа (мс)', LIMITS.ms],
      ['emax', 'Идэх дээд хугацаа (мс)', LIMITS.ms],
      ['dur', 'Ажиллах хугацаа (мс)', LIMITS.dur],
      ['seed', 'Seed', LIMITS.seed],
      ['grab', 'Fork авах завсар (мс)', LIMITS.grab]
    ];
    fields.forEach(function (f) {
      var v = toInt(p[f[0]]);
      if (Number.isNaN(v)) errors.push(f[1] + ': бүхэл тоо оруулна уу');
      else if (v < f[2][0] || v > f[2][1]) errors.push(f[1] + ': ' + f[2][0] + '..' + f[2][1] + ' хооронд байх ёстой');
      else out[f[0]] = v;
    });
    if (ALGOS.indexOf(p.algo) < 0) errors.push('Алгоритм: monitor эсвэл naive байх ёстой');
    else out.algo = p.algo;
    if (out.tmin !== undefined && out.tmax !== undefined && out.tmin > out.tmax)
      errors.push('Бодох доод хугацаа дээд хугацаанаас их байж болохгүй');
    if (out.emin !== undefined && out.emax !== undefined && out.emin > out.emax)
      errors.push('Идэх доод хугацаа дээд хугацаанаас их байж болохгүй');
    return { ok: errors.length === 0, errors: errors, params: out };
  }

  function toQuery(p) {
    return ['n', 'tmin', 'tmax', 'emin', 'emax', 'dur', 'seed', 'algo', 'grab']
      .map(function (k) { return k + '=' + encodeURIComponent(p[k]); }).join('&');
  }

  function emptySnapshot(n) {
    var s = [], f = [];
    for (var i = 0; i < n; i++) { s.push('thinking'); f.push(-1); }
    return { t: 0, states: s, forks: f, deadlock: false, ended: false, reason: null };
  }

  /* Нэг event-ийг хэрэглэж ШИНЭ snapshot буцаана (өмнөхийг өөрчлөхгүй) */
  function applyEvent(snap, ev) {
    var next = {
      t: snap.t, states: snap.states.slice(), forks: snap.forks.slice(),
      deadlock: snap.deadlock, ended: snap.ended, reason: snap.reason
    };
    if (ev.type === 'state') {
      /* dp deadlock илрүүлсний дараа thread-үүдээ зогсоохдоо fork-уудаа
       * суллаж "cleanup" state event гаргадаг (src/dp.c). Эдгээр нь deadlock
       * ҮҮСЭЖ БАЙСАН мөчийн зургийг (бүх fork барьцаалагдсан) эвдэж, эцсийн
       * snapshot дээр "DEADLOCK" баннертай ч fork бүр чөлөөтэй харагддаг
       * байсан. Тиймээс deadlock тэмдэглэгдсэний дараах state event-үүд
       * snapshot-ийг өөрчлөхгүй (event лог болон replay-д харин үлдэнэ). */
      if (snap.deadlock) return next;
      next.t = ev.t;
      next.states[ev.id] = ev.state;
      next.forks = ev.forks.slice();
    } else if (ev.type === 'deadlock') {
      next.t = ev.t; next.deadlock = true;
    } else if (ev.type === 'end') {
      next.t = ev.t; next.ended = true; next.reason = ev.reason;
    }
    return next;
  }

  function buildSnapshots(n, events) {
    var snaps = [emptySnapshot(n)];
    events.forEach(function (ev) { snaps.push(applyEvent(snaps[snaps.length - 1], ev)); });
    return snaps;
  }

  /* Philosopher i-ийн байрлал (өнцөг: дээд талаас цагийн зүүгээр) */
  function philPos(i, n, cx, cy, R) {
    var a = (-90 + i * 360 / n) * Math.PI / 180;
    return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), angle: a };
  }

  /* Philosopher-ийн дүрсийн радиус: цөөн үед том, олон үед жижиг */
  function philRadius(n, R) {
    var chord = 2 * R * Math.sin(Math.PI / n);
    return Math.max(6, Math.min(32, chord * 0.34));
  }

  /*
   * Fork k нь philosopher k-1 ба k-ийн дунд. Чөлөөтэй бол ширээний дундуур
   * (rFree), эзэнтэй бол эзэн рүүгээ шилжсэн (rHeld) байрлалд зурна.
   */
  function forkPos(k, owner, n, cx, cy, rFree, rHeld) {
    var base = (-90 + (k - 0.5) * 360 / n) * Math.PI / 180;
    if (owner < 0) {
      return { x: cx + rFree * Math.cos(base), y: cy + rFree * Math.sin(base), angle: base, held: false };
    }
    var oa = (-90 + owner * 360 / n) * Math.PI / 180;
    var d = Math.atan2(Math.sin(oa - base), Math.cos(oa - base)); /* богино нум */
    var a = base + d * 0.6;
    return { x: cx + rHeld * Math.cos(a), y: cy + rHeld * Math.sin(a), angle: a, held: true };
  }

  /* event.forks[k] бол fork k-г барьж буй philosopher-ийн id (чөлөөтэй бол -1).
   * 'eating' болоход аль ХОЁР fork-ыг авсныг, ямар ч төлөвт аль fork(ууд)-ыг
   * одоо барьж байгааг логоос ялгаж харуулна (жишээ нь naive-д ижил
   * "P1 → hungry" хоёр удаа дараалан гарахад аль fork-ыг хүлээж буйг
   * мэдэхийн тулд). */
  function heldForksOf(ev) {
    var held = [];
    if (!ev.forks) return held;
    for (var k = 0; k < ev.forks.length; k++) if (ev.forks[k] === ev.id) held.push(k);
    return held;
  }
  function describeEvent(ev) {
    if (ev.type === 'state') {
      var base = 't=' + ev.t + ' мс  P' + ev.id + ' → ' + ev.state;
      var held = heldForksOf(ev);
      if (ev.state === 'eating' && held.length) {
        base += ' (fork ' + held.join(',') + ' авсан)'; /* богино хэлбэр: event лог (#log) дэлгэцнээс гарахгүйн тулд */
      } else if (ev.state === 'hungry' && held.length) {
        base += ' (fork ' + held.join(',') + '-г авсан, нөгөөг хүлээж байна)';
      } else if (ev.state === 'thinking') {
        base += ' (fork-уудаа тавьсан)';
      }
      return base;
    }
    if (ev.type === 'deadlock') return 't=' + ev.t + ' мс  DEADLOCK илэрлээ';
    if (ev.type === 'end') return 't=' + ev.t + ' мс  дууссан (' + ev.reason + ')';
    if (ev.type === 'config') return 'тохиргоо: ' + ev.algorithm + ', n=' + ev.n;
    if (ev.type === 'ping') return null; /* сервер-клиент холболт шалгах дохио, лог/snapshot-д оролцдоггүй */
    return JSON.stringify(ev);
  }

  /* Сүүлийн end event-ээс хүснэгтийн мөрүүд.
   * final: ажиллагаа дуусах мөчид тухайн philosopher ХЭВЭЭР HUNGRY байсан бол
   * (жишээ нь нэг ч удаа идэж амжаагүй бол) хэдий хугацаа хүлээснийг харуулна
   * (0 бол тухайн мөчид THINKING/EATING байсан гэсэн үг, заавал "идсэн" гэсэн
   * үг биш — starvation-ыг avg/max_wait далдлахгүй харуулах зорилготой). */
  function statsRows(end) {
    var fw = end.final_hungry_wait_ms || [];
    return end.meals.map(function (m, i) {
      return { id: i, meals: m, avg: end.avg_wait_ms[i], max: end.max_wait_ms[i], final: fw[i] || 0 };
    });
  }

  /* =====================================================================
   * Гадаад шүүмж (IV-2-14), Suggestion 1: шударга байдал ба starvation-ийн ЭРСДЭЛ
   * ===================================================================== */

  /* Jain's Fairness Index: (Σx)² / (n·Σx²) ∈ [1/n, 1]. Бүгд 0 бол null. */
  function jainIndex(xs) {
    if (!xs || !xs.length) return null;
    var s = 0, q = 0;
    for (var i = 0; i < xs.length; i++) { s += xs[i]; q += xs[i] * xs[i]; }
    return q > 0 ? (s * s) / (xs.length * q) : null;
  }
  function minMaxRatio(xs) {
    if (!xs || !xs.length) return null;
    var mx = Math.max.apply(null, xs);
    return mx > 0 ? Math.min.apply(null, xs) / mx : null;
  }

  /* end event -> fairness хураангуй. dp.c (src/fairness.h) тооцсон талбарууд
   * байвал түүнийг, үгүй бол (хуучин лог, tests/examples/*) массиваас тооцно. */
  function fairnessSummary(end) {
    var meals = end.meals || [], avg = end.avg_wait_ms || [], mx = end.max_wait_ms || [];
    var fw = end.final_hungry_wait_ms || [];
    var total = 0, wsum = 0, eaters = [], worst = 0, worstId = -1;
    for (var i = 0; i < meals.length; i++) {
      total += meals[i];
      if (meals[i] > 0) { wsum += (avg[i] || 0) * meals[i]; eaters.push(avg[i] || 0); }
      var w = Math.max(mx[i] || 0, fw[i] || 0);
      if (w > worst) { worst = w; worstId = i; }
    }
    var c = Object.prototype.hasOwnProperty.call(end, 'jain_meals');
    return {
      source: c ? 'dp' : 'ui',
      totalMeals: total,
      jain: c ? end.jain_meals : jainIndex(meals),
      minMax: c ? end.min_max_ratio : minMaxRatio(meals),
      jainAvgWait: c ? end.jain_avg_wait : (eaters.length >= 2 ? jainIndex(eaters) : null),
      avgWait: c ? end.overall_avg_wait_ms : (total ? wsum / total : 0),
      maxWait: c ? end.overall_max_wait_ms : worst,
      worstId: c ? end.worst_wait_id : worstId
    };
  }

  /* Анхааруулах босгын анхдагч утга (мс): monitor-д хүлээлт ихэвчлэн 1–2×emax
   * байдаг тул 4×emax-аас удаан бол "анхаарах", доод хязгаар 500 мс. */
  function defaultWarnThreshold(p) {
    var e = p ? Number(p.emax) : NaN;
    return Math.max(500, 4 * (Number.isFinite(e) ? e : 200));
  }

  /* hungry эхэлсэн мөчийг дагах төлөв. applyEvent-ийн snapshot-оос ТУСДАА
   * (snapshot-ийн бүтэц, түүний тест өөрчлөгдөхгүй). */
  function emptyWaitState(n) {
    var s = [];
    for (var i = 0; i < n; i++) s.push(null);
    return { t: 0, since: s, deadlock: false };
  }

  /* applyEvent-тэй ИЖИЛ зарчмаар deadlock-ийн дараах cleanup state event-үүд
   * hungry эхэлсэн мөчийг өөрчлөхгүй (өөрчилбөл deadlock-д орсон philosopher-ийн
   * анхааруулга cleanup-аар арилж, эрсдэл далдлагдана). t нь харин урагшилна. */
  function applyWaitEvent(ws, ev) {
    var next = { t: ws.t, since: ws.since.slice(), deadlock: ws.deadlock };
    if (typeof ev.t === 'number' && ev.t > next.t) next.t = ev.t;
    if (ev.type === 'state' && !ws.deadlock) {
      if (ev.state === 'hungry') {
        /* naive: hungry -> hungry (fork авсан) үед анхны мөч хэвээр */
        if (next.since[ev.id] === null || next.since[ev.id] === undefined) next.since[ev.id] = ev.t;
      } else {
        next.since[ev.id] = null;
      }
    } else if (ev.type === 'deadlock') {
      next.deadlock = true;
    }
    return next;
  }

  function buildWaitStates(n, events) {
    var out = [emptyWaitState(n)];
    events.forEach(function (ev) { out.push(applyWaitEvent(out[out.length - 1], ev)); });
    return out;
  }

  /* Philosopher бүрийн одоогийн (дуусаагүй) hungry хүлээлт, мс.
   * now: live үед event хүлээлгүй цаг урагшлуулах (заавал биш). */
  function hungryWaits(ws, now) {
    var t = typeof now === 'number' && now > ws.t ? now : ws.t;
    return ws.since.map(function (h) { return h === null || h === undefined ? 0 : Math.max(0, t - h); });
  }

  /* Босгоос удаан hungry байгаа philosopher-ууд: [{id, waitMs}] */
  function waitWarnings(ws, thresholdMs, now) {
    var out = [];
    hungryWaits(ws, now).forEach(function (w, i) { if (w > 0 && w >= thresholdMs) out.push({ id: i, waitMs: w }); });
    return out;
  }

  var WARN_TEXT = 'Энэ анхааруулга нь starvation-ийн ЭРСДЭЛ бөгөөд батлагдсан starvation биш. ' +
    'Philosopher тогтоосон босгоос удаан hungry төлөвт байгааг л илтгэнэ: хөршүүд нь ээлжлэн идэх, ' +
    'идэх хугацаа урт, philosopher-ийн тоо их байх зэргээс удаан хүлээлт түр зуур үүсэх нь хэвийн. ' +
    'Starvation гэдэг нь philosopher хязгааргүй удаан идэж чадахгүй үлдэхийг хэлдэг тул нэг ажиглалтаар ' +
    'батлах боломжгүй — олон, урт туршилтын хамгийн их хүлээлт, Jain индекс, min/max харьцааг хамт харж дүгнэнэ.';

  /* =====================================================================
   * Suggestion 2: туршилтын түүх ба харьцуулалт
   * ===================================================================== */

  /* validateParams().params + end event -> хадгалах нэг бичлэг */
  function runRecord(params, end, warnCount, thresholdMs) {
    var p = params || {}, f = fairnessSummary(end), meals = end.meals || [];
    var n = meals.length || p.n || 0, elapsed = Math.max(1, end.t || p.dur || 1);
    return {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      savedAt: new Date().toISOString(),
      algo: String(p.algo || '?'), n: n,
      tmin: p.tmin, tmax: p.tmax, emin: p.emin, emax: p.emax, dur: p.dur, seed: p.seed, grab: p.grab,
      reason: end.reason || '?', elapsedMs: elapsed,
      totalMeals: f.totalMeals, mealsPerPhil: n ? f.totalMeals / n : 0,
      throughput: f.totalMeals / (elapsed / 1000),
      avgWait: f.avgWait, maxWait: f.maxWait, jain: f.jain, minMax: f.minMax,
      minMeals: meals.length ? Math.min.apply(null, meals) : 0,
      maxMeals: meals.length ? Math.max.apply(null, meals) : 0,
      warnCount: warnCount || 0, warnThresholdMs: thresholdMs || null
    };
  }

  /* Графикийн нэг шугам = ижил алгоритм + бодох/идэх/хугацаа(+grab).
   * Ингэснээр зөвхөн philosopher-ийн тоо (N) өөр туршилтууд л холбогдоно. */
  function seriesKey(r) {
    return r.algo + ' · бодох ' + r.tmin + '–' + r.tmax + ' · идэх ' + r.emin + '–' + r.emax +
      ' · ' + r.dur + ' мс' + (r.algo === 'naive' ? ' · grab ' + r.grab : '');
  }

  /* runs -> {xs: [N...], series: [{key, points: [{n, y, count}]}]};
   * ижил шугам дахь ижил N-ийн давталтыг дундажлана, null утгыг алгасна. */
  function buildSeries(runs, metric) {
    var byKey = {}, order = [], xsSet = {};
    runs.forEach(function (r) {
      var y = r[metric];
      if (y === null || y === undefined || !Number.isFinite(y)) return;
      var k = seriesKey(r);
      if (!byKey[k]) { byKey[k] = {}; order.push(k); }
      var c = byKey[k][r.n] || (byKey[k][r.n] = { sum: 0, count: 0 });
      c.sum += y; c.count++;
      xsSet[r.n] = true;
    });
    var xs = Object.keys(xsSet).map(Number).sort(function (a, b) { return a - b; });
    return {
      xs: xs,
      series: order.map(function (k) {
        return {
          key: k,
          points: Object.keys(byKey[k]).map(Number).sort(function (a, b) { return a - b; })
            .map(function (n) { var c = byKey[k][n]; return { n: n, y: c.sum / c.count, count: c.count }; })
        };
      })
    };
  }

  var RUN_COLS = ['savedAt', 'algo', 'n', 'tmin', 'tmax', 'emin', 'emax', 'dur', 'seed', 'grab', 'reason',
    'elapsedMs', 'totalMeals', 'mealsPerPhil', 'throughput', 'avgWait', 'maxWait', 'jain', 'minMax',
    'minMeals', 'maxMeals', 'warnCount', 'warnThresholdMs'];

  function runsToCSV(runs) {
    function cell(v) {
      if (v === null || v === undefined) return '';
      var s = typeof v === 'number' ? String(Math.round(v * 10000) / 10000) : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    return [RUN_COLS.join(',')].concat(runs.map(function (r) {
      return RUN_COLS.map(function (c) { return cell(r[c]); }).join(',');
    })).join('\n');
  }

  /* Туршилтын түүхийн сан. storage нь localStorage-тэй ижил интерфэйстэй
   * (getItem/setItem) эсвэл null (private mode г.м. — санах ойд л хадгална). */
  function makeRunStore(storage, key, max) {
    key = key || 'dp.runs.v1'; max = max || 200;
    var mem = [];
    function all() {
      if (!storage) return mem.slice();
      try { var v = JSON.parse(storage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; }
      catch (e) { return mem.slice(); }
    }
    function save(list) {
      mem = list.slice(-max);
      if (storage) { try { storage.setItem(key, JSON.stringify(mem)); } catch (e) { /* дүүрсэн */ } }
    }
    return {
      all: all,
      add: function (r) { var l = all(); l.push(r); save(l); return r; },
      remove: function (id) { save(all().filter(function (r) { return r.id !== id; })); },
      clear: function () { save([]); },
      /* JSON-оос импорт: буруу бичлэг, давхардсан id-г алгасна. Нэмсэн тоог буцаана. */
      importMany: function (arr) {
        if (!Array.isArray(arr)) throw new Error('JSON массив биш байна');
        var cur = all(), seen = {};
        cur.forEach(function (r) { seen[r.id] = true; });
        var ok = arr.filter(function (r) {
          return r && typeof r === 'object' && typeof r.id === 'string' && !seen[r.id] &&
            Number.isInteger(r.n) && r.n >= LIMITS.n[0] && r.n <= LIMITS.n[1] && ALGOS.indexOf(r.algo) >= 0;
        });
        save(cur.concat(ok));
        return ok.length;
      }
    };
  }

  var api = {
    LIMITS: LIMITS, ALGOS: ALGOS, COLORS: COLORS,
    validateParams: validateParams, toQuery: toQuery,
    emptySnapshot: emptySnapshot, applyEvent: applyEvent, buildSnapshots: buildSnapshots,
    philPos: philPos, philRadius: philRadius, forkPos: forkPos,
    describeEvent: describeEvent, statsRows: statsRows,
    /* fairness / starvation-ийн эрсдэл (Suggestion 1) */
    jainIndex: jainIndex, minMaxRatio: minMaxRatio, fairnessSummary: fairnessSummary,
    defaultWarnThreshold: defaultWarnThreshold, emptyWaitState: emptyWaitState,
    applyWaitEvent: applyWaitEvent, buildWaitStates: buildWaitStates,
    hungryWaits: hungryWaits, waitWarnings: waitWarnings, WARN_TEXT: WARN_TEXT,
    /* туршилтын түүх ба харьцуулалт (Suggestion 2) */
    runRecord: runRecord, seriesKey: seriesKey, buildSeries: buildSeries,
    RUN_COLS: RUN_COLS, runsToCSV: runsToCSV, makeRunStore: makeRunStore
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DPModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
