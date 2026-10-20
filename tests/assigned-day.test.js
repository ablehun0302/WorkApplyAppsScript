// 관리자 '배치된 근무자' 탭: 하루 배치 저장(saveAssignedDay)과 주간 표 그리기 검증.
// 실행(저장소 루트에서): node tests/assigned-day.test.js
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
    getRange(row, col) {
      return {
        setValue(v) { rows[row - 1][col - 1] = v; },
        setValues(vals) { vals[0].forEach((v, j) => { rows[row - 1][col - 1 + j] = v; }); }
      };
    },
    appendRow(r) { rows.push(r.slice()); },
    deleteRow(row) { rows.splice(row - 1, 1); },
    getLastRow() { return rows.length; }
  };
}

const A = '신세계푸드 원남', B = 'BGF푸드_진천', C = '델몬트_원남';

function load(dataRows, assignRows, historyRows) {
  const server = vm.createContext({
    requireAdmin_() {},
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Logger: { log() {} }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'WorkSystemSheet.gs'), 'utf8'), server);
  const data = fakeSheet([['key']].concat(dataRows));
  const assign = fakeSheet([['assignKey']].concat(assignRows || []));
  const history = fakeSheet([['histKey']].concat(historyRows || []));
  server.getDataSheet_ = () => data;
  server.getAssignSheet_ = () => assign;
  server.getHistorySheet_ = () => history;
  return {
    run: (key, date, location, shifts) => server.saveAssignedDay(key, date, location, shifts, 'pw'),
    shifts: (i) => JSON.parse(data.rows[i + 1][5]),
    assign: () => assign.rows.slice(1),
    history: () => history.rows.slice(1).map(r => r[0])
  };
}

// key, name, phone, pin, ts, shiftsJSON, locationsJSON, adminLocation, message, gender, adminGender
const dataRow = (key, shifts, locations, adminLocation, gender) =>
  [key, '홍길동', '', '', '', JSON.stringify(shifts), JSON.stringify(locations), adminLocation || '', '', gender || '남', ''];
// assignKey, date, shift, key, name, gender, floor, edu, new, wage, location, transport
const assignRow = (date, shift, key, location, floor) =>
  [date + '_' + shift + '_' + key, date, shift, key, '홍길동', '남', floor || '1층', false, false, false, location, ''];
const info = (floor, extra) => Object.assign({ floor, transport: '', isEducation: false, isNew: false, isWomenWage: false }, extra);

const same = (actual, expected, msg) => assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected), msg);

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

test('신청이 없는 날에도 배치를 추가하고 History에 남긴다', () => {
  const s = load([dataRow('k1', [], [A])]);
  assert.strictEqual(s.run('k1', '2026-10-01', B, { day: info('배치'), night: null }), true);
  same(s.assign(), [['2026-10-01_day_k1', '2026-10-01', 'day', 'k1', '홍길동', '남', '배치', false, false, false, B, '']]);
  same(s.history(), ['k1_2026-10-01']);
  same(s.shifts(0), [], '신청 내역은 만들지 않는다');
});

test('배치정보만 고치면 K열 근무지는 받은 값 그대로 두고 Data로 다시 계산하지 않는다', () => {
  // Data 기준 실효 근무지는 A지만 배치 당시 기록은 B다.
  const s = load([dataRow('k1', [], [A])], [assignRow('2026-10-01', 'day', 'k1', B, '1층')], [['k1_2026-10-01']]);
  s.run('k1', '2026-10-01', B, { day: info('2층', { isEducation: true }), night: null });
  const row = s.assign()[0];
  assert.strictEqual(row[6], '2층');
  assert.strictEqual(row[7], true);
  assert.strictEqual(row[10], B);
  assert.strictEqual(s.assign().length, 1, '같은 행을 고친다');
});

test('주간 취소·야간 추가를 한 번에 하고, 근무지는 두 시프트에 같이 적용한다', () => {
  const s = load([dataRow('k1', [], [A])], [assignRow('2026-10-01', 'day', 'k1', A)], [['k1_2026-10-01']]);
  s.run('k1', '2026-10-01', C, { day: null, night: info('배치') });
  same(s.assign().map(r => [r[2], r[10]]), [['night', C]]);
  same(s.history(), ['k1_2026-10-01'], '그날 배치가 남아 있으면 History도 남는다');
});

test('둘 다 취소하면 배치 행과 History가 지워지고 신청은 남는다', () => {
  const sh = [{ date: '2026-10-01', day: true, night: true }];
  const s = load([dataRow('k1', sh, [A])],
    [assignRow('2026-10-01', 'day', 'k1', A), assignRow('2026-10-01', 'night', 'k1', A), assignRow('2026-10-02', 'day', 'k1', A)],
    [['k1_2026-10-01'], ['k1_2026-10-02']]);
  s.run('k1', '2026-10-01', A, { day: null, night: null });
  same(s.assign().map(r => r[0]), ['2026-10-02_day_k1'], '다른 날짜 배치는 그대로');
  same(s.history(), ['k1_2026-10-02']);
  same(s.shifts(0), sh);
});

test('Data에 그날 신청이 있으면 그 근무지도 맞추고, 기본 근무지로 바꾸면 예외를 푼다', () => {
  const s = load([dataRow('k1', [{ date: '2026-10-01', day: true, night: false }, { date: '2026-10-02', day: true, night: false, location: B }], [A])],
    [assignRow('2026-10-01', 'day', 'k1', A), assignRow('2026-10-02', 'day', 'k1', B)]);
  s.run('k1', '2026-10-01', C, { day: info('배치'), night: null });
  s.run('k1', '2026-10-02', A, { day: info('배치'), night: null });
  same(s.shifts(0), [{ date: '2026-10-01', day: true, night: false, location: C }, { date: '2026-10-02', day: true, night: false }]);
});

test('성별은 관리자 지정 성별을 쓰고 여임금이면 여로 기록한다', () => {
  const row = dataRow('k1', [], [A]);
  row[10] = '여';
  const s = load([row, dataRow('k2', [], [A])]);
  s.run('k1', '2026-10-01', A, { day: info('배치'), night: null });
  s.run('k2', '2026-10-01', A, { day: info('배치', { isWomenWage: true }), night: null });
  same(s.assign().map(r => r[5]), ['여', '여']);
});

test('화면을 연 뒤 신청 취소로 지워진 배치(existed)는 되살리지 않고, 새로 체크한 시프트는 만든다', () => {
  const s = load([dataRow('k1', [], [A])], [], [['k1_2026-10-15']]);
  const res = s.run('k1', '2026-10-15', A, { day: info('1층', { existed: true }), night: info('배치') });
  assert.strictEqual(res, 'stale');
  same(s.assign().map(r => r[2]), ['night']);
  same(s.history(), ['k1_2026-10-15']);

  const s2 = load([dataRow('k1', [], [A])], [], [['k1_2026-10-15']]);
  assert.strictEqual(s2.run('k1', '2026-10-15', A, { day: info('1층', { existed: true }), night: null }), 'stale');
  same(s2.assign(), []);
  same(s2.history(), [], '남은 배치가 없으면 History도 지운다');
});

test('Data에서 지워진 사람은 기존 배치 행의 이름·성별로 고치고, 기록이 없으면 저장하지 않는다', () => {
  const s = load([], [assignRow('2026-10-01', 'day', 'gone', A)]);
  assert.strictEqual(s.run('gone', '2026-10-01', A, { day: null, night: info('배치') }), true);
  same(s.assign().map(r => [r[2], r[4], r[5]]), [['night', '홍길동', '남']]);
  assert.strictEqual(s.run('nobody', '2026-10-01', A, { day: info('배치'), night: null }), false);
  assert.strictEqual(s.assign().length, 1);
});

// ---- 화면 스크립트를 가짜 DOM 위에서 돌린다 (kitchen-work-type.test.js의 loadView를 줄인 것) ----
// 오늘은 2026-10-14(수)로 고정해 이번 주가 10/12(월)~10/18(일)이 되게 한다.
function loadAdminView() {
  const els = {};
  const el = (id) => els[id] || (els[id] = {
    id, innerHTML: '', value: '', textContent: '', style: {}, options: [], dataset: {}, disabled: false, checked: false,
    classList: { toggle() {}, add() {}, remove() {} },
    appendChild(child) { this.options.push(child); },
    addEventListener() {}, focus() {}, querySelectorAll() { return []; }
  });
  // 서버 호출은 실행하지 않고 { fn, args }로 기록만 한다.
  const calls = [];
  const run = new Proxy({}, {
    get: (target, fn) => (fn === 'withSuccessHandler' || fn === 'withFailureHandler')
      ? () => run
      : (...args) => { calls.push({ fn, args }); }
  });
  const NOW = new Date(2026, 9, 14, 12).getTime();
  class FakeDate extends Date {
    constructor(...args) { if (args.length) super(...args); else super(NOW); }
  }
  const ctx = vm.createContext({
    Date: FakeDate,
    document: {
      addEventListener() {}, getElementById: el, createElement: () => el('created' + Object.keys(els).length),
      querySelectorAll: () => [], querySelector: () => null
    },
    window: { addEventListener() {}, scrollTo() {} },
    sessionStorage: { getItem() { return null; }, setItem() {} },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    history: { pushState() {}, back() {} },
    setInterval() { return 0; }, clearInterval() {}, setTimeout() { return 0; }, clearTimeout() {},
    google: { script: { run } }
  });
  const sharedHtml = fs.readFileSync(path.join(root, 'ApplyWorkerSite', 'SharedScript.html'), 'utf8');
  vm.runInContext(sharedHtml.match(/<script>([\s\S]*)<\/script>/)[1], ctx);
  const viewHtml = fs.readFileSync(path.join(root, 'ApplyWorkerSite', 'AdminView.html'), 'utf8');
  (viewHtml.match(/<script>[\s\S]*?<\/script>/g) || []).forEach((block) => {
    vm.runInContext(block.replace(/^<script>/, '').replace(/<\/script>$/, ''), ctx);
  });
  return {
    els: new Proxy(els, { get: (target, id) => el(id) }),
    W: (expr) => vm.runInContext(expr, ctx),
    callsTo: (fn) => calls.filter(c => c.fn === fn).map(c => c.args)
  };
}

const WEEK = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];
const rec = (key, name, gender, locations, extra) =>
  Object.assign({ key, name, pin: '900101', phone: '010-1111-2222', gender, adminGender: '', shifts: [], locations, adminLocation: '' }, extra);
const asg = (date, shift, key, location, extra) =>
  Object.assign({ date, shift, key, name: '옛이름', gender: '남', floor: '1층', isEducation: false, isNew: false, isWomenWage: false, location, transport: '' }, extra);
const rowsOf = (v, records, assignments, filter) =>
  JSON.parse(v.W(`JSON.stringify(buildAssignedRows_(${JSON.stringify(records)}, ${JSON.stringify(assignments)}, ${JSON.stringify(WEEK)}, ${JSON.stringify(filter || '')}))`));

test('화면: 그 주에 배치된 사람만, 성별(남→여)·이름순, 주간·야간 같은 날은 1일', () => {
  const v = loadAdminView();
  const rows = rowsOf(v,
    [rec('k1', '홍길동', '남', [A]), rec('k2', '김영희', '여', [A]), rec('k3', '가나다', '남', [A]), rec('k4', '없음', '남', [A])],
    [asg('2026-10-13', 'night', 'k1', A), asg('2026-10-13', 'day', 'k1', A), asg('2026-10-14', 'day', 'k1', B),
     asg('2026-10-12', 'day', 'k2', A), asg('2026-10-15', 'day', 'k3', A), asg('2026-10-19', 'day', 'k4', A)]);
  same(rows.map(r => [r.name, r.days]), [['가나다', 1], ['홍길동', 2], ['김영희', 1]]);
  const cell = rows[1].cells['2026-10-13'];
  assert.strictEqual(cell.location, A);
  same(cell.items.map(a => a.shift), ['day', 'night'], '주간이 먼저');
});

test('화면: 근무지 필터는 그 근무지 날이 있는 사람만 남기고 근무일수도 그 근무지 날만 센다', () => {
  const v = loadAdminView();
  const rows = rowsOf(v, [rec('k1', '홍길동', '남', [A]), rec('k2', '김영희', '여', [A])],
    [asg('2026-10-12', 'day', 'k1', A), asg('2026-10-13', 'day', 'k1', B), asg('2026-10-14', 'day', 'k1', B),
     asg('2026-10-12', 'day', 'k2', A)], B);
  same(rows.map(r => [r.name, r.days]), [['홍길동', 2]]);
  assert.ok(rows[0].cells['2026-10-12'], '다른 근무지 날도 칸은 보여준다(흐리게)');
});

test('화면: K열이 비면 Data 근무지, Data에서 지워진 사람은 배치 행의 이름·성별', () => {
  const v = loadAdminView();
  const rows = rowsOf(v, [rec('k1', '홍길동', '남', [A], { shifts: [{ date: '2026-10-12', day: true, location: C }] })],
    [asg('2026-10-12', 'day', 'k1', ''), asg('2026-10-12', 'day', 'gone', B, { gender: '여' })]);
  same(rows.map(r => [r.name, r.gender, r.phone, r.cells['2026-10-12'].location]), [['홍길동', '남', '010-1111-2222', C], ['옛이름', '여', '', B]]);
});

test('화면: 날짜 칸을 열고 야간을 추가·근무지를 바꿔 저장하면 하루치를 한 번에 보낸다', () => {
  const v = loadAdminView();
  v.W(`assignedRecords = ${JSON.stringify([rec('k1', '홍길동', '남', [A])])};
       assignedAssignments = ${JSON.stringify([asg('2026-10-13', 'day', 'k1', A, { floor: '2층', isNew: true })])};
       openAssignedDay('k1', '2026-10-13');`);
  assert.strictEqual(v.els.assignedDayOverlay.style.display, 'flex');
  // 새로 켠 시프트의 층 기본값은 그때 근무지의 첫 배치정보다(BGF는 '배치').
  v.W(`setAssignedDraftLocation('${B}'); toggleAssignedDraftShift('night', true); saveAssignedDayEdit();`);
  const args = v.callsTo('saveAssignedDay')[0];
  same(args.slice(0, 3), ['k1', '2026-10-13', B]);
  same(args[3], {
    day: { floor: '2층', transport: '', isEducation: false, isNew: true, isWomenWage: false, existed: true },
    night: { floor: '배치', transport: '', isEducation: false, isNew: false, isWomenWage: false }
  });
});

test('화면: 배치가 없는 날을 열면 근무지는 그날 신청 기준, 두 시프트 모두 꺼진 상태', () => {
  const v = loadAdminView();
  v.W(`assignedRecords = ${JSON.stringify([rec('k1', '홍길동', '남', [A], { adminLocation: C })])};
       assignedAssignments = []; openAssignedDay('k1', '2026-10-15');`);
  same(JSON.parse(v.W('JSON.stringify(assignedDayDraft)')), { key: 'k1', date: '2026-10-15', location: C, day: null, night: null });
});

// ---- 일간 보기 ----
function loadDayView(records, assignments) {
  const v = loadAdminView();
  v.W(`assignedRecords = ${JSON.stringify(records)}; assignedAssignments = ${JSON.stringify(assignments)};`);
  return v;
}

test('일간: 처음엔 주간 보기이고, 일간으로 바꾸면 오늘(이번 주 안)이 골라지며 날짜 버튼 7개가 나열된다', () => {
  const v = loadDayView([], []);
  assert.strictEqual(v.W('assignedView'), 'week');
  v.W('renderAssignedWorkers()');
  assert.strictEqual(v.W('assignedSelectedDate'), '2026-10-14');
  assert.strictEqual(v.els.assignedDateButtons.style.display, 'none');
  v.W("setAssignedView('day')");
  assert.strictEqual(v.els.assignedDateButtons.style.display, 'flex');
  assert.strictEqual(v.els.assignedWeekLabel.style.display, 'none');
  assert.strictEqual(v.els.assignedViewDayBtn.className, 'primary');
  assert.strictEqual(v.els.assignedViewWeekBtn.className, 'secondary');
  const html = v.els.assignedDateButtons.innerHTML;
  assert.strictEqual(html.split('selectAssignedDate(').length - 1, 7);
  assert.ok(html.includes('<button class="primary"') && html.includes("selectAssignedDate('2026-10-14')"), '고른 날짜 버튼만 강조');
  assert.strictEqual(html.split('class="primary"').length - 1, 1);
});

test('일간: 날짜 버튼을 누르면 그날로 바뀌고, 주를 넘기면 같은 요일로 따라간다', () => {
  const v = loadDayView([], []);
  v.W("renderAssignedWorkers(); setAssignedView('day'); selectAssignedDate('2026-10-16');");
  assert.strictEqual(v.W('assignedSelectedDate'), '2026-10-16');
  v.W('moveAssignedWeek(1)');
  assert.strictEqual(v.W('assignedSelectedDate'), '2026-10-23');
  v.W('moveAssignedWeek(-2)');
  assert.strictEqual(v.W('assignedSelectedDate'), '2026-10-09');
});

test('일간: 오늘이 없는 주를 열면 그 주 월요일이 골라진다', () => {
  const v = loadDayView([], []);
  v.W('assignedWeekStart.setDate(assignedWeekStart.getDate() + 7); renderAssignedWorkers();');
  assert.strictEqual(v.W('assignedSelectedDate'), '2026-10-19');
});

const cardsOf = (v, date, filter) =>
  JSON.parse(v.W(`JSON.stringify(buildAssignedDayCards_(assignedRecords, assignedAssignments, '${date}', '${filter || ''}')
    .map(c => [c.location, c.day.map(p => p.name), c.night.map(p => p.name)]))`));

test('일간: 그날 배치를 LOCATIONS 순서의 근무지 카드로 묶고 주간·야간은 성별·이름순, 지워진 사람은 배치 행 이름', () => {
  const v = loadDayView(
    [rec('k1', '홍길동', '남', [A]), rec('k2', '김영희', '여', [A]), rec('k3', '가나다', '남', [A])],
    [asg('2026-10-14', 'day', 'k1', A), asg('2026-10-14', 'day', 'k2', A), asg('2026-10-14', 'day', 'k3', A),
     asg('2026-10-14', 'night', 'k2', C), asg('2026-10-14', 'night', 'k1', B), asg('2026-10-14', 'day', 'gone', B, { gender: '여' }),
     asg('2026-10-15', 'day', 'k1', A)]);
  same(cardsOf(v, '2026-10-14'), [
    [A, ['가나다', '홍길동', '김영희'], []],
    [C, [], ['김영희']],
    [B, ['옛이름'], ['홍길동']]
  ]);
  same(cardsOf(v, '2026-10-14', B), [[B, ['옛이름'], ['홍길동']]], '근무지 필터는 그 근무지 카드만');
  same(cardsOf(v, '2026-10-16'), [], '배치가 없는 날');
});

test('일간: 사람 줄에 성별별 번호·입력칸·저장·배치취소가 그려지고 주야 둘 다 있는 사람만 안내가 붙는다', () => {
  const v = loadDayView(
    [rec('k1', '홍길동', '남', [A]), rec('k2', '김철수', '남', [A])],
    [asg('2026-10-14', 'day', 'k1', A, { floor: '2층', isNew: true }), asg('2026-10-14', 'night', 'k1', A),
     asg('2026-10-14', 'day', 'k2', A)]);
  v.W("renderAssignedWorkers(); setAssignedView('day');");
  const html = v.els.assignedContent.innerHTML;
  assert.ok(html.includes('남1.김철수 900101') && html.includes('남2.홍길동 900101'), '번호는 이름순으로 이어 매기고 이름 뒤에 생년월일');
  assert.ok(html.includes("saveAssignedDayRow('k1','day')") && html.includes("cancelAssignedDayRow('k1','night')"));
  assert.ok(html.includes('<option value="2층" selected>2층</option>'), '저장된 배치정보가 골라져 있다');
  assert.ok(/id="adn_day_k1" checked/.test(html) && !/id="adn_day_k2" checked/.test(html), '신규 체크는 저장된 값대로');
  assert.strictEqual(html.split('근무지는 주야 모두 적용').length - 1, 2, 'k1의 주간·야간 두 줄에만');
});

test('일간: 줄 저장은 그 시프트의 입력값과 다른 시프트의 지금 값을 하루치로 한 번에 보낸다', () => {
  const v = loadDayView([rec('k1', '홍길동', '남', [A])],
    [asg('2026-10-14', 'day', 'k1', A, { floor: '2층' }), asg('2026-10-14', 'night', 'k1', A, { floor: '3층', isEducation: true })]);
  v.W('renderAssignedWorkers()');
  v.els.adl_day_k1.value = B;
  v.els.adf_day_k1.value = '배치';
  v.els.adn_day_k1.checked = true;
  v.W("saveAssignedDayRow('k1', 'day')");
  const args = v.callsTo('saveAssignedDay')[0];
  same(args.slice(0, 3), ['k1', '2026-10-14', B]);
  same(args[3], {
    day: { floor: '배치', transport: '', isEducation: false, isNew: true, isWomenWage: false, existed: true },
    night: { floor: '3층', transport: '', isEducation: true, isNew: false, isWomenWage: false, existed: true }
  });
});

test('일간: 배치취소는 그 시프트만 null로 보내고 근무지는 저장돼 있던 값을 쓴다', () => {
  const v = loadDayView([rec('k1', '홍길동', '남', [A])],
    [asg('2026-10-14', 'day', 'k1', C, { floor: '2층' }), asg('2026-10-14', 'night', 'k1', C, { floor: '3층' })]);
  v.W('renderAssignedWorkers()');
  v.els.adl_night_k1.value = B; // 줄에서 근무지를 바꿔 놓았어도 취소에는 영향이 없다
  v.W("cancelAssignedDayRow('k1', 'night')");
  const args = v.callsTo('saveAssignedDay')[0];
  same(args.slice(0, 3), ['k1', '2026-10-14', C]);
  same(args[3], { day: { floor: '2층', transport: '', isEducation: false, isNew: false, isWomenWage: false, existed: true }, night: null });

  const v2 = loadDayView([rec('k1', '홍길동', '남', [A])], [asg('2026-10-14', 'day', 'k1', A)]);
  v2.W('renderAssignedWorkers()');
  v2.W("cancelAssignedDayRow('k1', 'day')");
  same(v2.callsTo('saveAssignedDay')[0][3], { day: null, night: null });
});

test('일간: 줄에서 근무지를 바꾸면 그 줄의 배치정보 목록만 새 근무지 것으로 바뀌고 입력한 값은 남는다', () => {
  const v = loadDayView([rec('k1', '홍길동', '남', [A])], [asg('2026-10-14', 'day', 'k1', A, { floor: '2층' })]);
  v.W('renderAssignedWorkers()');
  v.els.adl_day_k1.value = B;
  v.els.adf_day_k1.value = '2층';
  v.els.adn_day_k1.checked = true;
  v.W("onAssignedRowLocationChange('k1', 'day')");
  const html = v.els.adfields_day_k1.innerHTML;
  assert.ok(html.includes('<option value="배치" '), 'BGF의 배치정보 선택지');
  assert.ok(html.includes('<option value="2층" selected>2층</option>'), '새 목록에 없는 기존 값은 그대로 유지');
  assert.ok(/id="adn_day_k1" checked/.test(html), '체크한 값 유지');
});

test('일간: ➕ 배치 추가 창은 일간 보기에서 고른 날짜로 열린다', () => {
  const v = loadDayView([rec('k1', '홍길동', '남', [A])], []);
  v.W("renderAssignedWorkers(); setAssignedView('day'); selectAssignedDate('2026-10-16'); openAssignedDay('', assignedView === 'day' ? assignedSelectedDate : '');");
  assert.strictEqual(v.W('assignedDayDraft.date'), '2026-10-16');
});

console.log('\n' + passed + '개 통과');
