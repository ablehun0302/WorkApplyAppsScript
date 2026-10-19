// Data 시트 M열(지역)의 서버 저장·조회 검증.
// 실행(저장소 루트에서): node tests/region.test.js
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
        getValue: () => (rows[row - 1] || [])[col - 1] || '',
        setValue(v) { rows[row - 1][col - 1] = v; }
      };
    }
  };
}

// const로 선언된 값은 컨텍스트 객체의 속성이 아니라서 식으로 꺼낸다.
const headersOf = (server) => JSON.parse(vm.runInContext('JSON.stringify(DATA_HEADERS)', server));

function load(dataRows, headers) {
  const server = vm.createContext({
    requireAdmin_() {},
    Logger: { log() {} }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'WorkSystemSheet.gs'), 'utf8'), server);
  const data = fakeSheet([headers || headersOf(server).slice(0, 12)].concat(dataRows));
  server.getDataSheet_ = () => data;
  server.getRosterSheet_ = () => fakeSheet([['key']]);
  return { server, data, region: (i) => data.rows[i + 1][12], header: () => data.rows[0][12] };
}

// key, name, phone, pin, ts, shiftsJSON, locationsJSON, adminLocation, message, gender, adminGender, adConsent, region
const dataRow = (key, region) => [key, '이름', '', '', '', '[]', '[]', '', '', '남', '', '', region];

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

test('DATA_HEADERS: 지역은 M열(13번째)이다', () => {
  const headers = headersOf(load([]).server);
  assert.strictEqual(headers.length, 13);
  assert.strictEqual(headers[12], 'region');
});

test('setRegion: 그 사람의 M열에 쓰고, 앞뒤 공백은 지운다', () => {
  const s = load([dataRow('k1', ''), dataRow('k2', '')]);
  assert.strictEqual(s.server.setRegion('k2', '  청주 ', 'pw'), true);
  assert.strictEqual(s.region(1), '청주');
  assert.strictEqual(s.region(0), '', '다른 사람은 그대로');
});

test('setRegion: 비우면 지워지고, 없는 사람은 false', () => {
  const s = load([dataRow('k1', '음성')]);
  assert.strictEqual(s.server.setRegion('k1', '', 'pw'), true);
  assert.strictEqual(s.region(0), '');
  assert.strictEqual(s.server.setRegion('gone', '청주', 'pw'), false);
});

test('setRegion: 기존 시트에 M1 머리글이 없으면 채운다', () => {
  const s = load([dataRow('k1', '')]);
  assert.strictEqual(s.header(), undefined);
  s.server.setRegion('k1', '청주', 'pw');
  assert.strictEqual(s.header(), 'region');
});

test('batchSetRegions: 여러 명을 한 번에 쓰고 없는 사람은 건너뛴다', () => {
  const s = load([dataRow('k1', ''), dataRow('k2', '진천'), dataRow('k3', '')]);
  s.server.batchSetRegions([{ key: 'k1', region: '청주' }, { key: 'k2', region: '' }, { key: 'gone', region: '음성' }], 'pw');
  assert.deepStrictEqual([s.region(0), s.region(1), s.region(2)], ['청주', '', '']);
  assert.strictEqual(s.header(), 'region');
});

test('getAdminData: 지역을 region으로 돌려준다(없으면 빈 문자열)', () => {
  const s = load([dataRow('k1', '청주'), dataRow('k2', '')]);
  const records = JSON.parse(JSON.stringify(s.server.getAdminData('pw')));
  assert.deepStrictEqual(records.map(r => r.region), ['청주', '']);
});

console.log('\n' + passed + '개 통과');
