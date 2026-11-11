/*
 * test_model.js -- ui/model.js-ийн DOM-гүй логикийг шалгах unit тест.
 * Ашиглалт: node tests/test_model.js
 */
'use strict';
const path = require('path');
const M = require(path.join(__dirname, '..', 'ui', 'model.js'));

let failed = 0, passed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL:', msg); }
}
function eq(a, b, msg) {
  assert(JSON.stringify(a) === JSON.stringify(b), msg + ' (got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b) + ')');
}

// --- validateParams ---
{
  const ok = M.validateParams({ algo: 'monitor', n: '5', tmin: '100', tmax: '200', emin: '100', emax: '200', dur: '1000', seed: '1', grab: '50' });
  assert(ok.ok === true, 'validateParams: зөв оролт ok байх ёстой');
  eq(ok.params.n, 5, 'validateParams: n тоо болж хувирсан');
}
{
  const bad = M.validateParams({ algo: 'bogus', n: '1', tmin: '500', tmax: '100', emin: '1', emax: '1', dur: '1000', seed: '1', grab: '0' });
  assert(bad.ok === false, 'validateParams: буруу оролт алдаатай гэж үзэх ёстой');
  assert(bad.errors.some(e => /Алгоритм/.test(e)), 'validateParams: алгоритмын алдаа мессеж агуулах ёстой');
  assert(bad.errors.some(e => /Philosopher/.test(e)), 'validateParams: n хязгаараас гарсан алдаа агуулах ёстой');
  assert(bad.errors.some(e => /Бодох доод/.test(e)), 'validateParams: tmin>tmax алдаа агуулах ёстой');
}
{
  const nonint = M.validateParams({ algo: 'monitor', n: '5.5', tmin: 'abc', tmax: '200', emin: '100', emax: '200', dur: '1000', seed: '1', grab: '50' });
  assert(nonint.ok === false, 'validateParams: бус бүхэл тоо татгалзах ёстой');
}

// --- emptySnapshot / applyEvent ---
{
  const s0 = M.emptySnapshot(3);
  eq(s0.states, ['thinking', 'thinking', 'thinking'], 'emptySnapshot: эхний төлөв бүгд thinking');
  eq(s0.forks, [-1, -1, -1], 'emptySnapshot: эхэндээ fork бүгд чөлөөтэй');

  const s1 = M.applyEvent(s0, { type: 'state', t: 10, id: 1, state: 'hungry', forks: [-1, -1, -1] });
  eq(s1.states, ['thinking', 'hungry', 'thinking'], 'applyEvent(state): зөв philosopher-ийн төлөв өөрчлөгдсөн');
  eq(s0.states, ['thinking', 'thinking', 'thinking'], 'applyEvent: өмнөх snapshot immutable хэвээр');

  const s2 = M.applyEvent(s1, { type: 'deadlock', t: 20 });
  assert(s2.deadlock === true, 'applyEvent(deadlock): deadlock flag тавигдсан');

  const s3 = M.applyEvent(s2, { type: 'end', t: 30, reason: 'timeout' });
  assert(s3.ended === true && s3.reason === 'timeout', 'applyEvent(end): ended/reason зөв тавигдсан');
}

// --- buildSnapshots ---
{
  const events = [
    { type: 'state', t: 5, id: 0, state: 'hungry', forks: [-1, -1] },
    { type: 'state', t: 8, id: 0, state: 'eating', forks: [0, 0] },
    { type: 'end', t: 20, reason: 'timeout' },
  ];
  const snaps = M.buildSnapshots(2, events);
  eq(snaps.length, 4, 'buildSnapshots: эхний хоосон + 3 event = 4 snapshot');
  assert(snaps[3].ended === true, 'buildSnapshots: сүүлийн snapshot ended');
}

// --- philPos / forkPos геометр ---
{
  const p0 = M.philPos(0, 4, 0, 0, 100);
  assert(Math.abs(p0.x - 0) < 1e-9 && Math.abs(p0.y - (-100)) < 1e-9,
    'philPos: P0 дээш (12 цагийн зүг) байрлах ёстой');
}
{
  const free = M.forkPos(1, -1, 4, 0, 0, 50, 90);
  const held = M.forkPos(1, 0, 4, 0, 0, 50, 90);
  const dFree = Math.hypot(free.x, free.y), dHeld = Math.hypot(held.x, held.y);
  assert(Math.abs(dFree - 50) < 1e-6, 'forkPos: чөлөөтэй fork rFree радиуст байх ёстой');
  assert(Math.abs(dHeld - 90) < 1e-6, 'forkPos: эзэнтэй fork rHeld радиуст байх ёстой');
  assert(free.held === false && held.held === true, 'forkPos: held flag зөв');
}

// --- describeEvent / statsRows ---
{
  eq(M.describeEvent({ type: 'deadlock', t: 7 }), 't=7 мс  DEADLOCK илэрлээ', 'describeEvent: deadlock мессеж');
  // Гадаад шүүмж: naive-д "P1 → hungry" хоёр удаа дараалж харагдвал аль
  // fork-ыг аль хэдийн авсныг ялгах боломжгүй байсан тул describeEvent-д
  // fork-ийн мэдээлэл нэмсэн (Report.docx, Хавсралт Г, #4). Гурван
  // шилжилтийг (eating/hungry/thinking) тус тусад нь шалгана.
  eq(M.describeEvent({ type: 'state', t: 5, id: 2, state: 'eating', forks: [-1, -1, 2, 2, -1] }),
    't=5 мс  P2 → eating (fork 2,3 авсан)', 'describeEvent: eating үед ХОЁР fork-ыг нэрээр нь харуулна (богино хэлбэр)');
  eq(M.describeEvent({ type: 'state', t: 0, id: 1, state: 'hungry', forks: [-1, 1, -1, -1, -1] }),
    't=0 мс  P1 → hungry (fork 1-г авсан, нөгөөг хүлээж байна)',
    'describeEvent: hungry үед аль хэдийн барьсан fork-оо ялгаж харуулна (богино хэлбэр)');
  eq(M.describeEvent({ type: 'state', t: 12, id: 0, state: 'thinking', forks: [-1, -1, -1, -1, -1] }),
    't=12 мс  P0 → thinking (fork-уудаа тавьсан)', 'describeEvent: thinking үед fork суллагдсаныг тэмдэглэнэ');
  eq(M.describeEvent({ type: 'ping' }), null,
    'describeEvent: ping (сервер-клиент холболт шалгах дохио) лог/snapshot-д оролцохгүй, null буцаана');
  const end = { meals: [3, 5], avg_wait_ms: [10.5, 20.2], max_wait_ms: [15, 30], final_hungry_wait_ms: [0, 42] };
  eq(M.statsRows(end), [
    { id: 0, meals: 3, avg: 10.5, max: 15, final: 0 },
    { id: 1, meals: 5, avg: 20.2, max: 30, final: 42 },
  ], 'statsRows: хүснэгтийн мөрүүд зөв бүрдсэн (starvation-ийн final талбартай)');
  const endNoFinal = { meals: [1], avg_wait_ms: [5], max_wait_ms: [5] };
  eq(M.statsRows(endNoFinal), [
    { id: 0, meals: 1, avg: 5, max: 5, final: 0 },
  ], 'statsRows: final_hungry_wait_ms талбаргүй үед ч эвдрэхгүй (0 анхдагч)');
}

// --- deadlock-ийн дараах cleanup event snapshot-ийг өөрчлөхгүй ---
{
  // dp.c deadlock илрүүлсний дараа fork-уудаа суллаж state event гаргадаг.
  const ev = [
    { type: 'state', t: 1, id: 0, state: 'hungry', forks: [0, -1] },
    { type: 'state', t: 2, id: 1, state: 'hungry', forks: [0, 1] },
    { type: 'deadlock', t: 3 },
    { type: 'state', t: 4, id: 0, state: 'hungry', forks: [-1, 1] },   // cleanup
    { type: 'state', t: 5, id: 1, state: 'hungry', forks: [-1, -1] },  // cleanup
    { type: 'end', t: 6, reason: 'deadlock' },
  ];
  const sn = M.buildSnapshots(2, ev);
  const last = sn[sn.length - 1];
  eq(last.forks, [0, 1], 'applyEvent: deadlock-ийн дараах cleanup нь fork-ийн эзэмшлийг өөрчлөхгүй');
  assert(last.deadlock === true && last.ended === true && last.reason === 'deadlock',
    'applyEvent: deadlock болон end тэмдэглэгээ cleanup-ийн дараа ч хадгалагдана');
  eq(sn[3].forks, sn[4].forks, 'applyEvent: deadlock snapshot ба дараагийн snapshot ижил');
  // Бодит жишээ лог дээр: эцсийн snapshot-д бүх fork барьцаалагдсан хэвээр.
  const fs = require('fs');
  const lines = fs.readFileSync(path.join(__dirname, 'examples', 'naive_deadlock_n5_sample.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(e => e.type !== 'exit');
  const n = lines.find(e => e.type === 'config').n;
  const fin = M.buildSnapshots(n, lines).pop();
  assert(fin.deadlock && fin.forks.every(f => f >= 0), 'naive жишээ лог: эцсийн snapshot-д бүх fork эзэнтэй (deadlock-ийн зураг)');
}

// =====================================================================
// Гадаад шүүмж (IV-2-14), Suggestion 1: fairness ба starvation-ийн эрсдэл
// =====================================================================
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-6);

// --- jainIndex / minMaxRatio (src/fairness.h-тэй ижил утга) ---
{
  assert(near(M.jainIndex([8, 8, 6, 7, 7]), 0.98931, 1e-5), 'jainIndex: шүүмжийн [8,8,6,7,7] = 0.9893');
  assert(near(M.jainIndex([5, 5, 5]), 1), 'jainIndex: тэнцүү = 1');
  assert(near(M.jainIndex([9, 0, 0]), 1 / 3), 'jainIndex: ганцхан нь идсэн = 1/n');
  eq(M.jainIndex([0, 0]), null, 'jainIndex: хэн ч идээгүй = null');
  assert(near(M.minMaxRatio([8, 8, 6, 7, 7]), 0.75), 'minMaxRatio: 6/8');
  eq(M.minMaxRatio([0, 0]), null, 'minMaxRatio: хэн ч идээгүй = null');
}

// --- fairnessSummary: dp-ийн талбар байвал түүнийг, үгүй бол тооцно ---
{
  const fromDp = M.fairnessSummary({ meals: [2, 2], avg_wait_ms: [1, 1], max_wait_ms: [1, 1],
    jain_meals: 0.42, min_max_ratio: 0.1, jain_avg_wait: null, overall_avg_wait_ms: 3, overall_max_wait_ms: 99, worst_wait_id: 1 });
  assert(fromDp.source === 'dp' && fromDp.jain === 0.42 && fromDp.maxWait === 99 && fromDp.worstId === 1,
    'fairnessSummary: dp.c-ийн тооцсон утгыг ашиглана');
  const old = M.fairnessSummary({ meals: [10, 0, 9], avg_wait_ms: [50, 0, 60], max_wait_ms: [120, 900, 140], final_hungry_wait_ms: [0, 900, 0] });
  assert(old.source === 'ui' && near(old.avgWait, (500 + 540) / 19) && old.maxWait === 900 && old.worstId === 1 && old.minMax === 0,
    'fairnessSummary: хуучин лог (талбаргүй) -> массиваас тооцно, дуусаагүй хүлээлт max-д орно');
}

// --- defaultWarnThreshold ---
{
  eq(M.defaultWarnThreshold({ emax: 3000 }), 12000, 'defaultWarnThreshold: 4×emax');
  eq(M.defaultWarnThreshold({ emax: 10 }), 500, 'defaultWarnThreshold: доод хязгаар 500 мс');
  eq(M.defaultWarnThreshold(null), 800, 'defaultWarnThreshold: params байхгүй үед ч ажиллана');
}

// --- wait state: удаан hungry анхааруулга ---
{
  let ws = M.emptyWaitState(2);
  ws = M.applyWaitEvent(ws, { type: 'state', t: 100, id: 1, state: 'hungry', forks: [-1, -1] });
  ws = M.applyWaitEvent(ws, { type: 'state', t: 1100, id: 0, state: 'thinking', forks: [-1, -1] });
  eq(M.hungryWaits(ws), [0, 1000], 'hungryWaits: P1 1000 мс hungry');
  eq(M.waitWarnings(ws, 800), [{ id: 1, waitMs: 1000 }], 'waitWarnings: босгоос (800) удаан -> анхааруулга');
  eq(M.waitWarnings(ws, 1500), [], 'waitWarnings: босгоос богино -> анхааруулгагүй');
  eq(M.waitWarnings(ws, 1500, 1700), [{ id: 1, waitMs: 1600 }], 'waitWarnings: live үед event хүлээлгүй цаг урагшилна');
  const ws2 = M.applyWaitEvent(ws, { type: 'state', t: 1150, id: 1, state: 'eating', forks: [-1, 1] });
  eq(M.waitWarnings(ws2, 800), [], 'waitWarnings: идэж эхэлмэгц анхааруулга арилна');
  eq(ws.since[1], 100, 'applyWaitEvent: өмнөх төлөв immutable хэвээр');
}
{
  // naive: hungry -> hungry (зүүн fork авсан) үед hungry эхэлсэн мөч хэвээр
  let ws = M.emptyWaitState(1);
  ws = M.applyWaitEvent(ws, { type: 'state', t: 10, id: 0, state: 'hungry', forks: [-1] });
  ws = M.applyWaitEvent(ws, { type: 'state', t: 310, id: 0, state: 'hungry', forks: [0] });
  eq(M.hungryWaits(ws), [300], 'applyWaitEvent: naive hungry->hungry эхний мөчийг хадгална');
}
{
  // deadlock-ийн дараах cleanup event анхааруулгыг арилгахгүй (applyEvent-тэй нийцтэй)
  const fs = require('fs');
  const lines = fs.readFileSync(path.join(__dirname, 'examples', 'naive_deadlock_n5_sample.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(e => e.type !== 'exit');
  const n = lines.find(e => e.type === 'config').n;
  const wss = M.buildWaitStates(n, lines);
  eq(wss.length, lines.length + 1, 'buildWaitStates: buildSnapshots-тэй ижил урт (replay-д индекс таарна)');
  const last = wss[wss.length - 1];
  assert(last.deadlock && M.hungryWaits(last).every(w => w > 0),
    'buildWaitStates: naive жишээ лог — cleanup-ийн дараа ч бүх philosopher hungry хүлээлттэй');
  assert(/ЭРСДЭЛ/.test(M.WARN_TEXT) && /батлагдсан starvation биш/.test(M.WARN_TEXT),
    'WARN_TEXT: эрсдэл бөгөөд батлагдсан starvation биш гэдгийг тайлбарласан');
}

// =====================================================================
// Suggestion 2: туршилтын түүх ба харьцуулалт
// =====================================================================
{
  const p = M.validateParams({ algo: 'monitor', n: '4', tmin: '0', tmax: '50', emin: '10', emax: '50', dur: '2000', seed: '7', grab: '0' }).params;
  const r = M.runRecord(p, { t: 2000, reason: 'timeout', meals: [2, 2, 2, 2], avg_wait_ms: [1, 1, 1, 1], max_wait_ms: [3, 3, 3, 3] }, 1, 500);
  assert(r.n === 4 && r.emax === 50 && r.dur === 2000 && r.totalMeals === 8 && near(r.throughput, 4) && near(r.jain, 1) && r.warnCount === 1,
    'runRecord: params + end -> бичлэг (throughput = хооллолт/сек)');
}
{
  const b = { algo: 'monitor', tmin: 0, tmax: 50, emin: 10, emax: 50, dur: 1000, grab: 0 };
  const runs = [Object.assign({}, b, { n: 12, avgWait: 30 }), Object.assign({}, b, { n: 5, avgWait: 10 }),
    Object.assign({}, b, { n: 5, avgWait: 20 }), Object.assign({}, b, { emax: 500, n: 5, avgWait: 99 }),
    Object.assign({}, b, { n: 32, avgWait: null })];
  const s = M.buildSeries(runs, 'avgWait');
  eq(s.xs, [5, 12], 'buildSeries: x тэнхлэг = N (null утгатайг алгасна)');
  eq(s.series.length, 2, 'buildSeries: өөр тохиргоо = өөр шугам');
  eq(s.series[0].points.map(q => [q.n, q.y, q.count]), [[5, 15, 2], [12, 30, 1]], 'buildSeries: ижил N-ийн давталтыг дундажлана');
}
{
  const csv = M.runsToCSV([{ algo: 'a,b', n: 5, jain: null, throughput: 1.234567 }]).split('\n');
  eq(csv[0], M.RUN_COLS.join(','), 'runsToCSV: толгой мөр');
  assert(csv[1].indexOf('"a,b",5,') >= 0 && csv[1].indexOf('1.2346') >= 0, 'runsToCSV: таслал escape, тоо тоймлолт');
}
{
  const mem = {}, fake = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
  const st = M.makeRunStore(fake);
  st.add({ id: 'a', algo: 'monitor', n: 5 });
  eq(M.makeRunStore(fake).all().length, 1, 'makeRunStore: хуудас дахин ачаалсны дараа localStorage-аас уншина');
  eq(st.importMany([{ id: 'b', algo: 'naive', n: 5 }, { id: 'a', algo: 'monitor', n: 5 }, { id: 'c', algo: 'evil', n: 5 }, { id: 'd', algo: 'monitor', n: 99 }]), 1,
    'makeRunStore.importMany: давхардсан id, буруу алгоритм, хязгаараас гарсан N-ийг алгасна');
  st.remove('a'); eq(st.all().map(r => r.id), ['b'], 'makeRunStore.remove');
  const nostore = M.makeRunStore(null); nostore.add({ id: 'x', algo: 'monitor', n: 2 });
  eq(nostore.all().length, 1, 'makeRunStore: localStorage байхгүй (private mode) үед санах ойд ажиллана');
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
