// 관리자 화면 '근무지 수정' 모드의 서버 저장(batchSetShiftLocations) 검증.
// 실행(저장소 루트에서): node tests/shift-location-batch.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');

// 시트는 2차원 배열 하나로 흉내 낸다. 첫 줄은 헤더.
function fakeSheet(rows) {
  return {
    rows: rows,
    getDataRange() { return { getValues: () => rows.map(r => r.slice()) }; },
    getRange(row, col) { return { setValue(v) { rows[row - 1][col - 1] = v; } }; }
  };
}

const A = '신세계푸드 원남', B = 'BGF푸드_진천', C = '델몬트_원남';

function load(dataRows, assignRows) {
  const server = vm.createContext({
    requireAdmin_() {},
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Logger: { log() {} }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'WorkSystemSheet.gs'), 'utf8'), server);
  const data = fakeSheet([['key']].concat(dataRows));
  const assign = fakeSheet([['assignKey']].concat(assignRows || []));
  server.getDataSheet_ = () => data;
  server.getAssignSheet_ = () => assign;
  return {
    run: (list, location) => server.batchSetShiftLocations(list, location, 'pw'),
    shifts: (i) => JSON.parse(data.rows[i + 1][5]),
    assignLocation: (i) => assign.rows[i + 1][10]
  };
}

// key, name, phone, pin, ts, shiftsJSON, locationsJSON, adminLocation
const dataRow = (key, shifts, locations, adminLocation) =>
  [key, '이름', '', '', '', JSON.stringify(shifts), JSON.stringify(locations), adminLocation || ''];
// assignKey, date, shift, key, name, gender, floor, edu, new, wage, location, transport
const assignRow = (date, shift, key, location) =>
  [date + '_' + shift + '_' + key, date, shift, key, '이름', '남', '1층', false, false, false, location, ''];

const same = (actual, expected, msg) => assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected), msg);

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

test('여러 사람·여러 날짜를 한 근무지로 옮기고, 고르지 않은 날짜는 그대로 둔다', () => {
  const s = load([
    dataRow('k1', [{ date: '2026-10-12', day: true, night: false }, { date: '2026-10-13', day: true, night: true }, { date: '2026-10-14', day: true, night: false }], [A]),
    dataRow('k2', [{ date: '2026-10-12', day: false, night: true }], [A])
  ]);
  const res = s.run([{ key: 'k1', date: '2026-10-12' }, { key: 'k1', date: '2026-10-13' }, { key: 'k2', date: '2026-10-12' }], B);
  same(res, { saved: 3, skipped: 0 });
  same(s.shifts(0), [
    { date: '2026-10-12', day: true, night: false, location: B },
    { date: '2026-10-13', day: true, night: true, location: B },
    { date: '2026-10-14', day: true, night: false }
  ]);
  same(s.shifts(1), [{ date: '2026-10-12', day: false, night: true, location: B }]);
});

test('기본 근무지로 옮기면 그 날짜의 예외 지정이 풀린다', () => {
  const s = load([dataRow('k1', [{ date: '2026-10-12', day: true, night: false, location: B }], [C], A)]);
  same(s.run([{ key: 'k1', date: '2026-10-12' }], A), { saved: 1, skipped: 0 });
  same(s.shifts(0), [{ date: '2026-10-12', day: true, night: false }], '관리자 지정 근무지(H열)가 기본값');
});

test('그사이 신청이 취소된 날짜·없는 사람은 건너뛰고 건수만 돌려준다', () => {
  const s = load([dataRow('k1', [{ date: '2026-10-12', day: true, night: false }], [A])]);
  const res = s.run([{ key: 'k1', date: '2026-10-12' }, { key: 'k1', date: '2026-10-13' }, { key: 'gone', date: '2026-10-12' }], B);
  same(res, { saved: 1, skipped: 2 });
  same(s.shifts(0), [{ date: '2026-10-12', day: true, night: false, location: B }], '없는 날짜를 새로 만들지 않는다');
});

test('이미 배치된 날짜는 Assign K열도 주간·야간 모두 따라간다', () => {
  const s = load(
    [dataRow('k1', [{ date: '2026-10-12', day: true, night: true }, { date: '2026-10-13', day: true, night: false }], [A])],
    [assignRow('2026-10-12', 'day', 'k1', A), assignRow('2026-10-12', 'night', 'k1', A), assignRow('2026-10-13', 'day', 'k1', A), assignRow('2026-10-12', 'day', 'k2', A)]
  );
  s.run([{ key: 'k1', date: '2026-10-12' }], B);
  assert.strictEqual(s.assignLocation(0), B);
  assert.strictEqual(s.assignLocation(1), B);
  assert.strictEqual(s.assignLocation(2), A, '고르지 않은 날짜');
  assert.strictEqual(s.assignLocation(3), A, '다른 사람');
});

// ---- 관리자 화면의 근무지 수정 모드 ----
// 요소는 id로 찾을 때 만들어지고 값만 기억한다. 서버 호출은 실행하지 않고 { fn, args }로 기록한다.
function loadAdminView() {
  const els = {};
  const el = (id) => els[id] || (els[id] = {
    id, innerHTML: '', value: '', textContent: '', title: '', style: {}, options: [], dataset: {}, disabled: false, checked: false,
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    appendChild() {}, addEventListener() {}, focus() {}, querySelectorAll() { return []; }
  });
  const calls = [];
  const run = new Proxy({}, {
    get: (target, fn) => (fn === 'withSuccessHandler' || fn === 'withFailureHandler')
      ? () => run
      : (...args) => { calls.push({ fn, args }); }
  });
  const state = { confirmAnswer: true };
  const ctx = vm.createContext({
    document: {
      addEventListener() {}, getElementById: el, createElement: () => el('created' + Object.keys(els).length),
      querySelectorAll: () => [], querySelector: () => null,
      body: { classList: { toggle() {}, add() {}, remove() {} } }
    },
    window: { addEventListener() {}, scrollTo() {} },
    sessionStorage: { getItem() { return null; }, setItem() {} },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    history: { pushState() {}, back() {} },
    setInterval() { return 0; }, clearInterval() {}, setTimeout() { return 0; }, clearTimeout() {},
    confirm: () => state.confirmAnswer,
    google: { script: { run } }
  });
  const scripts = (file) => fs.readFileSync(path.join(root, 'ApplyWorkerSite', file), 'utf8').match(/<script>[\s\S]*?<\/script>/g) || [];
  scripts('SharedScript.html').concat(scripts('AdminView.html')).forEach((block) => {
    vm.runInContext(block.replace(/^<script>/, '').replace(/<\/script>$/, ''), ctx);
  });
  const W = (expr) => vm.runInContext(expr, ctx);
  // 탭 전환이 표 전체를 다시 그리지 않게 한다. 여기서 보는 것은 모드 상태뿐이다.
  W('renderAdmin = function() {}');
  return { els: new Proxy(els, { get: (target, id) => el(id) }), calls, state, W };
}
const click = (v, dateStr, shiftKey, key, hasShift) =>
  v.W(`handleDateCellClick({ stopPropagation() {} }, '${dateStr}', '${shiftKey}', '${key}', ${hasShift})`);

test("화면: '전체' 탭에서는 근무지 수정 모드가 켜지지 않는다", () => {
  const v = loadAdminView();
  v.W('syncLocEditToolbar(); toggleLocEditMode();');
  assert.strictEqual(v.W('locEditMode'), false);
  assert.strictEqual(v.els.locEditToggleBtn.disabled, true);
  v.W(`setLocationFilter('${A}'); toggleLocEditMode();`);
  assert.strictEqual(v.W('locEditMode'), true);
  assert.strictEqual(v.els.locEditToggleBtn.disabled, false);
});

test('화면: 옮길 근무지는 하나만 고르고, 보고 있는 탭은 목록에서 빠진다', () => {
  const v = loadAdminView();
  v.W(`setLocationFilter('${A}'); toggleLocEditMode();`);
  const html = v.els.locEditTargetRow.innerHTML;
  assert.strictEqual(html.indexOf(`setLocEditTarget('${A}')`), -1, '현재 탭');
  assert.ok(html.indexOf(`setLocEditTarget('${B}')`) > -1);
  v.W(`setLocEditTarget('${B}'); setLocEditTarget('${C}');`);
  assert.strictEqual(v.els.locEditTargetRow.innerHTML.split('selected').length - 1, 1, '선택 표시는 하나');
  assert.strictEqual(v.W('locEditTarget'), C);
});

test('화면: 고른 날짜들을 한 근무지로 한 번에 저장한다', () => {
  const v = loadAdminView();
  v.W(`setLocationFilter('${A}'); toggleLocEditMode();`);
  click(v, '2026-10-12', 'day', 'k1', true);
  click(v, '2026-10-13', 'night', 'k1', true);
  click(v, '2026-10-12', 'day', 'k2', true);
  click(v, '2026-10-14', 'day', 'k2', false);  // 신청 없는 칸은 무시
  click(v, '2026-10-12', 'night', 'k2', true); // 같은 날짜를 다시 누르면 풀린다(근무지는 날짜 단위)
  assert.strictEqual(v.W('countPendingLocChanges()'), 2);
  assert.strictEqual(v.els.locEditSaveBtn.disabled, true, '옮길 근무지를 고르기 전에는 저장할 수 없다');
  v.W('saveLocEditChanges()');
  assert.strictEqual(v.calls.length, 0);

  v.W(`setLocEditTarget('${B}')`);
  assert.strictEqual(v.els.locEditSaveBtn.disabled, false);
  v.W("adminPassword = 'pw'; saveLocEditChanges();");
  const saved = v.calls.filter(c => c.fn === 'batchSetShiftLocations').map(c => c.args);
  same(saved, [[[{ key: 'k1', date: '2026-10-12' }, { key: 'k1', date: '2026-10-13' }], B, 'pw']]);
});

test("화면: 탭을 옮기면 고른 칸을 버리고, '전체' 탭으로 가면 모드가 끝난다", () => {
  const v = loadAdminView();
  v.W(`setLocationFilter('${A}'); toggleLocEditMode(); setLocEditTarget('${B}');`);
  click(v, '2026-10-12', 'day', 'k1', true);

  v.state.confirmAnswer = false;
  v.W(`setLocationFilter('${B}')`);
  assert.strictEqual(v.W('currentLocationFilter'), A, '확인을 거절하면 탭이 바뀌지 않는다');
  assert.strictEqual(v.W('countPendingLocChanges()'), 1);

  v.state.confirmAnswer = true;
  v.W(`setLocationFilter('${B}')`);
  assert.strictEqual(v.W('countPendingLocChanges()'), 0);
  assert.strictEqual(v.W('locEditMode'), true);
  assert.strictEqual(v.W('locEditTarget'), '', '옮길 근무지가 새 탭과 같으면 선택을 푼다');

  v.W("setLocationFilter('전체')");
  assert.strictEqual(v.W('locEditMode'), false);
});

test('화면: 다른 수정 모드를 켜면 근무지 수정 모드가 꺼진다', () => {
  const v = loadAdminView();
  v.W(`setLocationFilter('${A}'); toggleLocEditMode(); toggleInfoEditMode();`);
  assert.strictEqual(v.W('locEditMode'), false);
  assert.strictEqual(v.W('infoEditMode'), true);
  v.W('toggleLocEditMode()');
  assert.strictEqual(v.W('locEditMode'), true);
  assert.strictEqual(v.W('infoEditMode'), false);
  v.W('toggleDateEditMode()');
  assert.strictEqual(v.W('locEditMode'), false);
  assert.strictEqual(v.W('dateEditMode'), true);
});

console.log('\n' + passed + '개 통과');
