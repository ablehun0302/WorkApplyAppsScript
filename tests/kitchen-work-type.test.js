// 주방보조 근무형태·시간대의 화면과 무관한 함수 검증.
// 실행(저장소 루트에서): node tests/kitchen-work-type.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');

// SharedScript.html은 <script> 한 덩어리다. 브라우저 전역은 로딩에 필요한 만큼만 흉내 낸다.
const shared = vm.createContext({
  document: { addEventListener() {}, getElementById() { return null; } },
  window: { addEventListener() {} },
  sessionStorage: { getItem() { return null; }, setItem() {} }
});
const sharedHtml = fs.readFileSync(path.join(root, 'ApplyWorkerSite', 'SharedScript.html'), 'utf8');
vm.runInContext(sharedHtml.match(/<script>([\s\S]*)<\/script>/)[1], shared);
// const로 선언된 값은 컨텍스트 객체의 속성이 아니라서 식으로 꺼낸다.
const S = (expr) => vm.runInContext(expr, shared);

const server = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'WorkSystemSheet.gs'), 'utf8'), server);

// vm 안에서 만든 객체는 프로토타입이 달라 deepStrictEqual이 실패하므로 JSON으로 비교한다.
const same = (actual, expected, msg) => assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected), msg);

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

test('화면 파일의 인라인 스크립트 문법', () => {
  ['SharedScript.html', 'WorkerView.html', 'AdminView.html'].forEach((file) => {
    const html = fs.readFileSync(path.join(root, 'ApplyWorkerSite', file), 'utf8');
    (html.match(/<script>[\s\S]*?<\/script>/g) || []).forEach((block, i) => {
      new vm.Script(block.replace(/^<script>/, '').replace(/<\/script>$/, ''), { filename: file + '#' + i });
    });
  });
});

test('상수', () => {
  assert.strictEqual(S('KITCHEN_LOCATION'), '주방보조_전국');
  assert.ok(S('LOCATIONS').indexOf(S('KITCHEN_LOCATION')) > -1, 'LOCATIONS에 주방보조가 있어야 한다');
  same(S('WORK_TYPES'), { Part: '파트타임', Full: '풀타임' });
});

test('kitchenTimes_: 시작 00:00~23:30, 종료 00:30~24:00', () => {
  const from = shared.kitchenTimes_('timeFrom'), to = shared.kitchenTimes_('timeTo');
  assert.strictEqual(from.length, 48);
  assert.strictEqual(to.length, 48);
  assert.strictEqual(from[0], '00:00');
  assert.strictEqual(from[47], '23:30');
  assert.strictEqual(to[0], '00:30');
  assert.strictEqual(to[47], '24:00');
});

test('kitchenShiftLabel: 정각·30분·앞자리 0·자정 넘김', () => {
  const label = shared.kitchenShiftLabel;
  assert.strictEqual(label({ workType: 'Part', timeFrom: '10:00', timeTo: '15:00' }), '파트 10~15');
  assert.strictEqual(label({ workType: 'Full', timeFrom: '09:00', timeTo: '18:00' }), '풀 9~18');
  assert.strictEqual(label({ workType: 'Part', timeFrom: '10:30', timeTo: '15:00' }), '파트 10:30~15');
  assert.strictEqual(label({ workType: 'Full', timeFrom: '22:00', timeTo: '02:00' }), '풀 22~2');
  assert.strictEqual(label({ workType: 'Full', timeFrom: '00:00', timeTo: '24:00' }), '풀 0~24');
});

test('kitchenShiftLabel: 시간이 없거나 틀리면 근무형태만', () => {
  const label = shared.kitchenShiftLabel;
  assert.strictEqual(label({ workType: 'Part' }), '파트');
  assert.strictEqual(label({ workType: 'Part', timeFrom: '10:00', timeTo: '' }), '파트');
  assert.strictEqual(label({ workType: 'Part', timeFrom: '<b>', timeTo: '15:00' }), '파트');
  assert.strictEqual(label({ workType: 'Part', timeFrom: '10:15', timeTo: '15:00' }), '파트');
  assert.strictEqual(label({ workType: 'Part', timeFrom: ['10:00'], timeTo: '15:00' }), '파트');
});

test('kitchenShiftLabel: 모르는 근무형태는 빈 문자열', () => {
  const label = shared.kitchenShiftLabel;
  assert.strictEqual(label(undefined), '');
  assert.strictEqual(label({ day: true }), '');
  assert.strictEqual(label({ workType: '<img src=x onerror=alert(1)>', timeFrom: '10:00', timeTo: '15:00' }), '');
  assert.strictEqual(label({ workType: 'constructor', timeFrom: '10:00', timeTo: '15:00' }), '');
  assert.strictEqual(label({ workType: 'toString', timeFrom: '10:00', timeTo: '15:00' }), '');
  assert.strictEqual(label({ workType: {}, timeFrom: '10:00', timeTo: '15:00' }), '');
});

test('applyKitchenMode: 주간/야간 신청 → 주방보조', () => {
  const apply = shared.applyKitchenMode;
  const part = { day: true, night: false, workType: 'Part', timeFrom: '', timeTo: '' };
  same(apply({ day: true, night: false }, true), part, '주간만');
  same(apply({ day: false, night: true }, true), part, '야간만');
  same(apply({ day: true, night: true }, true), part, '둘 다');
});

test('applyKitchenMode: 신청 없는 날짜는 신청되지 않는다', () => {
  same(shared.applyKitchenMode({ day: false, night: false }, true),
    { day: false, night: false, workType: '', timeFrom: '', timeTo: '' });
});

test('applyKitchenMode: 이미 입력된 주방보조 값은 유지', () => {
  same(shared.applyKitchenMode({ day: true, night: false, workType: 'Full', timeFrom: '22:00', timeTo: '02:00' }, true),
    { day: true, night: false, workType: 'Full', timeFrom: '22:00', timeTo: '02:00' });
});

test('applyKitchenMode: 목록에 없는 시간·근무형태는 비운다', () => {
  same(shared.applyKitchenMode({ day: true, night: false, workType: 'Full', timeFrom: '10:15', timeTo: '<b>' }, true),
    { day: true, night: false, workType: 'Full', timeFrom: '', timeTo: '' });
  same(shared.applyKitchenMode({ day: true, night: false, workType: 'constructor', timeFrom: '10:00', timeTo: '15:00' }, true),
    { day: true, night: false, workType: 'Part', timeFrom: '', timeTo: '' });
});

test('applyKitchenMode: 주방보조 → 다른 근무지는 주간 신청으로', () => {
  same(shared.applyKitchenMode({ day: true, night: false, workType: 'Part', timeFrom: '10:00', timeTo: '15:00' }, false),
    { day: true, night: false, workType: '', timeFrom: '', timeTo: '' });
  same(shared.applyKitchenMode({ day: false, night: true }, false),
    { day: false, night: true, workType: '', timeFrom: '', timeTo: '' }, '다른 근무지의 야간 신청은 그대로');
});

test('kitchenTimeError', () => {
  const err = shared.kitchenTimeError;
  assert.strictEqual(err({ workType: '', timeFrom: '', timeTo: '' }), false, '신청 없는 날짜');
  assert.strictEqual(err({ workType: 'Part', timeFrom: '', timeTo: '' }), true, '둘 다 빔');
  assert.strictEqual(err({ workType: 'Part', timeFrom: '10:00', timeTo: '' }), true, '종료 빔');
  assert.strictEqual(err({ workType: 'Part', timeFrom: '10:00', timeTo: '10:00' }), true, '시작=종료');
  assert.strictEqual(err({ workType: 'Part', timeFrom: '10:00', timeTo: '15:00' }), false);
  assert.strictEqual(err({ workType: 'Full', timeFrom: '22:00', timeTo: '02:00' }), false, '자정 넘김 허용');
  assert.strictEqual(err({ workType: 'Full', timeFrom: '00:00', timeTo: '24:00' }), false, '24시간');
});

test('kitchenControlsHtml: 근무형태를 골라야 시간 선택이 나온다', () => {
  const html = shared.kitchenControlsHtml;
  const none = html('w', '2026-10-05', { workType: '', timeFrom: '', timeTo: '' }, false);
  assert.ok(none.indexOf("toggleKitchenType('w','2026-10-05','Part')") > -1);
  assert.ok(none.indexOf("toggleKitchenType('w','2026-10-05','Full')") > -1);
  assert.strictEqual(none.indexOf('kitchen-time'), -1);

  const part = html('w', '2026-10-05', { workType: 'Part', timeFrom: '10:00', timeTo: '15:00' }, false);
  assert.ok(part.indexOf('<div class="shift-btn selected" onclick="toggleKitchenType(\'w\',\'2026-10-05\',\'Part\')">파트타임</div>') > -1);
  assert.ok(part.indexOf('<option value="10:00" selected>10:00</option>') > -1);
  assert.ok(part.indexOf('<option value="15:00" selected>15:00</option>') > -1);
});

test('kitchenControlsHtml: 지난 날짜는 누를 수 없다', () => {
  const past = shared.kitchenControlsHtml('w', '2026-10-01', { workType: 'Full', timeFrom: '09:00', timeTo: '18:00' }, true);
  assert.strictEqual(past.indexOf('onclick'), -1);
  assert.ok(past.indexOf('shift-btn selected disabled') > -1);
  assert.ok(past.indexOf('<select class="kitchen-time" disabled') > -1);
});

test('toggleKitchenType·setKitchenTime', () => {
  S("var testSel = { '2026-10-05': { day: false, night: false, workType: '', timeFrom: '', timeTo: '' } }; var redrawn = [];");
  S("KITCHEN_SCOPES.t = { get: function (k) { return testSel[k]; }, redraw: function (k) { redrawn.push(k); } };");
  const sel = shared.testSel['2026-10-05'];
  shared.toggleKitchenType('t', '2026-10-05', 'Part');
  same(sel, { day: true, night: false, workType: 'Part', timeFrom: '', timeTo: '' }, '누르면 신청');
  shared.setKitchenTime('t', '2026-10-05', 'timeFrom', '10:00');
  shared.setKitchenTime('t', '2026-10-05', 'timeTo', '15:00');
  shared.toggleKitchenType('t', '2026-10-05', 'Full');
  same(sel, { day: true, night: false, workType: 'Full', timeFrom: '10:00', timeTo: '15:00' }, '형태만 바꾸면 시간 유지');
  shared.toggleKitchenType('t', '2026-10-05', 'Full');
  same(sel, { day: false, night: false, workType: '', timeFrom: '', timeTo: '' }, '다시 누르면 취소');
  assert.strictEqual(shared.redrawn.length, 3);
});

test('mergeShiftExtras_: 새 값에 없는 근무형태·시간·근무지를 되살린다', () => {
  const merge = server.mergeShiftExtras_;
  const old = [
    { date: '2026-10-05', day: true, night: false, workType: 'Part', timeFrom: '10:00', timeTo: '15:00', location: '주방보조_전국' },
    { date: '2026-10-06', day: true, night: false, location: 'BGF푸드_진천' }
  ];
  same(merge(old, [{ date: '2026-10-05', day: true, night: false }, { date: '2026-10-06', day: true, night: true }]), [
    { date: '2026-10-05', day: true, night: false, location: '주방보조_전국', workType: 'Part', timeFrom: '10:00', timeTo: '15:00' },
    { date: '2026-10-06', day: true, night: true, location: 'BGF푸드_진천' }
  ]);
});

test('mergeShiftExtras_: 새 값에 근무형태가 있으면 새 값을 쓴다', () => {
  const old = [{ date: '2026-10-05', day: true, night: false, workType: 'Part', timeFrom: '10:00', timeTo: '15:00' }];
  same(server.mergeShiftExtras_(old, [{ date: '2026-10-05', day: true, night: false, workType: 'Full', timeFrom: '22:00', timeTo: '02:00' }]),
    [{ date: '2026-10-05', day: true, night: false, workType: 'Full', timeFrom: '22:00', timeTo: '02:00' }]);
});

test('mergeShiftExtras_: 기존에 없던 날짜·빠진 날짜·빈 입력', () => {
  const merge = server.mergeShiftExtras_;
  const old = [{ date: '2026-10-05', day: true, night: false, workType: 'Part', timeFrom: '10:00', timeTo: '15:00' }];
  same(merge(old, [{ date: '2026-10-07', day: true, night: false }]), [{ date: '2026-10-07', day: true, night: false }], '취소된 날짜는 되살아나지 않는다');
  same(merge(null, [{ date: '2026-10-07', day: true, night: false }]), [{ date: '2026-10-07', day: true, night: false }]);
  same(merge(old, null), []);
});

// ---- 화면 스크립트를 가짜 DOM 위에서 돌린다 ----
// 요소는 id로 찾을 때 만들어지고 innerHTML·value 같은 값만 기억한다. 오늘은 2026-10-07(수)로 고정해
// 2주 범위가 10/5(월)~10/18(일), 지난 날짜가 10/5·10/6이 되게 한다.
const KITCHEN = '주방보조_전국';
const OTHER = '신세계푸드 원남';
function loadView(file, checkedLocation) {
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
  const NOW = new Date(2026, 9, 7, 12).getTime();
  class FakeDate extends Date {
    constructor(...args) { if (args.length) super(...args); else super(NOW); }
  }
  const state = { checkedLocation };
  const ctx = vm.createContext({
    Date: FakeDate,
    document: {
      addEventListener() {},
      getElementById: el,
      createElement: () => el('created' + Object.keys(els).length),
      querySelectorAll: () => [],
      // 근무지 라디오(신청 화면 workLocation, 근무자 추가 창 adminAddLocation)는 state.checkedLocation이 골라진 것으로 본다.
      querySelector: (q) => q.indexOf('Location') > -1 ? (state.checkedLocation ? { value: state.checkedLocation } : null) : { value: '남' }
    },
    window: { addEventListener() {}, scrollTo() {} },
    sessionStorage: { getItem() { return null; }, setItem() {} },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    history: { pushState() {}, back() {} },
    setInterval() { return 0; }, clearInterval() {}, setTimeout() { return 0; }, clearTimeout() {},
    google: { script: { run } }
  });
  vm.runInContext(sharedHtml.match(/<script>([\s\S]*)<\/script>/)[1], ctx);
  const viewHtml = fs.readFileSync(path.join(root, 'ApplyWorkerSite', file), 'utf8');
  (viewHtml.match(/<script>[\s\S]*?<\/script>/g) || []).forEach((block) => {
    vm.runInContext(block.replace(/^<script>/, '').replace(/<\/script>$/, ''), ctx);
  });
  // els.아이디로 읽으면 아직 화면 코드가 찾지 않은 요소도 만들어 돌려준다.
  return { els: new Proxy(els, { get: (target, id) => el(id) }), calls, state, W: (expr) => vm.runInContext(expr, ctx) };
}

// ---- 근무자 신청 화면 ----
function loadWorkerView(checkedLocation) {
  const v = loadView('WorkerView.html', checkedLocation);
  v.W("currentName = '홍길동'; currentPin = '900101';");
  // saveRecord(name, pin, phone, shifts, locations, ...) 호출의 인자 목록들
  Object.defineProperty(v, 'saved', { get: () => v.calls.filter(c => c.fn === 'saveRecord').map(c => c.args) });
  return v;
}
const emptySel = { day: false, night: false, location: '', workType: '', timeFrom: '', timeTo: '' };

test('신청 화면: 기본 근무장소가 주방보조면 주간/야간 신청이 파트타임·시간 미입력으로 나온다', () => {
  const v = loadWorkerView(KITCHEN);
  v.W("buildDateList([{ date: '2026-10-08', day: true, night: false }])");
  same(v.W("selections['2026-10-08']"), { day: true, night: false, location: '', workType: 'Part', timeFrom: '', timeTo: '' });
  same(v.W("selections['2026-10-09']"), emptySel, '신청 없는 날짜');
  assert.ok(v.W("dateControlsHtml('2026-10-08')").indexOf("toggleKitchenType('w','2026-10-08','Part')") > -1);
  assert.ok(v.W("dateControlsHtml('2026-10-09')").indexOf("toggleKitchenType('w','2026-10-09','Full')") > -1, '신청 없는 날짜도 근무형태 버튼');
});

test('신청 화면: 다른 근무지는 주간/야간 버튼 그대로', () => {
  const v = loadWorkerView(OTHER);
  v.W("buildDateList([{ date: '2026-10-08', day: true, night: true }])");
  same(v.W("selections['2026-10-08']"), { day: true, night: true, location: '', workType: '', timeFrom: '', timeTo: '' });
  const html = v.W("dateControlsHtml('2026-10-08')");
  assert.ok(html.indexOf("toggleShift('2026-10-08','day')") > -1);
  assert.strictEqual(html.indexOf('toggleKitchenType'), -1);
});

test('신청 화면: 저장된 근무형태·시간을 불러온다', () => {
  const v = loadWorkerView(KITCHEN);
  v.W("buildDateList([{ date: '2026-10-08', day: true, night: false, workType: 'Full', timeFrom: '22:00', timeTo: '02:00' }])");
  same(v.W("selections['2026-10-08']"), { day: true, night: false, location: '', workType: 'Full', timeFrom: '22:00', timeTo: '02:00' });
  assert.ok(v.W("dateControlsHtml('2026-10-08')").indexOf('<option value="22:00" selected>') > -1);
});

test('신청 화면: 하루만 주방보조로 바꾸면 그 줄만 바뀌고, 근무형태를 해제하면 주간/야간으로 돌아온다', () => {
  const v = loadWorkerView(OTHER);
  v.W("buildDateList([{ date: '2026-10-08', day: true, night: false }, { date: '2026-10-09', day: true, night: false }])");
  v.W("setDateLocation('2026-10-08', '" + KITCHEN + "')");
  same(v.W("selections['2026-10-08']"), { day: true, night: false, location: KITCHEN, workType: 'Part', timeFrom: '', timeTo: '' });
  assert.ok(v.els['ctl-2026-10-08'].innerHTML.indexOf('toggleKitchenType') > -1, '바꾼 줄은 근무형태 버튼');
  assert.ok(v.W("dateControlsHtml('2026-10-09')").indexOf('toggleShift') > -1, '다른 줄은 그대로');

  v.W("toggleKitchenType('w', '2026-10-08', 'Part')");
  same(v.W("selections['2026-10-08']"), emptySel, '신청과 날짜별 근무지가 함께 지워진다');
  assert.ok(v.els['ctl-2026-10-08'].innerHTML.indexOf('toggleShift') > -1, '주간/야간 버튼으로 복귀');
  assert.strictEqual(v.els['ctl-2026-10-08'].innerHTML.indexOf('toggleKitchenType'), -1);
  assert.strictEqual(v.els['loc-2026-10-08'].style.display, 'none', '근무지 드롭다운 숨김');
});

test('신청 화면: 주방보조 날짜를 다른 근무지로 바꾸면 주간 신청이 된다', () => {
  const v = loadWorkerView(KITCHEN);
  v.W("buildDateList([{ date: '2026-10-08', day: true, night: false, workType: 'Part', timeFrom: '10:00', timeTo: '15:00' }])");
  v.W("setDateLocation('2026-10-08', '" + OTHER + "')");
  same(v.W("selections['2026-10-08']"), { day: true, night: false, location: OTHER, workType: '', timeFrom: '', timeTo: '' });
  assert.ok(v.els['ctl-2026-10-08'].innerHTML.indexOf('shift-btn selected" id="day-2026-10-08"') > -1);
});

test('신청 화면: 기본 근무장소를 주방보조로 바꾸면 따로 지정하지 않은 날짜가 따라 바뀐다', () => {
  const v = loadWorkerView(OTHER);
  v.W("buildDateList([{ date: '2026-10-08', day: false, night: true }, { date: '2026-10-09', day: true, night: false, location: 'BGF푸드_진천' }])");
  v.state.checkedLocation = KITCHEN;
  v.W('onBaseLocationChange()');
  same(v.W("selections['2026-10-08']"), { day: true, night: false, location: '', workType: 'Part', timeFrom: '', timeTo: '' });
  same(v.W("selections['2026-10-09']"), { day: true, night: false, location: 'BGF푸드_진천', workType: '', timeFrom: '', timeTo: '' }, '따로 지정한 날짜는 그대로');
  assert.ok(v.els['ctl-2026-10-08'].innerHTML.indexOf('toggleKitchenType') > -1);
  assert.ok(v.els['ctl-2026-10-10'].innerHTML.indexOf('toggleKitchenType') > -1, '신청 없는 날짜도 다시 그린다');
  assert.ok(v.els['ctl-2026-10-09'].innerHTML.indexOf('toggleShift') > -1);
});

test('신청 화면: 관리자 지정 근무지가 주방보조면 라디오와 무관하게 주방보조 줄', () => {
  const v = loadWorkerView(OTHER);
  v.W("adminBaseLocation = '" + KITCHEN + "'");
  v.W("buildDateList([{ date: '2026-10-08', day: true, night: false }])");
  assert.strictEqual(v.W("selections['2026-10-08'].workType"), 'Part');
  assert.ok(v.W("dateControlsHtml('2026-10-09')").indexOf('toggleKitchenType') > -1);
});

test('신청 화면: 지난 주방보조 날짜는 누를 수 없다', () => {
  const v = loadWorkerView(KITCHEN);
  v.W("buildDateList([{ date: '2026-10-05', day: true, night: false, workType: 'Part', timeFrom: '10:00', timeTo: '15:00' }])");
  const html = v.W("dateControlsHtml('2026-10-05')");
  assert.strictEqual(html.indexOf('onclick'), -1);
  assert.ok(html.indexOf('<select class="kitchen-time" disabled') > -1);
});

test('신청 화면 저장: 시간이 비었거나 시작과 종료가 같으면 날짜를 알려주고 막는다', () => {
  const v = loadWorkerView(KITCHEN);
  v.W("buildDateList([{ date: '2026-10-08', day: true, night: false }])");
  v.W('submitApplication()');
  assert.strictEqual(v.saved.length, 0);
  assert.ok(v.els.resultMsg.innerHTML.indexOf('10/8(목) 주방보조 근무 시간을 선택해주세요') > -1, v.els.resultMsg.innerHTML);

  v.W("setKitchenTime('w', '2026-10-08', 'timeFrom', '10:00'); setKitchenTime('w', '2026-10-08', 'timeTo', '10:00');");
  v.W('submitApplication()');
  assert.strictEqual(v.saved.length, 0, '시작=종료');
});

test('신청 화면 저장: 주방보조 날짜는 근무형태·시간을 함께 보낸다', () => {
  const v = loadWorkerView(KITCHEN);
  v.W("buildDateList(null)");
  v.W("toggleKitchenType('w', '2026-10-08', 'Part'); setKitchenTime('w', '2026-10-08', 'timeFrom', '10:00'); setKitchenTime('w', '2026-10-08', 'timeTo', '15:00');");
  v.W("toggleKitchenType('w', '2026-10-09', 'Full'); setKitchenTime('w', '2026-10-09', 'timeFrom', '22:00'); setKitchenTime('w', '2026-10-09', 'timeTo', '02:00');");
  v.W('submitApplication()');
  assert.strictEqual(v.saved.length, 1, v.els.resultMsg.innerHTML);
  same(v.saved[0][3], [
    { date: '2026-10-08', day: true, night: false, workType: 'Part', timeFrom: '10:00', timeTo: '15:00' },
    { date: '2026-10-09', day: true, night: false, workType: 'Full', timeFrom: '22:00', timeTo: '02:00' }
  ]);
  same(v.saved[0][4], [KITCHEN]);
});

test('신청 화면 저장: 다른 근무지 날짜는 이전과 같은 값을 보낸다', () => {
  const v = loadWorkerView(OTHER);
  v.W("buildDateList([{ date: '2026-10-08', day: true, night: true }, { date: '2026-10-09', day: false, night: true, location: 'BGF푸드_진천' }])");
  v.W('submitApplication()');
  assert.strictEqual(v.saved.length, 1, v.els.resultMsg.innerHTML);
  same(v.saved[0][3], [
    { date: '2026-10-08', day: true, night: true },
    { date: '2026-10-09', day: false, night: true, location: 'BGF푸드_진천' }
  ]);
});

test('신청 화면 저장: 하루만 주방보조인 날짜는 근무지와 근무형태를 함께 보낸다', () => {
  const v = loadWorkerView(OTHER);
  v.W("buildDateList([{ date: '2026-10-08', day: true, night: false, location: '" + KITCHEN + "', workType: 'Part', timeFrom: '10:30', timeTo: '15:00' }])");
  v.W('submitApplication()');
  assert.strictEqual(v.saved.length, 1, v.els.resultMsg.innerHTML);
  same(v.saved[0][3], [{ date: '2026-10-08', day: true, night: false, location: KITCHEN, workType: 'Part', timeFrom: '10:30', timeTo: '15:00' }]);
});

test('신청 화면 저장: 지난 날짜의 시간 미입력은 저장을 막지 않는다', () => {
  const v = loadWorkerView(KITCHEN);
  v.W("buildDateList([{ date: '2026-10-05', day: true, night: false }, { date: '2026-10-08', day: true, night: false, workType: 'Part', timeFrom: '10:00', timeTo: '15:00' }])");
  v.W('submitApplication()');
  assert.strictEqual(v.saved.length, 1, v.els.resultMsg.innerHTML);
});

// ---- 관리자 창 세 곳 (근무자 추가 aa · 일정 수정 ae · 신규 신청 수정 pe) ----
function loadAdminView(checkedLocation, records, pending) {
  const v = loadView('AdminView.html', checkedLocation);
  v.W('lastRecords = ' + JSON.stringify(records || []) + '; lastPending = ' + JSON.stringify(pending || []) + ';');
  v.callsTo = (fn) => v.calls.filter(c => c.fn === fn).map(c => c.args);
  return v;
}

test('근무자 추가 창: 근무 장소가 주방보조면 날짜 줄이 근무형태 버튼', () => {
  const v = loadAdminView(KITCHEN);
  v.W("renderAdminAddLocation('" + KITCHEN + "'); buildAdminAddDateList(null);");
  assert.ok(v.els.adminAddLocationRadios.innerHTML.indexOf('onchange="refreshAdminDateList(\'aa\')"') > -1, '근무 장소를 바꾸면 날짜 줄을 다시 그려야 한다');
  assert.ok(v.W("adminDateControlsHtml('aa', '2026-10-08')").indexOf("toggleKitchenType('aa','2026-10-08','Part')") > -1);
});

test('근무자 추가 창: 다른 근무지는 주간/야간 버튼 그대로', () => {
  const v = loadAdminView(OTHER);
  v.W("renderAdminAddLocation('" + OTHER + "'); buildAdminAddDateList([{ date: '2026-10-08', day: true, night: false }]);");
  const html = v.W("adminDateControlsHtml('aa', '2026-10-08')");
  assert.ok(html.indexOf('class="shift-btn selected" id="aa_day_2026-10-08" onclick="toggleAdminAddShift(\'2026-10-08\',\'day\')"') > -1, html);
  assert.ok(html.indexOf('id="aa_night_2026-10-08" onclick="toggleAdminAddShift(\'2026-10-08\',\'night\')"') > -1, html);
  v.els.adminAddName.value = '김일반';
  v.W('stageAdminAddRecord()');
  same(v.W('adminAddPending[0].shifts'), [{ date: '2026-10-08', day: true, night: false }]);
});

test('근무자 추가 창: 날짜를 먼저 켜고 근무 장소를 주방보조로 바꾸면 시간을 채워야 추가된다', () => {
  const v = loadAdminView(OTHER);
  v.W("renderAdminAddLocation('" + OTHER + "'); buildAdminAddDateList(null); toggleAdminAddShift('2026-10-08', 'day');");
  v.state.checkedLocation = KITCHEN;
  v.W("refreshAdminDateList('aa')");
  same(v.W("adminAddSelections['2026-10-08']"), { day: true, night: false, location: '', workType: 'Part', timeFrom: '', timeTo: '' });
  assert.ok(v.els['aa_ctl_2026-10-08'].innerHTML.indexOf('toggleKitchenType') > -1);
  assert.ok(v.els['aa_ctl_2026-10-09'].innerHTML.indexOf('toggleKitchenType') > -1, '신청 없는 날짜도 다시 그린다');

  v.els.adminAddName.value = '김주방';
  v.W('stageAdminAddRecord()');
  assert.strictEqual(v.W('adminAddPending.length'), 0);
  assert.ok(v.els.adminAddMsg.innerHTML.indexOf('10/8(목) 주방보조 근무 시간을 선택해주세요') > -1, v.els.adminAddMsg.innerHTML);

  v.W("setKitchenTime('aa', '2026-10-08', 'timeFrom', '10:00'); setKitchenTime('aa', '2026-10-08', 'timeTo', '15:00');");
  v.W('stageAdminAddRecord()');
  same(v.W('adminAddPending[0].shifts'), [{ date: '2026-10-08', day: true, night: false, workType: 'Part', timeFrom: '10:00', timeTo: '15:00' }]);
  same(v.W('adminAddPending[0].locations'), [KITCHEN]);
});

test('근무자 추가 창: 기존 근무자를 불러오면 저장된 근무형태·시간과 날짜별 근무지를 따른다', () => {
  const v = loadAdminView(KITCHEN, [{
    key: 'k1', name: '김주방', pin: '900101', phone: '', gender: '남', adminLocation: '', locations: [KITCHEN],
    shifts: [
      { date: '2026-10-08', day: true, night: false, workType: 'Full', timeFrom: '09:00', timeTo: '18:00' },
      { date: '2026-10-09', day: true, night: true, location: OTHER }
    ]
  }]);
  v.W("loadAdminAddRecord('k1')");
  same(v.W("adminAddSelections['2026-10-08']"), { day: true, night: false, location: '', workType: 'Full', timeFrom: '09:00', timeTo: '18:00' });
  assert.ok(v.W("adminDateControlsHtml('aa', '2026-10-08')").indexOf('<option value="09:00" selected>') > -1);
  assert.ok(v.W("adminDateControlsHtml('aa', '2026-10-09')").indexOf('toggleAdminAddShift') > -1, '그날만 다른 근무지인 날짜는 주간/야간');

  v.els.adminAddName.value = '김주방';
  v.W('stageAdminAddRecord()');
  same(v.W('adminAddPending[0].shifts'), [
    { date: '2026-10-08', day: true, night: false, workType: 'Full', timeFrom: '09:00', timeTo: '18:00' },
    { date: '2026-10-09', day: true, night: true }
  ]);
});

test('일정 수정 창: 관리자 지정 근무지가 주방보조면 근무형태·시간을 고쳐 저장한다', () => {
  const v = loadAdminView('', [{
    key: 'k1', name: '김주방', pin: '900101', phone: '010-1111-2222', gender: '남', adminLocation: KITCHEN, locations: [OTHER],
    shifts: [{ date: '2026-10-08', day: true, night: false }, { date: '2026-10-09', day: true, night: true, location: OTHER }]
  }]);
  v.W("openAdminEditShifts('k1', '김주방')");
  same(v.W("adminEditSelections['2026-10-08']"), { day: true, night: false, location: '', workType: 'Part', timeFrom: '', timeTo: '' }, '근무형태 미입력은 파트타임·시간 미입력');
  assert.ok(v.W("adminDateControlsHtml('ae', '2026-10-08')").indexOf("toggleKitchenType('ae','2026-10-08','Full')") > -1);
  assert.ok(v.W("adminDateControlsHtml('ae', '2026-10-09')").indexOf("toggleAdminEditShift('2026-10-09','night')") > -1);

  v.W('saveAdminShiftsEdit()');
  assert.strictEqual(v.callsTo('adminUpdateShifts').length, 0);
  assert.ok(v.els.adminEditMsg.innerHTML.indexOf('10/8(목) 주방보조 근무 시간을 선택해주세요') > -1, v.els.adminEditMsg.innerHTML);

  v.W("toggleKitchenType('ae', '2026-10-08', 'Full'); setKitchenTime('ae', '2026-10-08', 'timeFrom', '09:00'); setKitchenTime('ae', '2026-10-08', 'timeTo', '18:00');");
  assert.ok(v.els['ae_ctl_2026-10-08'].innerHTML.indexOf('shift-btn selected" onclick="toggleKitchenType(\'ae\',\'2026-10-08\',\'Full\')"') > -1);
  v.W('saveAdminShiftsEdit()');
  const sent = v.callsTo('adminUpdateShifts');
  assert.strictEqual(sent.length, 1, v.els.adminEditMsg.innerHTML);
  assert.strictEqual(sent[0][0], 'k1');
  same(sent[0][1], [
    { date: '2026-10-08', day: true, night: false, workType: 'Full', timeFrom: '09:00', timeTo: '18:00' },
    { date: '2026-10-09', day: true, night: true }
  ]);
});

test('일정 수정 창: 주방보조가 아닌 근무자는 이전과 같은 값을 보낸다', () => {
  const v = loadAdminView('', [{
    key: 'k2', name: '이일반', pin: '880808', phone: '', gender: '여', adminLocation: '', locations: [OTHER],
    shifts: [{ date: '2026-10-08', day: true, night: false }, { date: '2026-10-09', day: false, night: true }]
  }]);
  v.W("openAdminEditShifts('k2', '이일반'); toggleAdminEditShift('2026-10-10', 'day');");
  v.W('saveAdminShiftsEdit()');
  same(v.callsTo('adminUpdateShifts')[0][1], [
    { date: '2026-10-08', day: true, night: false },
    { date: '2026-10-09', day: false, night: true },
    { date: '2026-10-10', day: true, night: false }
  ]);
});

test('신규 신청 수정 창: 근무 장소를 주방보조로 바꾸면 시간을 채워야 승인된다', () => {
  const v = loadAdminView('', [], [{
    key: 'p1', name: '박신규', pin: '950505', phone: '010-3333-4444', gender: '여', version: 'v1', message: '',
    locations: [OTHER], shifts: [{ date: '2026-10-08', day: true, night: false }]
  }]);
  const adminHtml = fs.readFileSync(path.join(root, 'ApplyWorkerSite', 'AdminView.html'), 'utf8');
  assert.ok(adminHtml.indexOf('<select id="pendingEditLocation" onchange="refreshAdminDateList(\'pe\')"></select>') > -1, '근무 장소를 바꾸면 날짜 줄을 다시 그려야 한다');

  v.els.pendingEditLocation.value = OTHER; // 가짜 select는 옵션의 selected를 읽지 못하므로 직접 넣는다
  v.W('openPendingEditOverlay(0)');
  assert.ok(v.W("adminDateControlsHtml('pe', '2026-10-08')").indexOf("togglePendingEditShift('2026-10-08','day')") > -1);

  v.els.pendingEditLocation.value = KITCHEN;
  v.W("refreshAdminDateList('pe')");
  same(v.W("pendingEditSelections['2026-10-08']"), { day: true, night: false, location: '', workType: 'Part', timeFrom: '', timeTo: '' });
  v.W('savePendingEditAndApprove()');
  assert.strictEqual(v.callsTo('approvePending').length, 0);
  assert.ok(v.els.pendingEditMsg.innerHTML.indexOf('10/8(목) 주방보조 근무 시간을 선택해주세요') > -1, v.els.pendingEditMsg.innerHTML);

  v.W("setKitchenTime('pe', '2026-10-08', 'timeFrom', '22:00'); setKitchenTime('pe', '2026-10-08', 'timeTo', '02:00');");
  v.W('savePendingEditAndApprove()');
  const sent = v.callsTo('approvePending');
  assert.strictEqual(sent.length, 1, v.els.pendingEditMsg.innerHTML);
  same(sent[0][1].shifts, [{ date: '2026-10-08', day: true, night: false, workType: 'Part', timeFrom: '22:00', timeTo: '02:00' }]);
  same(sent[0][1].locations, [KITCHEN]);
});

test('신규 신청 수정 창: 신청자가 넣은 임의 문자열은 화면에 나오지 않는다', () => {
  const v = loadAdminView('', [], [{
    key: 'p2', name: '최신규', pin: '970707', phone: '010', gender: '남', version: 'v1', message: '',
    locations: [KITCHEN], shifts: [{ date: '2026-10-08', day: true, night: false, workType: '<img src=x onerror=alert(1)>', timeFrom: '"><script>', timeTo: '15:00' }]
  }]);
  v.els.pendingEditLocation.value = KITCHEN;
  v.W('openPendingEditOverlay(0)');
  same(v.W("pendingEditSelections['2026-10-08']"), { day: true, night: false, location: '', workType: 'Part', timeFrom: '', timeTo: '' });
  const html = v.W("adminDateControlsHtml('pe', '2026-10-08')");
  assert.strictEqual(html.indexOf('<img'), -1);
  assert.strictEqual(html.indexOf('<script'), -1);
});

// ---- 관리자 화면 표시 (주간 표 · 신규 신청 요약 · 배치 문자) ----
const kitchenWorker = {
  key: 'k1', name: '김주방', pin: '900101', phone: '', gender: '남', adminLocation: '', locations: [KITCHEN], sortOrder: 0,
  shifts: [
    { date: '2026-10-08', day: true, night: false, workType: 'Part', timeFrom: '10:00', timeTo: '15:00' },
    { date: '2026-10-09', day: true, night: false }
  ]
};
// 다른 근무지인데 예전 주방보조 값이 남아 있는 근무자: 표기가 붙으면 안 된다.
const otherWorker = {
  key: 'k2', name: '이일반', pin: '880808', phone: '', gender: '남', adminLocation: '', locations: [OTHER], sortOrder: 1,
  shifts: [{ date: '2026-10-08', day: true, night: true, workType: 'Part', timeFrom: '10:00', timeTo: '15:00' }]
};
const cellOf = (html, cellId) => {
  const start = html.indexOf('id="' + cellId + '"');
  assert.ok(start > -1, cellId + ' 칸이 없다');
  return html.slice(start, html.indexOf('</td>', start));
};
const WEEK_TABLE = (shift, label) => "buildWorkerWeekShiftTable(getTwoWeekDates().slice(0, 7), '" + shift + "', '" + label + "', lastRecords, '전체 근무지', true, [])";

test('주간 표: 주방보조 날짜 칸에 근무형태·시간을 적는다', () => {
  const v = loadAdminView('', [kitchenWorker, otherWorker]);
  const html = v.W(WEEK_TABLE('day', '주간'));
  assert.ok(cellOf(html, 'dcell_day_2026-10-08_k1').indexOf('목<div class="kitchen-label">파트 10~15</div>') > -1, cellOf(html, 'dcell_day_2026-10-08_k1'));
  assert.strictEqual(cellOf(html, 'dcell_day_2026-10-09_k1').indexOf('kitchen-label'), -1, '근무형태 미입력 날짜');
  assert.strictEqual(cellOf(html, 'dcell_day_2026-10-08_k2').indexOf('kitchen-label'), -1, '다른 근무지');
  assert.strictEqual(html.split('kitchen-label').length - 1, 1);
});

test('주간 표: 야간 표에는 적지 않는다', () => {
  const v = loadAdminView('', [kitchenWorker, otherWorker]);
  assert.strictEqual(v.W(WEEK_TABLE('night', '야간')).indexOf('kitchen-label'), -1);
});

test('주간 표: 배치정보 수정 모드가 칸을 다시 그려도 표기가 남는다', () => {
  const v = loadAdminView('', [kitchenWorker]);
  const cell = v.els['dcell_day_2026-10-08_k1'];
  cell.dataset.wchar = '목';
  v.W("applyInfoCellPendingStyle('2026-10-08', 'day', 'k1')");
  assert.strictEqual(cell.innerHTML, '목<div class="kitchen-label">파트 10~15</div>');

  v.W("pendingInfoChanges = { k1: { '2026-10-08': { day: { floor: '1층', transport: '' } } } }; applyInfoCellPendingStyle('2026-10-08', 'day', 'k1');");
  assert.strictEqual(cell.innerHTML, '<span class="mark-circle">목</span><div class="kitchen-label">파트 10~15</div>');
});

test('신규 신청 요약: 주방보조 날짜는 근무형태·시간으로 적는다', () => {
  const v = loadAdminView('');
  const summary = (p) => v.W('pendingShiftSummary_(' + JSON.stringify(p) + ')');
  assert.strictEqual(summary({ locations: [KITCHEN], shifts: [
    { date: '2026-10-09', day: true, night: false },
    { date: '2026-10-08', day: true, night: false, workType: 'Part', timeFrom: '10:00', timeTo: '15:00' }
  ] }), '10/8(목) 파트 10~15, 10/9(금) 주간', '근무형태 미입력은 주간/야간으로');
  assert.strictEqual(summary({ locations: [OTHER], shifts: [
    { date: '2026-10-08', day: true, night: false, location: KITCHEN, workType: 'Full', timeFrom: '22:00', timeTo: '02:00' },
    { date: '2026-10-09', day: true, night: true, workType: 'Part', timeFrom: '10:00', timeTo: '15:00' }
  ] }), '10/8(목) 풀 22~2 ' + KITCHEN + ', 10/9(금) 주간·야간', '다른 근무지에 남은 값은 무시');
});

const kitchenAssign = { date: '2026-10-08', shift: 'day', key: 'k1', name: '김주방', gender: '남', floor: '1층', transport: '', location: KITCHEN };
const REC_BY_KEY = '{ k1: lastRecords[0] }';

test('배치 문자: 주방보조 주간 배치의 이름 줄 끝에 근무형태·시간을 붙인다', () => {
  const v = loadAdminView('', [kitchenWorker]);
  const text = (a, recByKey) => v.W("buildShiftText('2026-10-08', '주간', 1, 0, [" + JSON.stringify(a) + "], [], { k1: '900101' }, false" + (recByKey ? ', ' + recByKey : '') + ')');
  assert.ok(text(kitchenAssign, REC_BY_KEY).indexOf('남1.김주방_1층 (파트 10~15)') > -1, text(kitchenAssign, REC_BY_KEY));
  assert.strictEqual(text(Object.assign({}, kitchenAssign, { shift: 'night' }), REC_BY_KEY).indexOf('파트'), -1, '야간 배치');
  assert.strictEqual(text(Object.assign({}, kitchenAssign, { location: OTHER }), REC_BY_KEY).indexOf('파트'), -1, '다른 근무지로 배치된 기록');
  assert.strictEqual(text(Object.assign({}, kitchenAssign, { date: '2026-10-09' }), REC_BY_KEY).indexOf('_1층 ('), -1, '근무형태 미입력 날짜');
  assert.strictEqual(text(Object.assign({}, kitchenAssign, { key: 'gone' }), REC_BY_KEY).indexOf('파트'), -1, '레코드가 없는 배치');
});

test('배치판: 목록과 복사 텍스트에 근무형태·시간이 붙는다', () => {
  const v = loadAdminView('', [kitchenWorker]);
  const html = v.W("buildShiftBlock('2026-10-08', 'day', [], [" + JSON.stringify(kitchenAssign) + "], null, null, " + REC_BY_KEY + ", { k1: '900101' }, {})");
  assert.ok(html.indexOf('남1.김주방 900101_1층 (파트 10~15)') > -1, '배치판 목록');
  assert.ok(v.W("shiftTextCache['text_2026-10-08_day'].withoutBirth").indexOf('남1.김주방_1층 (파트 10~15)') > -1, '복사 텍스트');
  assert.ok(v.W("shiftTextCache['text_2026-10-08_day'].withBirth").indexOf('남1.김주방 900101_1층 (파트 10~15)') > -1, '생년월일 포함 복사 텍스트');
});

console.log('\n' + passed + '개 통과');
