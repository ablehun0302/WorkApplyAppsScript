// ===== 근로자 서류 업로드 사이트 - 업로드 로직 (Google Apps Script) =====

function test_getOrCreateWorkerFolder_() {
  const id1 = getOrCreateWorkerFolder('홍길동', '01012345678', '900101');
  const id2 = getOrCreateWorkerFolder('홍길동', '01012345678', '900101');
  Logger.log('id1=' + id1);
  Logger.log('id2=' + id2);
  Logger.log('same folder: ' + (id1 === id2));
  Logger.log('folder name: ' + DriveApp.getFolderById(id1).getName());
}

var PHONE_FILE_NAME = '연락처.txt';

// OCR로 읽은 글자에서 주민번호(6자리-7자리)를 찾아 앞 6자리를 돌려준다. 못 찾으면 ''.
// 운전면허번호(11-90-123456-12)처럼 앞에 숫자·하이픈이 붙은 6자리와 날짜가 아닌 6자리는 건너뛴다.
function parseBirthFromOcrText_(text) {
  var pattern = /(?<![\d-])(\d{2})(\d{2})(\d{2})\s*-\s*[1-8][\d*]{6}/g;
  var m;
  while ((m = pattern.exec(String(text || ''))) !== null) {
    var month = Number(m[2]), day = Number(m[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return m[1] + m[2] + m[3];
  }
  return '';
}

// 신분증을 드라이브 OCR로 읽어 생년월일 6자리를 돌려준다. 주민번호를 찾지 못하면 '', OCR 자체가 실패하면 오류.
// Apps Script 편집기에서 Drive API(v3) 고급 서비스를 켜야 한다.
function extractBirthFromIdCard(base64Data, mimeType) {
  if (!isAllowedMimeType_(mimeType)) return '';
  const decoded = Utilities.base64Decode(base64Data);
  if (decoded.length > MAX_FILE_BYTES) return '';

  let docId;
  try {
    const blob = Utilities.newBlob(decoded, mimeType, 'ocr_temp');
    docId = Drive.Files.create(
      { name: 'ocr_temp', mimeType: 'application/vnd.google-apps.document' }, blob, { ocrLanguage: 'ko' }
    ).id;
    // DocumentApp으로 열면 문서 권한(auth/documents)이 따로 필요하므로, 이미 가진 드라이브 권한으로 글자만 내려받는다.
    const text = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + docId + '/export?mimeType=text/plain',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } }
    ).getContentText();
    return parseBirthFromOcrText_(text);
  } catch (e) {
    // 주민번호를 못 찾은 것('' 반환)과 구별되도록 OCR 자체의 실패(설정·권한·변환 불가)는 오류로 올린다.
    Logger.log('실패 원인: ' + e.message);
    throw new Error('신분증 OCR에 실패했습니다.');
  } finally {
    // 신분증 내용이 담긴 임시 문서는 휴지통에도 남기지 않는다.
    if (docId) Drive.Files.remove(docId);
  }
}

function workerFolderName_(name, phone, birth) {
  return birth ? name + ' ' + birth : name + ' ' + phone;
}

function savePhoneFile_(folder, phone) {
  const files = folder.getFilesByName(PHONE_FILE_NAME);
  while (files.hasNext()) {
    const f = files.next();
    if (f.isTrashed()) continue;
    f.setContent(phone);
    return;
  }
  folder.createFile(PHONE_FILE_NAME, phone);
}

// 근무자 폴더를 찾기만 하고 만들지는 않는다. birth(생년월일 6자리)는 선택이며 없으면 '이름 연락처' 폴더를 찾는다.
// 돌려주는 folder는 폴더가 없으면 null.
function lookupWorkerFolder_(name, phone, birth) {
  name = (name || '').trim();
  phone = (phone || '').trim();
  birth = (birth || '').trim();
  if (!name) throw new Error('이름을 입력해 주세요.');
  if (!phone) throw new Error('연락처를 입력해 주세요.');
  if (birth && !/^\d{6}$/.test(birth)) throw new Error('생년월일은 숫자 6자리로 입력해 주세요.');

  const props = PropertiesService.getScriptProperties();
  const rootFolderId = props.getProperty('ROOT_FOLDER_ID');
  if (!rootFolderId) {
    throw new Error('ROOT_FOLDER_ID가 설정되지 않았습니다. 관리자에게 문의해 주세요.');
  }

  let rootFolder;
  try {
    rootFolder = DriveApp.getFolderById(rootFolderId);
  } catch (e) {
    Logger.log('실패 원인: ' + e.message);
    throw new Error('ROOT_FOLDER_ID가 올바르지 않습니다. 관리자에게 문의해 주세요.');
  }

  const folderName = workerFolderName_(name, phone, birth);
  const existing = rootFolder.getFoldersByName(folderName);
  return { rootFolder: rootFolder, folderName: folderName, phone: phone, folder: existing.hasNext() ? existing.next() : null };
}

// 기존 파일 확인용. 폴더가 없으면 만들지 않고 ''를 돌려준다.
function findWorkerFolder(name, phone, birth) {
  const found = lookupWorkerFolder_(name, phone, birth);
  return found.folder ? found.folder.getId() : '';
}

function getOrCreateWorkerFolder(name, phone, birth) {
  const found = lookupWorkerFolder_(name, phone, birth);
  const folder = found.folder || found.rootFolder.createFolder(found.folderName);
  savePhoneFile_(folder, found.phone);
  return folder.getId();
}

function test_uploadFile_() {
  const folderId = getOrCreateWorkerFolder('테스트사용자', '01000000000', '000101');
  const tinyPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  const result = uploadFile(folderId, '신분증', tinyPngBase64, 'image/png', 'test.png', '테스트사용자', 0, true);
  Logger.log('upload result: ' + JSON.stringify(result));

  try {
    uploadFile(folderId, '신분증', tinyPngBase64, 'application/zip', 'test.zip', '테스트사용자', 0, true);
    Logger.log('FAIL: zip 파일이 거부되지 않음');
  } catch (e) {
    Logger.log('OK, zip 거부됨: ' + e.message);
  }

  // 같은 category로 재업로드하면 기존 파일이 휴지통으로 가고 새 파일만 남아야 함
  uploadFile(folderId, '신분증', tinyPngBase64, 'image/png', 'test2.png', '테스트사용자', 0, true);
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFiles();
  let activeCount = 0;
  while (files.hasNext()) {
    const f = files.next();
    if (fileCategory_(f.getName()) === '신분증' && !f.isTrashed()) activeCount++;
  }
  Logger.log(activeCount === 1
    ? 'OK, 재업로드 시 기존 파일 교체됨 (활성 파일 ' + activeCount + '개)'
    : 'FAIL: 활성 파일이 1개가 아님 (' + activeCount + '개)');

  const existing = getExistingCategories(folderId);
  Logger.log((existing['신분증'] === true && !existing['통장사본'])
    ? 'OK, getExistingCategories가 업로드된 카테고리만 true로 반환함'
    : 'FAIL: getExistingCategories 결과가 예상과 다름: ' + JSON.stringify(existing));
}

var MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

var ALLOWED_EXTENSIONS = {
  '.jpg': 'image/', '.jpeg': 'image/', '.png': 'image/',
  '.gif': 'image/', '.webp': 'image/', '.heic': 'image/',
  '.pdf': 'application/pdf'
};

function isAllowedMimeType_(mimeType) {
  return typeof mimeType === 'string' &&
    (mimeType === 'application/pdf' || mimeType.indexOf('image/') === 0);
}

function sanitizeFileName_(fileName) {
  return String(fileName || '').replace(/[\/\\\x00-\x1f]/g, '_');
}

function isAllowedFileName_(fileName, mimeType) {
  var safeName = sanitizeFileName_(fileName);
  var dotIndex = safeName.lastIndexOf('.');
  if (dotIndex === -1) return false;
  var ext = safeName.slice(dotIndex).toLowerCase();
  var expectedPrefix = ALLOWED_EXTENSIONS[ext];
  if (!expectedPrefix) return false;
  if (expectedPrefix === 'application/pdf') return mimeType === 'application/pdf';
  return typeof mimeType === 'string' && mimeType.indexOf(expectedPrefix) === 0;
}

function getValidatedFolder_(folderId) {
  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    Logger.log('실패 원인: ' + e.message);
    throw new Error('잘못된 폴더입니다.');
  }
  const rootFolderId = PropertiesService.getScriptProperties().getProperty('ROOT_FOLDER_ID');
  const parents = folder.getParents();
  if (!parents.hasNext() || parents.next().getId() !== rootFolderId) {
    throw new Error('잘못된 폴더입니다.');
  }
  return folder;
}

var CATEGORIES = ['신분증', '통장사본', '보건증', '기타'];

// 저장 파일 이름: '이름 항목.확장자'. 한 항목에 여러 개면 seq(1부터)를 붙여 '이름 항목 1.확장자'. seq가 0이면 번호 없음.
function uploadFileName_(workerName, category, seq, originalName) {
  var safeName = sanitizeFileName_(originalName);
  var ext = safeName.slice(safeName.lastIndexOf('.')).toLowerCase();
  return workerName + ' ' + category + (seq ? ' ' + seq : '') + ext;
}

// 저장 파일 이름에서 항목을 돌려준다. 서류 파일이 아니면(연락처.txt 등) ''.
function fileCategory_(fileName) {
  var m = new RegExp(' (' + CATEGORIES.join('|') + ')(?: \\d+)?\\.[^.]+$').exec(String(fileName || ''));
  return m ? m[1] : '';
}

// 카테고리별로 기존 파일이 있는지만 알려줌 (파일명/내용 노출 안 함)
function getExistingCategories(folderId) {
  const folder = getValidatedFolder_(folderId);
  const result = {};
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    if (f.isTrashed()) continue;
    const category = fileCategory_(f.getName());
    if (category) result[category] = true;
  }
  return result;
}

// replace가 true면 그 항목의 기존 파일을 모두 휴지통으로 보낸다(제출 시 항목별 첫 파일). 아니면 같은 이름의 파일만 바꾼다.
function uploadFile(folderId, category, base64Data, mimeType, fileName, workerName, seq, replace) {
  if (!folderId) throw new Error('folderId가 필요합니다.');
  if (CATEGORIES.indexOf(category) === -1) throw new Error('category가 올바르지 않습니다.');
  workerName = sanitizeFileName_(workerName).trim();
  if (!workerName) throw new Error('이름을 입력해 주세요.');
  if (!isAllowedMimeType_(mimeType)) {
    throw new Error('이미지 또는 PDF 파일만 업로드할 수 있습니다.');
  }
  if (!isAllowedFileName_(fileName, mimeType)) {
    throw new Error('이미지 또는 PDF 파일만 업로드할 수 있습니다.');
  }

  const decoded = Utilities.base64Decode(base64Data);
  if (decoded.length > MAX_FILE_BYTES) {
    throw new Error('파일 용량은 10MB를 초과할 수 없습니다.');
  }

  const folder = getValidatedFolder_(folderId);

  var newFileName = uploadFileName_(workerName, category, Number(seq) || 0, fileName);
  var existingFiles = folder.getFiles();
  while (existingFiles.hasNext()) {
    var existingFile = existingFiles.next();
    var existingName = existingFile.getName();
    if (existingName === newFileName || (replace && fileCategory_(existingName) === category)) {
      existingFile.setTrashed(true);
    }
  }

  const blob = Utilities.newBlob(decoded, mimeType, newFileName);
  const file = folder.createFile(blob);
  return { fileId: file.getId(), fileName: file.getName() };
}
