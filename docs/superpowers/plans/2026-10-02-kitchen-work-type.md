# 주방보조 근무형태·시간대 신청 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 근무지가 `주방보조_전국`인 날짜는 주간/야간 대신 근무형태(파트타임/풀타임)와 가능한 시간대를 날짜마다 신청받고, 관리자가 그 값을 주간 표·배치 문자에서 보고 근무자 추가·수정·신규 승인 창에서 고칠 수 있게 한다.

**Architecture:** 주방보조 날짜는 기존 주간 칸(`day: true`)을 켠 채로 저장하고 `workType`·`timeFrom`·`timeTo`만 `shiftsJSON`의 날짜 항목에 덧붙인다. 그래서 주간 표·목표 인원·배치·이력은 수정 없이 동작한다. 표기·전환·검사·줄 그리기는 `SharedScript.html`에 한 번만 두고 신청 화면과 관리자 창 세 곳이 같이 쓴다. 관리자 화면이 `{date, day, night}`만 보내는 경로는 서버 병합 함수가 기존 값을 되살린다.

**Tech Stack:** Google Apps Script(`.gs`), GAS HTML Service 템플릿(`.html` 안의 인라인 JS), Google Sheets. 빌드 도구·패키지 매니저 없음. 화면과 무관한 함수만 Node 내장 모듈(`vm`, `assert`)로 검증한다.

**Spec:** `docs/superpowers/specs/2026-10-02-kitchen-work-type-design.md`

## Global Constraints

- 저장 값: `workType`은 `"Part"` | `"Full"`. `timeFrom`은 `"HH:MM"` 00:00~23:30, `timeTo`는 `"HH:MM"` 00:30~24:00, 둘 다 30분 단위.
- 주방보조 날짜는 항상 `day: true, night: false`. 세 필드는 그 날짜의 근무지가 `주방보조_전국`일 때만 의미가 있다.
- `timeFrom`과 `timeTo`는 달라야 한다. `timeTo`가 더 이르면 자정을 넘기는 시간대로 보고 허용한다. 풀타임도 시간이 필수다.
- 화면 표기는 파트타임/풀타임, 짧은 표기는 `파트 10~15`·`풀 22~2` 형식이다.
- 관리자 화면에 근무형태·시간을 출력할 때는 반드시 `kitchenShiftLabel()`의 결과만 쓴다. 신청 저장은 로그인 없이 호출되므로 저장된 `workType`·시간 문자열을 HTML에 직접 넣지 않는다.
- 시트 열 추가·기존 데이터 변환 없음. 야간 표, 목표 인원, 배치판 구조, 근무 통계 달력은 바꾸지 않는다.
- 주석은 한국어로 "왜"를 적고, 기존 코드의 주석 밀도와 어조를 따른다. 요청과 무관한 주변 코드는 고치지 않는다.
- 테스트 실행: 저장소 루트에서 `node tests/kitchen-work-type.test.js`. 이 PC의 Git Bash에는 `node`가 PATH에 없으므로 `"/c/Program Files/nodejs/node.exe" tests/kitchen-work-type.test.js`로 실행한다.
- 화면 동작은 자동 테스트가 없다. 각 태스크의 문법 검사(테스트 스크립트)까지 확인하고, 화면 점검은 맨 끝 "배포 후 점검"에서 한 번에 한다.
- 커밋 메시지는 한국어 한 줄 요약이고, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`를 붙인다.

## Review Focus

- **하루만 주방보조로 바꾼 날짜의 근무형태 해제** — 기본 근무장소가 다른 사람이 한 날짜만 주방보조로 바꾼 뒤 근무형태를 다시 눌러 취소하면, 날짜별 근무지 지정이 지워지면서 그 줄이 주간/야간 버튼으로 돌아와야 한다. 버튼 영역을 근무지 정리보다 먼저 그리면 주방보조 모양이 남는다. Task 3에서 그리는 순서를 고정하고 점검 3번으로 확인한다.
- **지난 날짜에 남은 근무형태 미입력 주방보조 신청** — 이미 주간/야간으로 신청해 둔 주방보조 근무자는 지난 날짜를 고칠 수 없다. 그 날짜 때문에 저장이 막히면 아무것도 신청할 수 없게 된다. Task 3에서 오늘 이후 날짜만 검사하고 점검 5번으로 확인한다.
- **관리자 지정 근무지가 주방보조인 근무자** — 근무자가 고른 라디오가 다른 곳이어도 관리자 지정(H열)이 우선하므로 모든 날짜가 주방보조 줄로 나와야 한다. Task 3에서 `currentBaseLocation()`으로만 판정하고 점검 6번으로 확인한다.
- **날짜를 먼저 고르고 근무 장소를 나중에 주방보조로 바꾸는 관리자** — 근무자 추가 창과 신규 승인 수정 창에서 이미 주간/야간으로 켠 날짜가 파트타임·시간 미입력으로 바뀌고, 시간을 채우기 전에는 저장이 막혀야 한다. Task 4에서 근무지 변경 시 전환을 적용하고 점검 9번으로 확인한다.
- **배치정보 수정 모드에서 칸을 눌렀다 되돌릴 때** — 칸 내용을 다시 그리는 코드가 따로 있어, 거기서 빠뜨리면 `파트 10~15` 표기가 사라진다. Task 5에서 그 경로에도 표기를 붙이고 점검 12번으로 확인한다.

---

### Task 1: 공용 함수·스타일과 테스트 스크립트

**Files:**
- Create: `tests/kitchen-work-type.test.js`
- Modify: `ApplyWorkerSite/SharedScript.html:44` (마지막 `</script>` 앞에 추가)
- Modify: `ApplyWorkerSite/SharedStyles.html:24` (`.shift-btn.disabled.selected` 줄 뒤), `:93` (`.mark-label` 줄 뒤)

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces (`SharedScript.html`, 모든 화면에서 전역으로 사용):
  - `KITCHEN_LOCATION: string` = `'주방보조_전국'`
  - `WORK_TYPES: { Part: '파트타임', Full: '풀타임' }`
  - `kitchenShiftLabel(shift) -> string` — `"파트 10~15"`, 근무형태를 모르면 `''`
  - `applyKitchenMode(sel, isKitchen) -> sel` — `sel`을 직접 고친다
  - `kitchenTimeError(sel) -> boolean`
  - `kitchenControlsHtml(scope, key, sel, disabled) -> string`
  - `KITCHEN_SCOPES: { [scope]: { get(key) -> sel, redraw(key) } }` — 화면이 자기 scope를 등록한다
  - `toggleKitchenType(scope, key, type)`, `setKitchenTime(scope, key, field, value)` — `kitchenControlsHtml`이 만든 HTML의 이벤트 핸들러
  - 선택 상태 `sel`의 모양: `{ day, night, location, workType, timeFrom, timeTo }` (`workType`은 `'Part'`|`'Full'`|`''`, 시간은 `'HH:MM'`|`''`)
- Produces (`SharedStyles.html`): `.shift-ctl`, `.kitchen-times`, `.kitchen-time`, `.kitchen-label`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/kitchen-work-type.test.js`를 새로 만든다.

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `"/c/Program Files/nodejs/node.exe" tests/kitchen-work-type.test.js`
Expected: `ok - 화면 파일의 인라인 스크립트 문법` 한 줄이 나온 뒤 `ReferenceError: KITCHEN_LOCATION is not defined`로 종료.

- [ ] **Step 3: 공용 함수 구현**

`ApplyWorkerSite/SharedScript.html`의 마지막 줄 `</script>` 바로 앞(`restoreScrollImmediate` 함수 뒤)에 추가한다.

```js

// ---- 주방보조 근무형태·시간대 ----
// 주방보조는 주간/야간 대신 근무형태(파트타임/풀타임)와 가능한 시간대를 날짜마다 받는다.
// 저장은 기존 주간 칸(day)을 켠 채로 하고 workType·timeFrom·timeTo만 덧붙인다.
const KITCHEN_LOCATION = '주방보조_전국';
const WORK_TYPES = { Part: '파트타임', Full: '풀타임' };
const WORK_TYPE_SHORT = { Part: '파트', Full: '풀' };

function isWorkType_(v) {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(WORK_TYPES, v);
}
// 시작은 00:00~23:30, 종료는 00:30~24:00 (30분 단위)
function kitchenTimes_(field) {
  const list = [];
  for (let m = 0; m <= 24 * 60; m += 30) list.push(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));
  return field === 'timeFrom' ? list.slice(0, -1) : list.slice(1);
}
function kitchenTimeShort_(field, t) {
  if (kitchenTimes_(field).indexOf(t) === -1) return '';
  const h = String(parseInt(t.slice(0, 2), 10));
  return t.slice(3) === '00' ? h : h + ':' + t.slice(3);
}
// "파트 10~15" 형태의 짧은 표기. 신청 저장은 로그인 없이 호출돼 임의 문자열이 들어올 수 있으므로
// 아는 근무형태와 목록에 있는 시간만 출력한다 — 관리자 화면은 이 결과를 그대로 HTML에 넣는다.
function kitchenShiftLabel(s) {
  if (!s || !isWorkType_(s.workType)) return '';
  const from = kitchenTimeShort_('timeFrom', s.timeFrom), to = kitchenTimeShort_('timeTo', s.timeTo);
  return WORK_TYPE_SHORT[s.workType] + (from && to ? ' ' + from + '~' + to : '');
}
// 한 날짜의 선택 상태(sel)를 그 날짜 근무지에 맞춘다. 주방보조가 되면 주간/야간 신청을 근무형태
// 신청으로, 주방보조가 아니게 되면 근무형태 신청을 주간 신청으로 바꾼다. sel을 직접 고친다.
function applyKitchenMode(sel, isKitchen) {
  if (isKitchen && (sel.day || sel.night)) {
    if (!isWorkType_(sel.workType)) { sel.workType = 'Part'; sel.timeFrom = ''; sel.timeTo = ''; }
    if (kitchenTimes_('timeFrom').indexOf(sel.timeFrom) === -1) sel.timeFrom = '';
    if (kitchenTimes_('timeTo').indexOf(sel.timeTo) === -1) sel.timeTo = '';
    sel.day = true; sel.night = false;
  } else {
    sel.workType = ''; sel.timeFrom = ''; sel.timeTo = '';
  }
  return sel;
}
// 신청된 주방보조 날짜인데 시간이 비었거나 시작과 종료가 같으면 true. 종료가 시작보다 이른 것은
// 자정을 넘기는 시간대(22:00~02:00)라 허용한다.
function kitchenTimeError(sel) {
  return !!sel.workType && (!sel.timeFrom || !sel.timeTo || sel.timeFrom === sel.timeTo);
}
// 주방보조 날짜 줄의 근무형태 버튼과 시간 선택. 신청 화면과 관리자 창 세 곳이 함께 쓴다.
// scope는 KITCHEN_SCOPES의 키로, 버튼을 눌렀을 때 어느 화면의 선택 상태를 고칠지 가리킨다.
function kitchenControlsHtml(scope, key, sel, disabled) {
  const btn = (type) => {
    const cls = 'shift-btn' + (sel.workType === type ? ' selected' : '') + (disabled ? ' disabled' : '');
    const onclick = disabled ? '' : ` onclick="toggleKitchenType('${scope}','${key}','${type}')"`;
    return `<div class="${cls}"${onclick}>${WORK_TYPES[type]}</div>`;
  };
  const timeSel = (field, placeholder) => {
    const opts = kitchenTimes_(field).map(t => `<option value="${t}"${sel[field] === t ? ' selected' : ''}>${t}</option>`).join('');
    return `<select class="kitchen-time"${disabled ? ' disabled' : ''} onchange="setKitchenTime('${scope}','${key}','${field}',this.value)"><option value="">${placeholder}</option>${opts}</select>`;
  };
  let html = `<div class="shift-btns">${btn('Part')}${btn('Full')}</div>`;
  if (sel.workType) html += `<div class="kitchen-times">${timeSel('timeFrom', '시작')} ~ ${timeSel('timeTo', '종료')}</div>`;
  return html;
}
// 화면별 { get(key) -> 그 날짜의 선택 상태, redraw(key) -> 그 날짜 줄 다시 그리기 }
const KITCHEN_SCOPES = {};
// 선택된 근무형태를 다시 누르면 그 날짜 신청을 취소한다.
function toggleKitchenType(scope, key, type) {
  const sel = KITCHEN_SCOPES[scope].get(key);
  if (sel.workType === type) {
    sel.workType = ''; sel.timeFrom = ''; sel.timeTo = ''; sel.day = false; sel.night = false;
  } else {
    sel.workType = type; sel.day = true; sel.night = false;
  }
  KITCHEN_SCOPES[scope].redraw(key);
}
function setKitchenTime(scope, key, field, value) {
  KITCHEN_SCOPES[scope].get(key)[field] = value;
}
```

- [ ] **Step 4: 스타일 추가**

`ApplyWorkerSite/SharedStyles.html`에서 `.shift-btn.disabled.selected { ... }` 줄(24행) 바로 뒤에 추가한다.

```css
  /* 날짜 줄의 버튼 영역. display:contents로 감싸야 주방보조 시간 선택이 .date-row의 다음 줄로 내려간다. */
  .shift-ctl { display: contents; }
  .kitchen-times { flex-basis: 100%; display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin-top: 6px; font-size: 13px; }
  .kitchen-time { width: auto; padding: 6px 8px; border: 1px solid #ddd; border-radius: 8px; font-size: 13px; font-family: inherit; background: white; }
  .kitchen-time:disabled { background: #f5f5f5; color: #aaa; }
```

같은 파일의 `.mark-label { ... }` 줄 바로 뒤에 추가한다.

```css
  .kitchen-label { color: #0f766e; font-size: 9px; font-weight: 700; margin-top: 1px; }
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `"/c/Program Files/nodejs/node.exe" tests/kitchen-work-type.test.js`
Expected: `ok - ...` 15줄과 `15개 통과`.

- [ ] **Step 6: 커밋**

```bash
git add tests/kitchen-work-type.test.js ApplyWorkerSite/SharedScript.html ApplyWorkerSite/SharedStyles.html
git commit -m "주방보조 근무형태·시간대 공용 함수와 테스트 추가

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 서버 — 관리자 수정 시 근무형태·시간 보존

**Files:**
- Modify: `WorkSystemSheet.gs:693-705` (`mergeShiftLocations_` → `mergeShiftExtras_`)
- Modify: `WorkSystemSheet.gs:419` (`batchSaveRecords`), `:546-547` (`approvePending`), `:715` (`adminUpdateShifts`)
- Test: `tests/kitchen-work-type.test.js`

**Interfaces:**
- Consumes: 없음
- Produces: `mergeShiftExtras_(oldShifts, newShifts) -> shifts[]` — 새 값에 `location`이 없으면 같은 날짜의 기존 `location`을, `workType`이 없으면 기존 `workType`·`timeFrom`·`timeTo`를 되살린다. 관리자 화면(Task 4)은 주방보조 날짜에 `workType`을 실어 보내고, 그 밖의 경로는 `{date, day, night}`만 보낸다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/kitchen-work-type.test.js`에서 `const S = ...` 줄 바로 뒤에 추가한다.

```js

const server = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'WorkSystemSheet.gs'), 'utf8'), server);
```

같은 파일의 마지막 줄 `console.log('\n' + passed + '개 통과');` 바로 앞에 추가한다.

```js
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

```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `"/c/Program Files/nodejs/node.exe" tests/kitchen-work-type.test.js`
Expected: Task 1의 15줄이 `ok`로 나온 뒤 `TypeError: merge is not a function`으로 종료.

- [ ] **Step 3: 병합 함수 교체**

`WorkSystemSheet.gs:693-705`의 다음 블록을 통째로 바꾼다.

기존:

```js
// 관리자 화면들은 날짜별 근무지를 다루지 않고 shifts를 {date, day, night}로만 다시 만들어 덮어쓴다.
// 그대로 저장하면 근무자가 지정해둔 날짜별 location이 지워지므로, 같은 날짜의 기존 값을 되살려준다.
function mergeShiftLocations_(oldShifts, newShifts) {
  const locByDate = {};
  (oldShifts || []).forEach(function (s) {
    if (s.location) locByDate[s.date] = s.location;
  });
  return (newShifts || []).map(function (s) {
    if (s.location || !locByDate[s.date]) return s;
    return Object.assign({}, s, { location: locByDate[s.date] });
  });
}
```

변경:

```js
// 관리자 화면들은 날짜별 근무지를 다루지 않고, 주방보조가 아닌 날짜는 shifts를 {date, day, night}로만
// 다시 만들어 덮어쓴다. 그대로 저장하면 근무자가 지정해둔 날짜별 location과 주방보조 근무형태·시간
// (workType, timeFrom, timeTo)이 지워지므로, 새 값에 없는 것은 같은 날짜의 기존 값을 되살려준다.
function mergeShiftExtras_(oldShifts, newShifts) {
  const oldByDate = {};
  (oldShifts || []).forEach(function (s) { oldByDate[s.date] = s; });
  return (newShifts || []).map(function (s) {
    const old = oldByDate[s.date];
    if (!old) return s;
    const merged = Object.assign({}, s);
    if (!merged.location && old.location) merged.location = old.location;
    if (!merged.workType && old.workType) {
      merged.workType = old.workType;
      merged.timeFrom = old.timeFrom;
      merged.timeTo = old.timeTo;
    }
    return merged;
  });
}
```

- [ ] **Step 4: 호출부 세 곳의 이름 변경**

`WorkSystemSheet.gs:419` (`batchSaveRecords`):

```js
        JSON.stringify(mergeShiftExtras_(existingShifts, item.shifts || [])), JSON.stringify(item.locations || []),
```

`WorkSystemSheet.gs:546-547` (`approvePending`) — 주석도 실제 동작에 맞춘다:

```js
      // 관리자 화면은 날짜별 근무지를 보내지 않으므로 근무자가 고른 값을 되살린다.
      shifts = mergeShiftExtras_(shifts, edits.shifts || []);
```

`WorkSystemSheet.gs:715` (`adminUpdateShifts`):

```js
  sheet.getRange(row, 6).setValue(JSON.stringify(mergeShiftExtras_(oldShifts, shifts)));
```

확인: `grep -n "mergeShiftLocations_" WorkSystemSheet.gs ApplyWorkerSite/*` 결과가 없어야 한다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `"/c/Program Files/nodejs/node.exe" tests/kitchen-work-type.test.js`
Expected: `18개 통과`.

- [ ] **Step 6: 커밋**

```bash
git add WorkSystemSheet.gs tests/kitchen-work-type.test.js
git commit -m "관리자 수정 시 주방보조 근무형태·시간이 지워지지 않게 보존

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 근무자 신청 화면

**Files:**
- Modify: `ApplyWorkerSite/WorkerView.html:85-92` (`onBaseLocationChange`)
- Modify: `ApplyWorkerSite/WorkerView.html:119-160` (`buildDateList`과 그 앞)
- Modify: `ApplyWorkerSite/WorkerView.html:181-184` (`setDateLocation`)
- Modify: `ApplyWorkerSite/WorkerView.html:246-256` (`submitApplication`)

**Interfaces:**
- Consumes (Task 1): `KITCHEN_LOCATION`, `applyKitchenMode(sel, isKitchen)`, `kitchenTimeError(sel)`, `kitchenControlsHtml(scope, key, sel, disabled)`, `KITCHEN_SCOPES`
- Produces: scope `'w'` 등록. 서버로 보내는 주방보조 날짜 항목 `{date, day: true, night: false, workType, timeFrom, timeTo, location?}`

- [ ] **Step 1: 날짜 줄 그리기를 근무지에 따라 나누기**

`ApplyWorkerSite/WorkerView.html:119`의 `// ---------- 근로자 신청 화면 ----------` 줄 바로 뒤, `function buildDateList(prefill) {` 앞에 추가한다.

```js
// 그 날짜의 근무지가 주방보조인지. 날짜별로 따로 고른 근무지가 기본 근무장소보다 우선한다.
function isKitchenDate(key) {
  return (selections[key].location || currentBaseLocation()) === KITCHEN_LOCATION;
}
// 날짜 줄의 버튼 영역. 주방보조 날짜는 주간/야간 대신 근무형태와 시간대를 고른다.
function dateControlsHtml(key) {
  const sel = selections[key];
  const isPast = key < formatDate(new Date());
  if (isKitchenDate(key)) return kitchenControlsHtml('w', key, sel, isPast);
  const dayBtnClass = 'shift-btn' + (sel.day?' selected':'') + (isPast?' disabled':'');
  const nightBtnClass = 'shift-btn' + (sel.night?' selected':'') + (isPast?' disabled':'');
  const dayOnclick = isPast ? '' : ` onclick="toggleShift('${key}','day')"`;
  const nightOnclick = isPast ? '' : ` onclick="toggleShift('${key}','night')"`;
  return `<div class="shift-btns">
        <div class="${dayBtnClass}" id="day-${key}"${dayOnclick}>주간</div>
        <div class="${nightBtnClass}" id="night-${key}"${nightOnclick}>야간</div>
      </div>`;
}
// 신청 여부나 근무지가 바뀐 날짜 줄을 다시 그린다. 신청이 모두 해제되면 syncDateLocationVisibility가
// 날짜별 근무지 지정을 지우므로, 그 결과(주방보조 여부)가 반영되도록 버튼 영역을 나중에 그린다.
function redrawDateControls(key) {
  syncDateLocationVisibility(key);
  document.getElementById('ctl-' + key).innerHTML = dateControlsHtml(key);
}
KITCHEN_SCOPES.w = { get: key => selections[key], redraw: redrawDateControls };
```

- [ ] **Step 2: `buildDateList`가 새 필드를 불러오고 버튼 영역을 감싸게 수정**

`buildDateList` 안의 다음 블록을 바꾼다.

기존:

```js
    selections[key] = { day: false, night: false, location: '' };
    if (prefill) {
      const found = prefill.find(s => s.date === key);
      if (found) { selections[key].day = !!found.day; selections[key].night = !!found.night; selections[key].location = found.location || ''; }
    }
    const row = document.createElement('div');
    row.className = 'date-row';
    const isWeekend = (d.getDay()===0 || d.getDay()===6);
    const isPast = key < todayKey;
    const dayBtnClass = 'shift-btn' + (selections[key].day?' selected':'') + (isPast?' disabled':'');
    const nightBtnClass = 'shift-btn' + (selections[key].night?' selected':'') + (isPast?' disabled':'');
    const dayOnclick = isPast ? '' : ` onclick="toggleShift('${key}','day')"`;
    const nightOnclick = isPast ? '' : ` onclick="toggleShift('${key}','night')"`;
    const hasShift = selections[key].day || selections[key].night;
    const locOptions = LOCATIONS.map(l => `<option value="${l}">${l}</option>`).join('');
    row.innerHTML = `
      <div class="${isWeekend?'weekend':''}">${d.getMonth()+1}/${d.getDate()} (${dow})</div>
      <select class="date-loc" id="loc-${key}" ${isPast?'disabled':''} onchange="setDateLocation('${key}', this.value)" style="display:${hasShift?'':'none'};">${locOptions}</select>
      <div class="shift-btns">
        <div class="${dayBtnClass}" id="day-${key}"${dayOnclick}>주간</div>
        <div class="${nightBtnClass}" id="night-${key}"${nightOnclick}>야간</div>
      </div>`;
```

변경:

```js
    selections[key] = { day: false, night: false, location: '', workType: '', timeFrom: '', timeTo: '' };
    if (prefill) {
      const found = prefill.find(s => s.date === key);
      if (found) { selections[key].day = !!found.day; selections[key].night = !!found.night; selections[key].location = found.location || ''; selections[key].workType = found.workType || ''; selections[key].timeFrom = found.timeFrom || ''; selections[key].timeTo = found.timeTo || ''; }
    }
    // 주간/야간으로 저장돼 있던 주방보조 날짜는 파트타임·시간 미입력 상태로 불러온다.
    applyKitchenMode(selections[key], isKitchenDate(key));
    const row = document.createElement('div');
    row.className = 'date-row';
    const isWeekend = (d.getDay()===0 || d.getDay()===6);
    const isPast = key < todayKey;
    const hasShift = selections[key].day || selections[key].night;
    const locOptions = LOCATIONS.map(l => `<option value="${l}">${l}</option>`).join('');
    row.innerHTML = `
      <div class="${isWeekend?'weekend':''}">${d.getMonth()+1}/${d.getDate()} (${dow})</div>
      <select class="date-loc" id="loc-${key}" ${isPast?'disabled':''} onchange="setDateLocation('${key}', this.value)" style="display:${hasShift?'':'none'};">${locOptions}</select>
      <div class="shift-ctl" id="ctl-${key}">${dateControlsHtml(key)}</div>`;
```

`toggleShift`와 `syncDateLocationVisibility`는 고치지 않는다. 주방보조 줄은 근무형태가 선택되면 `day`가 켜지므로 `syncDateLocationVisibility`의 `day || night` 판정이 그대로 맞는다.

- [ ] **Step 3: 근무지가 바뀌면 줄을 전환**

`setDateLocation`(181-184행)을 바꾼다.

기존:

```js
function setDateLocation(key, value) {
  selections[key].location = (value === currentBaseLocation()) ? '' : value;
}
```

변경:

```js
function setDateLocation(key, value) {
  selections[key].location = (value === currentBaseLocation()) ? '' : value;
  applyKitchenMode(selections[key], isKitchenDate(key));
  redrawDateControls(key);
}
```

`onBaseLocationChange`(85-92행)를 바꾼다.

기존:

```js
function onBaseLocationChange() {
  const base = currentBaseLocation();
  Object.keys(selections).forEach(key => {
    if (selections[key].location) return;
    const sel = document.getElementById('loc-' + key);
    if (sel) setSelectValue(sel, base);
  });
}
```

변경:

```js
function onBaseLocationChange() {
  const base = currentBaseLocation();
  Object.keys(selections).forEach(key => {
    if (!selections[key].location) {
      const sel = document.getElementById('loc-' + key);
      if (sel) setSelectValue(sel, base);
    }
    // 기본 근무장소가 주방보조로(또는 주방보조에서) 바뀌면 그 값을 따르는 날짜 줄의 모양도 바뀐다.
    applyKitchenMode(selections[key], isKitchenDate(key));
    redrawDateControls(key);
  });
}
```

- [ ] **Step 4: 저장 값과 저장 전 검사**

`submitApplication`의 다음 블록을 바꾼다.

기존:

```js
  const chosen = Object.entries(selections).filter(([k,v]) => v.day || v.night).map(([k,v]) => {
    const item = { date: k, day: v.day, night: v.night };
    // 기본 근무장소와 같으면 저장하지 않는다. 그래야 나중에 기본 근무장소가 바뀔 때 따라간다.
    if (v.location && v.location !== base) item.location = v.location;
    return item;
  });
  if (chosen.length === 0) {
    resultMsg.innerHTML = '<div class="msg err">최소 하나의 날짜/시간대를 선택해주세요.</div>';
    return;
  }
```

변경:

```js
  const chosen = Object.entries(selections).filter(([k,v]) => v.day || v.night).map(([k,v]) => {
    const item = { date: k, day: v.day, night: v.night };
    // 기본 근무장소와 같으면 저장하지 않는다. 그래야 나중에 기본 근무장소가 바뀔 때 따라간다.
    if (v.location && v.location !== base) item.location = v.location;
    // workType은 주방보조 날짜에만 남아 있다(applyKitchenMode가 다른 근무지에서는 비운다).
    if (v.workType) { item.workType = v.workType; item.timeFrom = v.timeFrom; item.timeTo = v.timeTo; }
    return item;
  });
  if (chosen.length === 0) {
    resultMsg.innerHTML = '<div class="msg err">최소 하나의 날짜/시간대를 선택해주세요.</div>';
    return;
  }
  // 지난 날짜는 고칠 수 없고 서버가 기존 값을 유지하므로 검사하지 않는다.
  const todayKey = formatDate(new Date());
  const badKey = Object.keys(selections).find(k => k >= todayKey && kitchenTimeError(selections[k]));
  if (badKey) {
    const bd = new Date(badKey + 'T00:00:00');
    resultMsg.innerHTML = '<div class="msg err">' + (bd.getMonth()+1) + '/' + bd.getDate() + '(' + DAY_NAMES[bd.getDay()] + ') 주방보조 근무 시간을 선택해주세요. 시작과 종료는 달라야 합니다.</div>';
    return;
  }
```

- [ ] **Step 5: 문법 검사**

Run: `"/c/Program Files/nodejs/node.exe" tests/kitchen-work-type.test.js`
Expected: `18개 통과` (첫 줄 `ok - 화면 파일의 인라인 스크립트 문법` 포함).

확인: `grep -n "dayBtnClass\|ctl-" ApplyWorkerSite/WorkerView.html` — `dayBtnClass`는 `dateControlsHtml` 안에만, `ctl-`는 `redrawDateControls`와 `buildDateList`에만 있어야 한다.

- [ ] **Step 6: 커밋**

```bash
git add ApplyWorkerSite/WorkerView.html
git commit -m "근무 신청 화면에서 주방보조 날짜는 근무형태와 시간대를 선택

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 관리자 창 세 곳 (근무자 추가·일정 수정·신규 신청 수정)

**Files:**
- Modify: `ApplyWorkerSite/AdminView.html:189` (`pendingEditLocation` select)
- Modify: `ApplyWorkerSite/AdminView.html:1825-1827` (`openAdminAddOverlay` 앞에 공용 블록 추가)
- Modify: `ApplyWorkerSite/AdminView.html:1908-1953` (`renderAdminAddLocation`, `buildAdminAddDateList`)
- Modify: `ApplyWorkerSite/AdminView.html:2026-2033` (`stageAdminAddRecord`)
- Modify: `ApplyWorkerSite/AdminView.html:2075-2115` (`openAdminEditShifts`)
- Modify: `ApplyWorkerSite/AdminView.html:2132-2149` (`saveAdminShiftsEdit`)
- Modify: `ApplyWorkerSite/AdminView.html:2264-2276` (`openPendingEditOverlay`)
- Modify: `ApplyWorkerSite/AdminView.html:2293-2316` (`savePendingEditAndApprove`)

**Interfaces:**
- Consumes (Task 1): `KITCHEN_LOCATION`, `applyKitchenMode`, `kitchenTimeError`, `kitchenControlsHtml`, `KITCHEN_SCOPES`
- Consumes (Task 2): 서버 `mergeShiftExtras_` — 주방보조가 아닌 날짜는 `{date, day, night}`만 보내도 기존 값이 보존된다
- Consumes (기존): `shortDate(dateStr)`, `getAdminAddLocation()`, `adminAddSelections`, `adminEditSelections`, `pendingEditSelections`
- Produces (Task 5는 쓰지 않음, 이 태스크 안에서만 사용):
  - `adminDateSelection(found) -> sel`
  - `adminDateIsKitchen(scope, key) -> boolean`
  - `adminDateControlsHtml(scope, key) -> string`
  - `refreshAdminDateList(scope)`
  - `adminDateShifts(scope) -> shifts[]`
  - `adminDateKitchenError(scope) -> string` (문제 없으면 `''`)
  - scope는 `'aa'`(근무자 추가) · `'ae'`(일정 수정) · `'pe'`(신규 신청 수정)

- [ ] **Step 1: 세 창이 같이 쓰는 날짜 줄 블록 추가**

`ApplyWorkerSite/AdminView.html`에서 `let adminAddAutosaveTimer = null;`(1825행)과 `function openAdminAddOverlay() {`(1827행) 사이에 추가한다.

```js

// ---------- 관리자 창 세 곳의 날짜 줄 (근무자 추가 aa · 일정 수정 ae · 신규 신청 수정 pe) ----------
// 날짜의 근무지가 주방보조이면 주간/야간 대신 근무형태·시간대를 고른다. 세 창이 같은 줄을 쓰므로
// 창마다 다른 것(선택 상태, 기본 근무지, 주간/야간 토글 함수)만 여기 적어 둔다.
let adminEditBaseLocation = '';
const ADMIN_DATE_SCOPES = {
  aa: { toggle: 'toggleAdminAddShift', sels: () => adminAddSelections, base: () => getAdminAddLocation()[0] || '' },
  ae: { toggle: 'toggleAdminEditShift', sels: () => adminEditSelections, base: () => adminEditBaseLocation },
  pe: { toggle: 'togglePendingEditShift', sels: () => pendingEditSelections, base: () => document.getElementById('pendingEditLocation').value }
};
Object.keys(ADMIN_DATE_SCOPES).forEach(scope => {
  KITCHEN_SCOPES[scope] = { get: key => ADMIN_DATE_SCOPES[scope].sels()[key], redraw: key => redrawAdminDateControls(scope, key) };
});
// 한 날짜의 선택 상태 초깃값. location은 근무자가 그 날짜만 따로 고른 근무지로, 주방보조 판정에만
// 쓰고 저장할 때는 보내지 않는다(서버 mergeShiftExtras_가 되살린다).
function adminDateSelection(found) {
  const s = found || {};
  return { day: !!s.day, night: !!s.night, location: s.location || '', workType: s.workType || '', timeFrom: s.timeFrom || '', timeTo: s.timeTo || '' };
}
function adminDateIsKitchen(scope, key) {
  const s = ADMIN_DATE_SCOPES[scope];
  return (s.sels()[key].location || s.base()) === KITCHEN_LOCATION;
}
function adminDateControlsHtml(scope, key) {
  const s = ADMIN_DATE_SCOPES[scope];
  const sel = s.sels()[key];
  if (adminDateIsKitchen(scope, key)) return kitchenControlsHtml(scope, key, sel, false);
  return `<div class="shift-btns">
        <div class="shift-btn ${sel.day?'selected':''}" id="${scope}_day_${key}" onclick="${s.toggle}('${key}','day')">주간</div>
        <div class="shift-btn ${sel.night?'selected':''}" id="${scope}_night_${key}" onclick="${s.toggle}('${key}','night')">야간</div>
      </div>`;
}
function redrawAdminDateControls(scope, key) {
  document.getElementById(scope + '_ctl_' + key).innerHTML = adminDateControlsHtml(scope, key);
}
// 창에서 근무지 선택이 바뀌면 모든 날짜를 그 근무지에 맞게 바꾸고 다시 그린다.
function refreshAdminDateList(scope) {
  const sels = ADMIN_DATE_SCOPES[scope].sels();
  Object.keys(sels).forEach(key => {
    applyKitchenMode(sels[key], adminDateIsKitchen(scope, key));
    redrawAdminDateControls(scope, key);
  });
}
// 서버로 보낼 shifts. workType은 주방보조 날짜에만 남아 있다(applyKitchenMode가 다른 근무지에서는 비운다).
function adminDateShifts(scope) {
  return Object.entries(ADMIN_DATE_SCOPES[scope].sels())
    .filter(([k,v]) => v.day || v.night)
    .map(([k,v]) => {
      const item = { date: k, day: v.day, night: v.night };
      if (v.workType) { item.workType = v.workType; item.timeFrom = v.timeFrom; item.timeTo = v.timeTo; }
      return item;
    });
}
// 시간이 빠진 주방보조 날짜가 있으면 안내 문구를, 없으면 빈 문자열을 돌려준다.
function adminDateKitchenError(scope) {
  const sels = ADMIN_DATE_SCOPES[scope].sels();
  const badKey = Object.keys(sels).find(k => kitchenTimeError(sels[k]));
  return badKey ? shortDate(badKey) + ' 주방보조 근무 시간을 선택해주세요. 시작과 종료는 달라야 합니다.' : '';
}
```

- [ ] **Step 2: 근무자 추가 창**

`renderAdminAddLocation`의 라디오에 `onchange`를 붙인다.

기존:

```js
    return `<label><input type="radio" name="adminAddLocation" value="${loc}" ${checked}>${loc}</label>`;
```

변경:

```js
    return `<label><input type="radio" name="adminAddLocation" value="${loc}" ${checked} onchange="refreshAdminDateList('aa')">${loc}</label>`;
```

`buildAdminAddDateList` 안의 다음 블록을 바꾼다.

기존:

```js
    adminAddSelections[key2] = { day: false, night: false };
    if (prefillShifts) {
      const found = prefillShifts.find(s => s.date === key2);
      if (found) { adminAddSelections[key2].day = !!found.day; adminAddSelections[key2].night = !!found.night; }
    }
    const row = document.createElement('div');
    row.className = 'date-row';
    const isWeekend = (d.getDay()===0 || d.getDay()===6);
    row.innerHTML = `
      <div class="${isWeekend?'weekend':''}">${d.getMonth()+1}/${d.getDate()} (${dow})</div>
      <div class="shift-btns">
        <div class="shift-btn ${adminAddSelections[key2].day?'selected':''}" id="aa_day_${key2}" onclick="toggleAdminAddShift('${key2}','day')">주간</div>
        <div class="shift-btn ${adminAddSelections[key2].night?'selected':''}" id="aa_night_${key2}" onclick="toggleAdminAddShift('${key2}','night')">야간</div>
      </div>`;
```

변경:

```js
    adminAddSelections[key2] = adminDateSelection(prefillShifts && prefillShifts.find(s => s.date === key2));
    applyKitchenMode(adminAddSelections[key2], adminDateIsKitchen('aa', key2));
    const row = document.createElement('div');
    row.className = 'date-row';
    const isWeekend = (d.getDay()===0 || d.getDay()===6);
    row.innerHTML = `
      <div class="${isWeekend?'weekend':''}">${d.getMonth()+1}/${d.getDate()} (${dow})</div>
      <div class="shift-ctl" id="aa_ctl_${key2}">${adminDateControlsHtml('aa', key2)}</div>`;
```

`buildAdminAddDateList`는 항상 `renderAdminAddLocation` 다음에 호출된다(`openAdminAddOverlay`, `loadAdminAddRecord`, `clearAdminAddLoaded`, `stageAdminAddRecord`). 그래서 `adminDateIsKitchen('aa', …)`가 읽는 라디오 값은 이미 그려져 있다. 이 순서를 바꾸지 않는다.

`stageAdminAddRecord`의 다음 블록을 바꾼다.

기존:

```js
  const chosen = Object.entries(adminAddSelections)
    .filter(([k,v]) => v.day || v.night)
    .map(([k,v]) => ({date:k, day:v.day, night:v.night}));
  if (chosen.length === 0) {
    msgEl.innerHTML = '<div class="msg err">최소 하나의 근무 날짜를 선택해주세요.</div>';
    return;
  }
```

변경:

```js
  const chosen = adminDateShifts('aa');
  if (chosen.length === 0) {
    msgEl.innerHTML = '<div class="msg err">최소 하나의 근무 날짜를 선택해주세요.</div>';
    return;
  }
  const kitchenErr = adminDateKitchenError('aa');
  if (kitchenErr) {
    msgEl.innerHTML = '<div class="msg err">' + kitchenErr + '</div>';
    return;
  }
```

- [ ] **Step 3: 일정 수정 창**

`openAdminEditShifts`에서 `const existingShifts = rec ? (rec.shifts || []) : [];` 줄 바로 뒤에 추가한다.

```js
  adminEditBaseLocation = rec ? (rec.adminLocation || (rec.locations && rec.locations[0]) || '') : '';
```

같은 함수의 다음 블록을 바꾼다.

기존:

```js
    adminEditSelections[key2] = { day: false, night: false };
    const found = existingShifts.find(s => s.date === key2);
    if (found) { adminEditSelections[key2].day = !!found.day; adminEditSelections[key2].night = !!found.night; }

    const row = document.createElement('div');
    row.className = 'date-row';
    const isWeekend = (d.getDay()===0 || d.getDay()===6);
    row.innerHTML = `
      <div class="${isWeekend?'weekend':''}">${d.getMonth()+1}/${d.getDate()} (${dow})</div>
      <div class="shift-btns">
        <div class="shift-btn ${adminEditSelections[key2].day?'selected':''}" id="ae_day_${key2}" onclick="toggleAdminEditShift('${key2}','day')">주간</div>
        <div class="shift-btn ${adminEditSelections[key2].night?'selected':''}" id="ae_night_${key2}" onclick="toggleAdminEditShift('${key2}','night')">야간</div>
      </div>`;
```

변경:

```js
    adminEditSelections[key2] = adminDateSelection(existingShifts.find(s => s.date === key2));
    applyKitchenMode(adminEditSelections[key2], adminDateIsKitchen('ae', key2));

    const row = document.createElement('div');
    row.className = 'date-row';
    const isWeekend = (d.getDay()===0 || d.getDay()===6);
    row.innerHTML = `
      <div class="${isWeekend?'weekend':''}">${d.getMonth()+1}/${d.getDate()} (${dow})</div>
      <div class="shift-ctl" id="ae_ctl_${key2}">${adminDateControlsHtml('ae', key2)}</div>`;
```

`saveAdminShiftsEdit`의 다음 블록을 바꾼다.

기존:

```js
  const shifts = Object.entries(adminEditSelections)
    .filter(([k,v]) => v.day || v.night)
    .map(([k,v]) => ({ date:k, day:v.day, night:v.night }));
```

변경:

```js
  const shifts = adminDateShifts('ae');
```

같은 함수에서 생년월일 검사 블록 바로 뒤, `adminRun()` 앞에 추가한다.

기존:

```js
  if (pin && !/^[0-9]{6}$/.test(pin)) {
    msgEl.innerHTML = '<div class="msg err">생년월일은 숫자 6자리로 입력해주세요.</div>';
    return;
  }

  adminRun()
```

변경:

```js
  if (pin && !/^[0-9]{6}$/.test(pin)) {
    msgEl.innerHTML = '<div class="msg err">생년월일은 숫자 6자리로 입력해주세요.</div>';
    return;
  }
  const kitchenErr = adminDateKitchenError('ae');
  if (kitchenErr) {
    msgEl.innerHTML = '<div class="msg err">' + kitchenErr + '</div>';
    return;
  }

  adminRun()
```

`saveAdminShiftsEdit` 안의 이 생년월일 메시지는 "(모르면 비워두고…)"가 없는 쪽이다. `stageAdminAddRecord`의 비슷한 블록과 헷갈리지 않는다.

- [ ] **Step 4: 신규 신청 수정 창**

`ApplyWorkerSite/AdminView.html:189`의 select에 `onchange`를 붙인다.

기존:

```html
      <select id="pendingEditLocation"></select>
```

변경:

```html
      <select id="pendingEditLocation" onchange="refreshAdminDateList('pe')"></select>
```

`openPendingEditOverlay`의 다음 블록을 바꾼다.

기존:

```js
    const found = (p.shifts || []).find(s => s.date === key2) || {};
    pendingEditSelections[key2] = { day: !!found.day, night: !!found.night };
    const row = document.createElement('div');
    row.className = 'date-row';
    const isWeekend = (d.getDay()===0 || d.getDay()===6);
    row.innerHTML = `
      <div class="${isWeekend?'weekend':''}">${d.getMonth()+1}/${d.getDate()} (${DAY_NAMES[d.getDay()]})</div>
      <div class="shift-btns">
        <div class="shift-btn ${found.day?'selected':''}" id="pe_day_${key2}" onclick="togglePendingEditShift('${key2}','day')">주간</div>
        <div class="shift-btn ${found.night?'selected':''}" id="pe_night_${key2}" onclick="togglePendingEditShift('${key2}','night')">야간</div>
      </div>`;
```

변경:

```js
    pendingEditSelections[key2] = adminDateSelection((p.shifts || []).find(s => s.date === key2));
    applyKitchenMode(pendingEditSelections[key2], adminDateIsKitchen('pe', key2));
    const row = document.createElement('div');
    row.className = 'date-row';
    const isWeekend = (d.getDay()===0 || d.getDay()===6);
    row.innerHTML = `
      <div class="${isWeekend?'weekend':''}">${d.getMonth()+1}/${d.getDate()} (${DAY_NAMES[d.getDay()]})</div>
      <div class="shift-ctl" id="pe_ctl_${key2}">${adminDateControlsHtml('pe', key2)}</div>`;
```

이 함수는 날짜 목록을 그리기 전에 `pendingEditLocation`의 옵션을 채운다. `adminDateIsKitchen('pe', …)`가 그 값을 읽으므로 순서를 바꾸지 않는다.

`savePendingEditAndApprove`에서 생년월일 검사 블록 바로 뒤에 추가한다.

기존:

```js
  if (!/^[0-9]{6}$/.test(pin)) {
    msgEl.innerHTML = '<div class="msg err">생년월일은 숫자 6자리로 입력해주세요.</div>';
    return;
  }
  const edits = {
```

변경:

```js
  if (!/^[0-9]{6}$/.test(pin)) {
    msgEl.innerHTML = '<div class="msg err">생년월일은 숫자 6자리로 입력해주세요.</div>';
    return;
  }
  const kitchenErr = adminDateKitchenError('pe');
  if (kitchenErr) {
    msgEl.innerHTML = '<div class="msg err">' + kitchenErr + '</div>';
    return;
  }
  const edits = {
```

같은 함수의 `edits.shifts`를 바꾼다.

기존:

```js
    shifts: Object.entries(pendingEditSelections)
      .filter(([k,v]) => v.day || v.night)
      .map(([k,v]) => ({ date:k, day:v.day, night:v.night }))
```

변경:

```js
    shifts: adminDateShifts('pe')
```

- [ ] **Step 5: 문법 검사와 잔여 확인**

Run: `"/c/Program Files/nodejs/node.exe" tests/kitchen-work-type.test.js`
Expected: `18개 통과`.

확인: `grep -n "date:k, day:v.day\|{date:k, day:v.day" ApplyWorkerSite/AdminView.html` 결과가 없어야 한다(세 곳 모두 `adminDateShifts`로 바뀜). `toggleAdminAddShift`·`toggleAdminEditShift`·`togglePendingEditShift` 함수 정의는 그대로 남아 있어야 한다.

- [ ] **Step 6: 커밋**

```bash
git add ApplyWorkerSite/AdminView.html
git commit -m "관리자 근무자 추가·수정·신규 승인 창에서 주방보조 근무형태와 시간대 수정

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 관리자 화면 표시 (주간 표·신규 신청 요약·배치 문자)

**Files:**
- Modify: `ApplyWorkerSite/AdminView.html:332-334` (`workerLocation` 뒤에 `kitchenCellLabel` 추가)
- Modify: `ApplyWorkerSite/AdminView.html:403-431` (`floorLabel` 뒤에 `kitchenAssignSuffix` 추가, `buildShiftText`)
- Modify: `ApplyWorkerSite/AdminView.html:700-706, 762` (`buildWorkerWeekShiftTable`)
- Modify: `ApplyWorkerSite/AdminView.html:1181-1194` (`applyInfoCellPendingStyle`)
- Modify: `ApplyWorkerSite/AdminView.html:2175-2182` (`pendingShiftSummary_`)
- Modify: `ApplyWorkerSite/AdminView.html:2362-2380, 2425-2428` (`buildShiftBlock`)

행 번호는 Task 4 적용 전 기준이다. Task 4가 1826행 근처에 약 55줄을 넣고 창 세 곳에서 20줄가량을 줄이므로 그 뒤 행은 밀린다. 함수 이름으로 찾는다.

**Interfaces:**
- Consumes (Task 1): `KITCHEN_LOCATION`, `kitchenShiftLabel(shift)`, `.kitchen-label`
- Consumes (기존): `locationOfDate(rec, dateStr)`, `assignmentLocation(a, recByKey)`, `lastRecords`
- Produces:
  - `kitchenCellLabel(rec, dateStr, shiftKey) -> string` (HTML 조각 또는 `''`)
  - `kitchenAssignSuffix(a, recByKey) -> string` (`' (파트 10~15)'` 또는 `''`)
  - `buildShiftText(dateStr, shiftLabel, maleTarget, femaleTarget, maleList, femaleList, keyToPin, withBirth, recByKey)` — 마지막 인자 추가

- [ ] **Step 1: 주간 표 칸에 근무형태·시간 표기**

`workerLocation` 함수 바로 뒤에 추가한다.

```js
// 주간 표 칸에 덧붙이는 주방보조 근무형태·시간 표기. 주방보조 날짜가 아니거나 근무형태 미입력이면 빈 문자열.
function kitchenCellLabel(rec, dateStr, shiftKey) {
  if (shiftKey !== 'day' || locationOfDate(rec, dateStr) !== KITCHEN_LOCATION) return '';
  const label = kitchenShiftLabel((rec.shifts || []).find(s => s.date === dateStr));
  return label ? `<div class="kitchen-label">${label}</div>` : '';
}
```

`buildWorkerWeekShiftTable`의 `withMeta`에 원본 레코드를 넣는다.

기존:

```js
    shifts: (rec.shifts || []).filter(s => locationMatches(rec, s.date)),
    allShifts: rec.shifts || []
  }));
```

변경:

```js
    shifts: (rec.shifts || []).filter(s => locationMatches(rec, s.date)),
    allShifts: rec.shifts || [],
    rec: rec
  }));
```

같은 함수에서 신청된 날짜 칸을 그리는 줄을 바꾼다.

기존:

```js
      rowHtml += `<td id="${cellId}" class="date-cell floor-clickable" data-wchar="${WEEKDAY_LABELS[i]}" onclick="handleDateCellClick(event,'${dateStr}','${shiftKey}','${r.key}',true)">${renderFloorMark(WEEKDAY_LABELS[i], floor, transport)}</td>`;
```

변경:

```js
      rowHtml += `<td id="${cellId}" class="date-cell floor-clickable" data-wchar="${WEEKDAY_LABELS[i]}" onclick="handleDateCellClick(event,'${dateStr}','${shiftKey}','${r.key}',true)">${renderFloorMark(WEEKDAY_LABELS[i], floor, transport)}${kitchenCellLabel(r.rec, dateStr, shiftKey)}</td>`;
```

- [ ] **Step 2: 배치정보 수정 모드가 칸을 다시 그릴 때도 표기 유지**

`applyInfoCellPendingStyle`의 다음 블록을 바꾼다.

기존:

```js
  const wchar = cell.dataset.wchar || '';
  const pending = pendingInfoChanges[key] && pendingInfoChanges[key][dateStr] && pendingInfoChanges[key][dateStr][shiftKey];
  if (pending) {
    cell.classList.add('info-pending');
    cell.innerHTML = renderFloorMark(wchar, pending.floor, pending.transport);
  } else {
    cell.classList.remove('info-pending');
    const asg = lastAssignments.find(a => a.date === dateStr && a.shift === shiftKey && a.key === key);
    cell.innerHTML = renderFloorMark(wchar, asg ? asg.floor : '', asg ? asg.transport : '');
  }
```

변경:

```js
  const wchar = cell.dataset.wchar || '';
  const pending = pendingInfoChanges[key] && pendingInfoChanges[key][dateStr] && pendingInfoChanges[key][dateStr][shiftKey];
  // 칸 내용을 통째로 다시 쓰므로 주방보조 근무형태·시간 표기도 다시 붙인다.
  const rec = lastRecords.find(r => r.key === key);
  const kitchenLabel = rec ? kitchenCellLabel(rec, dateStr, shiftKey) : '';
  if (pending) {
    cell.classList.add('info-pending');
    cell.innerHTML = renderFloorMark(wchar, pending.floor, pending.transport) + kitchenLabel;
  } else {
    cell.classList.remove('info-pending');
    const asg = lastAssignments.find(a => a.date === dateStr && a.shift === shiftKey && a.key === key);
    cell.innerHTML = renderFloorMark(wchar, asg ? asg.floor : '', asg ? asg.transport : '') + kitchenLabel;
  }
```

- [ ] **Step 3: 신규 신청 요약**

`pendingShiftSummary_`의 다음 줄을 바꾼다.

기존:

```js
    const shiftText = [s.day ? '주간' : '', s.night ? '야간' : ''].filter(Boolean).join('·');
```

변경:

```js
    // 주방보조 날짜는 주간/야간 대신 근무형태·시간을 적는다. 근무형태 미입력이면 주간/야간으로 적는다.
    const kitchenText = (s.location || base) === KITCHEN_LOCATION ? kitchenShiftLabel(s) : '';
    const shiftText = kitchenText || [s.day ? '주간' : '', s.night ? '야간' : ''].filter(Boolean).join('·');
```

`base`는 같은 함수 첫 줄에 이미 있다(`const base = (p.locations && p.locations[0]) || '';`). 이 함수의 결과는 호출부에서 `escapeHtml_`을 거친다.

- [ ] **Step 4: 배치 문자와 배치판 목록**

`floorLabel` 함수 바로 뒤에 추가한다.

```js
// 배치 문자·배치판 목록의 이름 줄 끝에 붙이는 " (파트 10~15)". 주방보조로 배치된 주간 근무에만 붙는다.
function kitchenAssignSuffix(a, recByKey) {
  if (a.shift !== 'day' || assignmentLocation(a, recByKey) !== KITCHEN_LOCATION) return '';
  const rec = recByKey && recByKey[a.key];
  const label = kitchenShiftLabel(rec && (rec.shifts || []).find(s => s.date === a.date));
  return label ? ' (' + label + ')' : '';
}
```

`buildShiftText`의 시그니처와 이름 줄 두 곳을 바꾼다.

기존:

```js
function buildShiftText(dateStr, shiftLabel, maleTarget, femaleTarget, maleList, femaleList, keyToPin, withBirth) {
```

변경:

```js
function buildShiftText(dateStr, shiftLabel, maleTarget, femaleTarget, maleList, femaleList, keyToPin, withBirth, recByKey) {
```

기존:

```js
    lines.push(`남${idx+1}.${dispName}_${floorLabel(a)}${edu}${nw}${ww}`);
```

변경:

```js
    lines.push(`남${idx+1}.${dispName}_${floorLabel(a)}${edu}${nw}${ww}${kitchenAssignSuffix(a, recByKey)}`);
```

기존:

```js
    lines.push(`여${idx+1}.${dispName}_${floorLabel(a)}${edu}${nw}${ww}`);
```

변경:

```js
    lines.push(`여${idx+1}.${dispName}_${floorLabel(a)}${edu}${nw}${ww}${kitchenAssignSuffix(a, recByKey)}`);
```

`buildShiftBlock`의 배치판 목록 두 줄을 바꾼다.

기존:

```js
    html += `<div class="numbered-item"><label><input type="checkbox" class="assigned-select" data-key="${a.key}"> 남${idx+1}.${dispName}_${floorLabel(a)}${edu}${nw}${ww}${locTag}</label></div>`;
```

변경:

```js
    html += `<div class="numbered-item"><label><input type="checkbox" class="assigned-select" data-key="${a.key}"> 남${idx+1}.${dispName}_${floorLabel(a)}${edu}${nw}${ww}${kitchenAssignSuffix(a, recByKey)}${locTag}</label></div>`;
```

기존:

```js
    html += `<div class="numbered-item"><label><input type="checkbox" class="assigned-select" data-key="${a.key}"> 여${idx+1}.${dispName}_${floorLabel(a)}${edu}${nw}${ww}${locTag}</label></div>`;
```

변경:

```js
    html += `<div class="numbered-item"><label><input type="checkbox" class="assigned-select" data-key="${a.key}"> 여${idx+1}.${dispName}_${floorLabel(a)}${edu}${nw}${ww}${kitchenAssignSuffix(a, recByKey)}${locTag}</label></div>`;
```

`buildShiftBlock`의 `buildShiftText` 호출 두 곳에 `recByKey`를 넘긴다.

기존:

```js
    withBirth: buildShiftText(dateStr, shiftLabel, maleTarget, femaleTarget, maleList, femaleList, keyToPin, true),
    withoutBirth: buildShiftText(dateStr, shiftLabel, maleTarget, femaleTarget, maleList, femaleList, keyToPin, false)
```

변경:

```js
    withBirth: buildShiftText(dateStr, shiftLabel, maleTarget, femaleTarget, maleList, femaleList, keyToPin, true, recByKey),
    withoutBirth: buildShiftText(dateStr, shiftLabel, maleTarget, femaleTarget, maleList, femaleList, keyToPin, false, recByKey)
```

- [ ] **Step 5: 문법 검사와 호출부 확인**

Run: `"/c/Program Files/nodejs/node.exe" tests/kitchen-work-type.test.js`
Expected: `18개 통과`.

확인: `grep -n "buildShiftText(" ApplyWorkerSite/AdminView.html` — 정의 1곳과 호출 2곳, 호출은 모두 `recByKey`로 끝나야 한다. `grep -n "renderFloorMark(" ApplyWorkerSite/AdminView.html` — 정의를 뺀 3곳 모두 뒤에 주방보조 표기가 붙어 있어야 한다.

- [ ] **Step 6: 커밋**

```bash
git add ApplyWorkerSite/AdminView.html
git commit -m "관리자 주간 표·신규 신청 요약·배치 문자에 주방보조 근무형태와 시간 표시

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 배포 후 점검

코드만으로는 화면 동작을 확인할 수 없다. `WorkSystemSheet.gs`와 `ApplyWorkerSite`의 변경 파일을 Apps Script에 반영해 새 버전으로 배포한 뒤 아래를 직접 확인한다. 테스트용 근무자로 진행하고, 끝나면 테스트 신청을 지운다.

**근무자 신청 화면**

1. 기본 근무 장소를 `주방보조_전국`으로 고르면 모든 날짜 줄이 `파트타임`/`풀타임` 버튼으로 바뀐다. 다른 근무지로 바꾸면 `주간`/`야간`으로 돌아온다.
2. 파트타임을 누르면 그 줄 아래에 시작·종료 선택이 나온다. 시간을 비운 채 저장하면 날짜를 알려주며 막힌다. 시작과 종료를 같게 골라도 막힌다.
3. 기본 근무 장소가 다른 곳인 상태에서 한 날짜의 주간을 누르고 그 날짜 드롭다운을 `주방보조_전국`으로 바꾸면, 그 줄만 파트타임이 선택된 주방보조 줄이 된다. 선택된 파트타임을 다시 누르면 드롭다운이 사라지고 그 줄이 `주간`/`야간` 버튼으로 돌아온다.
4. 풀타임 22:00~02:00으로 저장한 뒤 다시 조회하면 그대로 나온다.
5. 주간/야간으로 이미 신청돼 있던 주방보조 근무자를 조회하면 오늘 이후 날짜는 파트타임·시간 미입력으로 나오고, 시간을 채워야 저장된다. 지난 날짜는 비활성으로 보이고 저장을 막지 않는다.
6. 관리자가 근무지를 주방보조로 지정해 둔 근무자는 라디오가 다른 곳이어도 모든 날짜가 주방보조 줄로 나온다.
7. 주방보조가 아닌 근무지의 신청·수정·전체 취소가 이전과 똑같이 동작한다.

**관리자 화면**

8. 주방보조 탭 주간 표의 날짜 칸에 요일 글자 아래로 `파트 10~15`가 보인다. 야간 표에는 나오지 않는다.
9. 근무자 추가 창에서 날짜를 주간으로 먼저 켜고 근무 장소를 `주방보조_전국`으로 바꾸면 그 날짜가 파트타임·시간 미입력으로 바뀌고, 시간을 채우기 전에는 "목록에 추가"가 막힌다. 신규 신청 수정 창에서 근무 장소를 바꿔도 같다.
10. 일정 수정 창에서 주방보조 날짜를 풀타임 09:00~18:00으로 바꿔 저장하면 주간 표가 `풀 9~18`로 바뀐다. 주방보조가 아닌 날짜는 주간/야간 버튼 그대로다.
11. 신청날짜 수정 모드로 같은 근무자의 다른 날짜를 켜고 꺼서 저장해도, 기존 주방보조 날짜의 `파트 10~15`가 남아 있다.
12. 배치정보 수정 모드에서 주방보조 날짜 칸을 눌렀다가 다시 눌러 되돌려도 `파트 10~15`가 사라지지 않는다.
13. 주방보조 근무자를 배치하면 배치판 목록과 복사 텍스트의 이름 줄 끝에 ` (파트 10~15)`가 붙는다. 전체 탭에서 다른 근무지 배치에는 붙지 않는다.
14. 신규 신청자가 주방보조로 신청하면 승인 패널 요약에 `10/5(월) 파트 10~15`로 나오고, 그대로 승인하면 주간 표에 같은 표기가 나온다.
