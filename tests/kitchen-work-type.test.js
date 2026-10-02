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

// ---- 근무자 신청 화면 (가짜 DOM) ----
// 요소는 id로 찾을 때 만들어지고 innerHTML·value 같은 값만 기억한다. 오늘은 2026-10-07(수)로 고정해
// 2주 범위가 10/5(월)~10/18(일), 지난 날짜가 10/5·10/6이 되게 한다.
const KITCHEN = '주방보조_전국';
const OTHER = '신세계푸드 원남';
function loadWorkerView(checkedLocation) {
  const els = {};
  const el = (id) => els[id] || (els[id] = {
    id, innerHTML: '', value: '', textContent: '', style: {}, options: [], disabled: false, checked: false,
    classList: { toggle() {}, add() {}, remove() {} },
    appendChild(child) { this.options.push(child); }
  });
  const saved = [];
  const run = { withSuccessHandler() { return run; }, withFailureHandler() { return run; }, saveRecord(...args) { saved.push(args); } };
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
      querySelector: (q) => q.indexOf('workLocation') > -1 ? (state.checkedLocation ? { value: state.checkedLocation } : null) : { value: '남' }
    },
    window: { addEventListener() {}, scrollTo() {} },
    sessionStorage: { getItem() { return null; }, setItem() {} },
    google: { script: { run } }
  });
  vm.runInContext(sharedHtml.match(/<script>([\s\S]*)<\/script>/)[1], ctx);
  const workerHtml = fs.readFileSync(path.join(root, 'ApplyWorkerSite', 'WorkerView.html'), 'utf8');
  (workerHtml.match(/<script>[\s\S]*?<\/script>/g) || []).forEach((block) => {
    vm.runInContext(block.replace(/^<script>/, '').replace(/<\/script>$/, ''), ctx);
  });
  vm.runInContext("currentName = '홍길동'; currentPin = '900101';", ctx);
  return { els, saved, state, W: (expr) => vm.runInContext(expr, ctx) };
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

console.log('\n' + passed + '개 통과');
