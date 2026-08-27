// ===== 근로자 서류 업로드 사이트 - 업로드 로직 (Google Apps Script) =====

function test_getOrCreateWorkerFolder_() {
  const id1 = getOrCreateWorkerFolder('홍길동', '01012345678');
  const id2 = getOrCreateWorkerFolder('홍길동', '01012345678');
  Logger.log('id1=' + id1);
  Logger.log('id2=' + id2);
  Logger.log('same folder: ' + (id1 === id2));
}

function getOrCreateWorkerFolder(name, phone) {
  name = (name || '').trim();
  phone = (phone || '').trim();
  if (!name) throw new Error('이름을 입력해 주세요.');
  if (!phone) throw new Error('연락처를 입력해 주세요.');

  const props = PropertiesService.getScriptProperties();
  const rootFolderId = props.getProperty('ROOT_FOLDER_ID');
  if (!rootFolderId) {
    throw new Error('ROOT_FOLDER_ID가 설정되지 않았습니다. 관리자에게 문의해 주세요.');
  }

  let rootFolder;
  try {
    rootFolder = DriveApp.getFolderById(rootFolderId);
  } catch (e) {
    throw new Error('ROOT_FOLDER_ID가 올바르지 않습니다. 관리자에게 문의해 주세요.');
  }

  const folderName = name + '_' + phone;
  const existing = rootFolder.getFoldersByName(folderName);
  if (existing.hasNext()) {
    return existing.next().getId();
  }
  return rootFolder.createFolder(folderName).getId();
}

function test_uploadFile_() {
  const folderId = getOrCreateWorkerFolder('테스트사용자', '01000000000');
  const tinyPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  const result = uploadFile(folderId, '신분증', tinyPngBase64, 'image/png', 'test.png');
  Logger.log('upload result: ' + JSON.stringify(result));

  try {
    uploadFile(folderId, '신분증', tinyPngBase64, 'application/zip', 'test.zip');
    Logger.log('FAIL: zip 파일이 거부되지 않음');
  } catch (e) {
    Logger.log('OK, zip 거부됨: ' + e.message);
  }
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

function uploadFile(folderId, category, base64Data, mimeType, fileName) {
  if (!folderId) throw new Error('folderId가 필요합니다.');
  if (!category) throw new Error('category가 필요합니다.');
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

  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    throw new Error('잘못된 폴더입니다.');
  }
  const rootFolderId = PropertiesService.getScriptProperties().getProperty('ROOT_FOLDER_ID');
  const parents = folder.getParents();
  if (!parents.hasNext() || parents.next().getId() !== rootFolderId) {
    throw new Error('잘못된 폴더입니다.');
  }

  var safeFileName = sanitizeFileName_(fileName);
  const blob = Utilities.newBlob(decoded, mimeType, category + '_' + safeFileName);
  const file = folder.createFile(blob);
  return { fileId: file.getId(), fileName: file.getName() };
}
