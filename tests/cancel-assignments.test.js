// 신청에서 빠진 (날짜,시프트)의 배치·근로이력 정리(removeCanceledAssignments_, batchRemoveAssignments)와
// 관리자 일정 수정(adminUpdateShifts)이 창 밖 날짜를 지키는지 검증.
// 실행(저장소 루트에서): node tests/cancel-assignments.test.js
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
        getValue: () => rows[row - 1][col - 1],
        setValue(v) { rows[row - 1][col - 1] = v; }
      };
    },
    deleteRow(row) { rows.splice(row - 1, 1); }
  };
}

// 이번 주 월요일(10/19)부터 2주
const WINDOW = new Set(Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(2026, 9, 19 + i)).toISOString().slice(0, 10)));

function load(dataRows, assignRows, historyRows) {
  const server = vm.createContext({
    requireAdmin_() {},
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Logger: { log() {} }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'WorkSystemSheet.gs'), 'utf8'), server);
  const data = fakeSheet([['key']].concat(dataRows));
  const assign = fakeSheet([['assignKey']].concat(assignRows));
  const history = fakeSheet([['histKey']].concat(historyRows));
  server.getDataSheet_ = () => data;
  server.getAssignSheet_ = () => assign;
  server.getHistorySheet_ = () => history;
  server.getCurrentTwoWeekDateSet_ = () => WINDOW;
  return {
    server,
    shifts: (i) => JSON.parse(data.rows[i + 1][5]),
    assignKeys: () => assign.rows.slice(1).map(r => r[0]),
    historyKeys: () => history.rows.slice(1).map(r => r[0])
  };
}

const dataRow = (key, shifts) => [key, '이름', '', '', '', JSON.stringify(shifts), '[]', '', '', '남', '', ''];
const assignRow = (date, shift, key) => [date + '_' + shift + '_' + key, date, shift, key, '이름', '남', '', false, false, false, '', ''];
const historyRow = (key, date) => [key + '_' + date, key, date];

const same = (actual, expected, msg) => assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected), msg);

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

function sample() {
  return load(
    [dataRow('k1', [
      { date: '2026-10-12', day: true, night: false },
      { date: '2026-10-20', day: true, night: true },
      { date: '2026-10-21', day: true, night: false }
    ])],
    [assignRow('2026-10-12', 'day', 'k1'), assignRow('2026-10-20', 'day', 'k1'), assignRow('2026-10-20', 'night', 'k1'),
     assignRow('2026-10-21', 'day', 'k1'), assignRow('2026-10-20', 'day', 'k2')],
    [historyRow('k1', '2026-10-12'), historyRow('k1', '2026-10-20'), historyRow('k1', '2026-10-21'), historyRow('k2', '2026-10-20')]
  );
}

test('창 확인: 10/19 ~ 11/01', () => {
  assert.strictEqual(WINDOW.size, 14);
  assert.ok(WINDOW.has('2026-10-19') && WINDOW.has('2026-11-01') && !WINDOW.has('2026-10-18'));
});

test('관리자 일정 수정: 뺀 시프트의 배치를 지우고, 남은 시프트가 있는 날의 근로이력은 남긴다', () => {
  const s = sample();
  s.server.adminUpdateShifts('k1', [{ date: '2026-10-20', day: true, night: false }], 'pw');
  same(s.shifts(0), [
    { date: '2026-10-12', day: true, night: false },
    { date: '2026-10-20', day: true, night: false }
  ], '창 밖(10/12) 신청은 그대로 남는다');
  same(s.assignKeys(), ['2026-10-12_day_k1', '2026-10-20_day_k1', '2026-10-20_day_k2']);
  same(s.historyKeys(), ['k1_2026-10-12', 'k1_2026-10-20', 'k2_2026-10-20']);
});

test('관리자 일정 수정: 창 밖 날짜까지 보내도(신청날짜 수정 모드) 중복되지 않는다', () => {
  const s = sample();
  s.server.adminUpdateShifts('k1', [
    { date: '2026-10-12', day: true, night: false },
    { date: '2026-10-20', day: true, night: true },
    { date: '2026-10-21', day: true, night: false }
  ], 'pw');
  same(s.shifts(0).map(x => x.date), ['2026-10-12', '2026-10-20', '2026-10-21']);
  assert.strictEqual(s.assignKeys().length, 5, '바뀐 것이 없으면 배치도 그대로');
});

test('일괄 배치취소: 같은 날 주간만 취소하면 근로이력은 남는다', () => {
  const s = sample();
  s.server.batchRemoveAssignments([{ date: '2026-10-20', shift: 'day', key: 'k1' }], 'pw');
  assert.ok(s.assignKeys().indexOf('2026-10-20_day_k1') === -1);
  assert.ok(s.historyKeys().indexOf('k1_2026-10-20') > -1);
});

test('일괄 배치취소: 같은 날 주간·야간을 모두 취소하면 근로이력도 지운다', () => {
  const s = sample();
  s.server.batchRemoveAssignments([{ date: '2026-10-20', shift: 'day', key: 'k1' }, { date: '2026-10-20', shift: 'night', key: 'k1' }], 'pw');
  same(s.assignKeys(), ['2026-10-12_day_k1', '2026-10-21_day_k1', '2026-10-20_day_k2']);
  same(s.historyKeys(), ['k1_2026-10-12', 'k1_2026-10-21', 'k2_2026-10-20']);
});

console.log(`\n${passed}개 통과`);
