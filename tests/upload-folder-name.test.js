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

test('uploadFileName_·fileCategory_: "이름 항목[ 번호].확장자"', () => {
  const fileName = server.uploadFileName_;
  assert.strictEqual(fileName('홍길동', '신분증', 0, 'IMG_0001.JPG'), '홍길동 신분증.jpg');
  assert.strictEqual(fileName('홍길동', '신분증', 2, 'scan.final.pdf'), '홍길동 신분증 2.pdf');

  const category = server.fileCategory_;
  assert.strictEqual(category('홍길동 신분증.jpg'), '신분증');
  assert.strictEqual(category('홍길동 기타 12.pdf'), '기타');
  assert.strictEqual(category('연락처.txt'), '');
});

test('uploadFile: 항목의 첫 파일만 기존 파일을 교체하고, 나머지는 번호를 붙여 모두 남긴다', () => {
  let names = ['홍길동 신분증.jpg', '홍길동 통장사본.pdf', '연락처.txt'];
  const makeFile = (name) => ({
    getName: () => name,
    getId: () => 'id:' + name,
    isTrashed: () => false,
    setTrashed: () => { names = names.filter((n) => n !== name); }
  });
  server.Utilities = { base64Decode: () => [1], newBlob: (data, mimeType, name) => name };
  server.PropertiesService = { getScriptProperties: () => ({ getProperty: () => 'root' }) };
  server.DriveApp = {
    getFolderById: () => ({
      getParents: () => ({ hasNext: () => true, next: () => ({ getId: () => 'root' }) }),
      getFiles: () => {
        const list = names.map(makeFile);
        return { hasNext: () => list.length > 0, next: () => list.shift() };
      },
      createFile: (name) => { names.push(name); return makeFile(name); }
    })
  };

  const first = server.uploadFile('f', '신분증', '', 'image/jpeg', 'a.jpg', '홍길동', 1, true);
  assert.strictEqual(first.fileName, '홍길동 신분증 1.jpg');
  server.uploadFile('f', '신분증', '', 'image/png', 'b.png', '홍길동', 2, false);
  assert.deepStrictEqual(names.slice().sort(),
    ['연락처.txt', '홍길동 신분증 1.jpg', '홍길동 신분증 2.png', '홍길동 통장사본.pdf'].sort());

  // 재시도(replace=false)는 같은 이름의 파일만 바꾼다.
  server.uploadFile('f', '신분증', '', 'image/jpeg', 'a.jpg', '홍길동', 1, false);
  assert.strictEqual(names.filter((n) => n === '홍길동 신분증 1.jpg').length, 1);
  assert.strictEqual(names.length, 4);

  assert.strictEqual(JSON.stringify(server.getExistingCategories('f')), JSON.stringify({ '통장사본': true, '신분증': true }));
  assert.throws(() => server.uploadFile('f', '없는항목', '', 'image/jpeg', 'a.jpg', '홍길동', 0, true));
  assert.throws(() => server.uploadFile('f', '신분증', '', 'image/jpeg', 'a.jpg', ' ', 0, true));
});

console.log(passed + '개 통과');
