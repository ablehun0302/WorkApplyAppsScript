// 서류 제출 폴더 이름·주민번호 앞자리 추출의 드라이브와 무관한 함수 검증.
// 실행(저장소 루트에서): node tests/upload-folder-name.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');

const server = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'ApplyWorkerSite', 'Upload.gs'), 'utf8'), server);

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

test('UploadView.html 인라인 스크립트 문법', () => {
  const html = fs.readFileSync(path.join(root, 'ApplyWorkerSite', 'UploadView.html'), 'utf8');
  (html.match(/<script>[\s\S]*?<\/script>/g) || []).forEach((block, i) => {
    new vm.Script(block.replace(/^<script>/, '').replace(/<\/script>$/, ''), { filename: 'UploadView.html#' + i });
  });
});

test('parseBirthFromOcrText_: 주민번호 앞 6자리', () => {
  const parse = server.parseBirthFromOcrText_;
  assert.strictEqual(parse('주민등록증\n홍길동\n900101-1234567\n서울특별시'), '900101');
  assert.strictEqual(parse('050101 - 3234567'), '050101', '공백·앞자리 0');
  assert.strictEqual(parse('900101-1******'), '900101', '뒷자리 가림');
});

test('parseBirthFromOcrText_: 주민번호가 아닌 숫자는 건너뜀', () => {
  const parse = server.parseBirthFromOcrText_;
  assert.strictEqual(parse('자동차운전면허증\n11-90-123456-12\n홍길동\n900101-1234567'), '900101', '면허번호');
  assert.strictEqual(parse('991340-1234567\n900101-1234567'), '900101', '날짜가 아닌 6자리');
  assert.strictEqual(parse('발급일 2020.01.01 서울특별시장'), '');
  assert.strictEqual(parse(''), '');
  assert.strictEqual(parse(null), '');
});

test('workerFolderName_: 생년월일이 있으면 "이름 생년월일", 없으면 "이름 연락처"', () => {
  const folderName = server.workerFolderName_;
  assert.strictEqual(folderName('홍길동', '01012345678', '900101'), '홍길동 900101');
  assert.strictEqual(folderName('홍길동', '01012345678', ''), '홍길동 01012345678');
  assert.strictEqual(folderName('홍길동', '01012345678', undefined), '홍길동 01012345678');
});

test('findWorkerFolder는 폴더를 만들지 않고, getOrCreateWorkerFolder만 만든다', () => {
  // 드라이브 흉내: 루트 폴더 아래 폴더 이름 -> 파일 이름 목록
  const folders = {};
  const makeFolder = (name) => ({
    getId: () => 'id:' + name,
    getFilesByName: () => ({ hasNext: () => false }),
    createFile: (fileName) => { folders[name].push(fileName); }
  });
  server.PropertiesService = { getScriptProperties: () => ({ getProperty: () => 'root' }) };
  server.DriveApp = {
    getFolderById: () => ({
      getFoldersByName: (name) => {
        let done = !(name in folders);
        return { hasNext: () => !done, next: () => { done = true; return makeFolder(name); } };
      },
      createFolder: (name) => { folders[name] = []; return makeFolder(name); }
    })
  };

  assert.strictEqual(server.findWorkerFolder('홍길동', '01012345678', '900101'), '');
  assert.strictEqual(server.findWorkerFolder('홍길동', '01012345678', ''), '');
  assert.strictEqual(Object.keys(folders).length, 0, '확인만으로는 폴더가 생기지 않는다');

  assert.strictEqual(server.getOrCreateWorkerFolder('홍길동', '01012345678', '900101'), 'id:홍길동 900101');
  assert.strictEqual(JSON.stringify(folders), JSON.stringify({ '홍길동 900101': ['연락처.txt'] }));
  assert.strictEqual(server.findWorkerFolder('홍길동', '01012345678', '900101'), 'id:홍길동 900101');
});

console.log(passed + '개 통과');
