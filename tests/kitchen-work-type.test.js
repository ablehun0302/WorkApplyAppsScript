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

console.log('\n' + passed + '개 통과');
