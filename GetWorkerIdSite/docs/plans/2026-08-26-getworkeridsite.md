# GetWorkerIdSite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 새 근로자가 로그인 없이 이름/연락처와 함께 신분증·통장사본(필수), 보건증·기타서류(선택) 파일을 업로드하면, 구글 드라이브에 `{이름}_{연락처}` 폴더를 만들어(또는 재사용해) 저장하는 공개 GAS 웹앱을 만든다.

**Architecture:** 인증 없는 단일 페이지(`index.html`) + 서버 함수 2개(`getOrCreateWorkerFolder`, `uploadFile`)로 구성된 독립 GAS 프로젝트. 클라이언트가 폴더를 먼저 만들고, 선택된 파일을 하나씩 순차적으로 서버에 업로드하며 파일별 진행 상태를 표시한다.

**Tech Stack:** Google Apps Script (`.gs`), `HtmlService`(`index.html`), `DriveApp`, `PropertiesService`. 이 리포지토리는 clasp/TypeScript/자동화 테스트 프레임워크를 쓰지 않는다(다른 두 사이트도 동일). 따라서 이 계획의 "테스트" 단계는 자동화된 `pytest`류 대신, Apps Script 에디터에서 수동으로 실행하는 `test_*()` 함수(구현 전엔 `ReferenceError`로 실패, 구현 후엔 `Logger.log`로 통과를 확인)와 배포된 웹앱에서의 수동 브라우저 테스트로 대체한다.

**Spec:** `GetWorkerIdSite/docs/DESIGN.md`

## Global Constraints

- 파일당 최대 용량: 10MB (초과 시 서버·클라이언트 모두 거부)
- 허용 파일 형식: `image/*`, `application/pdf`만 (그 외 거부)
- 필수 항목: 이름, 연락처, 신분증(최소 1개), 통장사본(최소 1개)
- 선택 항목: 보건증, 기타 서류 (항목당 여러 개 업로드 허용)
- 드라이브 폴더명: `{이름}_{연락처}` (동일 이름+연락처 재제출 시 폴더 재사용, 새로 만들지 않음)
- 파일명: `{항목명}_{원본파일명}` (예: `신분증_photo1.jpg`)
- 인증 없음(완전 공개 페이지), 스프레드시트 미사용(`WorkSystemSheet.gs` 재사용 안 함)
- 상위 Drive 폴더 ID는 Script Properties의 `ROOT_FOLDER_ID`에서 읽는다
- 업로드 방식: 폴더 생성 1회 호출 후 파일별 개별 `uploadFile` 순차 호출 (일괄 단일 호출 금지)

---

## File Structure

```
GetWorkerIdSite\
  Code.gs        # doGet() 진입점만
  Upload.gs      # getOrCreateWorkerFolder, uploadFile
  index.html     # 폼 UI + 클라이언트 로직
  docs\
    DESIGN.md
    plans\2026-08-26-getworkeridsite.md
```

---

### Task 1: GAS 프로젝트 골격 생성 + Script Properties 설정

**Files:**
- Create: `GetWorkerIdSite/Code.gs`
- Create: `GetWorkerIdSite/index.html`

**Interfaces:**
- Consumes: 없음
- Produces: `doGet()` (Code.gs) — `index.html`을 렌더링하는 GAS 웹앱 진입점. 이후 모든 태스크는 이 `doGet()`이 렌더링하는 `index.html`을 계속 수정한다.

- [ ] **Step 1: 상위 Drive 폴더 준비**

Google Drive에서 근로자 폴더들을 모아둘 상위 폴더를 하나 만들고(예: "GetWorkerIdSite 업로드"), 폴더를 열어 URL의 `folders/` 뒤 ID를 복사해 둔다. 이 ID를 이후 Script Properties의 `ROOT_FOLDER_ID` 값으로 쓴다.

- [ ] **Step 2: 새 Apps Script 프로젝트 생성**

https://script.google.com 에서 "새 프로젝트"를 만들고 이름을 `GetWorkerIdSite`로 지정한다(기존 `SendMessageSite`/`ApplyWorkerSite`와 동일하게, 스프레드시트에 바인딩되지 않은 독립 프로젝트).

- [ ] **Step 3: Script Properties에 ROOT_FOLDER_ID 설정**

프로젝트 설정(⚙️) → 스크립트 속성 → 속성 추가: 키 `ROOT_FOLDER_ID`, 값은 Step 1에서 복사한 폴더 ID.

- [ ] **Step 4: `Code.gs` 작성**

```javascript
// ===== 근로자 서류 업로드 사이트 서버 코드 (Google Apps Script) =====

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('서류 제출')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
```

- [ ] **Step 5: `index.html` 골격 작성**

```html
<!DOCTYPE html>
<html>
  <head>
    <base target="_top">
    <meta name="viewport" content="width=device-width, initial-scale=1">
  </head>
  <body>
    <h1>서류 제출</h1>
  </body>
</html>
```

- [ ] **Step 6: Apps Script 에디터에 붙여넣고 테스트 배포**

`Code.gs`, `index.html` 내용을 Apps Script 에디터의 동일한 이름의 파일에 붙여넣는다(파일이 없으면 새로 만든다). 우측 상단 "배포" → "테스트 배포"로 웹앱 URL을 받는다.

- [ ] **Step 7: 수동 확인**

테스트 배포 URL을 브라우저로 열어 "서류 제출"이라는 제목의 페이지가 뜨는지 확인한다.

Expected: 브라우저 탭 제목이 "서류 제출"이고, 본문에 "서류 제출" 제목(h1)이 보인다.

- [ ] **Step 8: 커밋**

```bash
git add GetWorkerIdSite/Code.gs GetWorkerIdSite/index.html
git commit -m "feat: GetWorkerIdSite 프로젝트 골격 (doGet + index 스켈레톤)"
```

---

### Task 2: `Upload.gs` — `getOrCreateWorkerFolder`

**Files:**
- Create: `GetWorkerIdSite/Upload.gs`

**Interfaces:**
- Consumes: 없음
- Produces: `getOrCreateWorkerFolder(name: string, phone: string): string` — `{이름}_{연락처}` 폴더를 `ROOT_FOLDER_ID` 아래에서 찾거나 만들어 폴더 ID를 반환. `name`/`phone`이 비어 있거나 `ROOT_FOLDER_ID`가 없거나 잘못되면 `Error`를 던짐. Task 3, 5가 이 함수를 사용한다.

- [ ] **Step 1: 실패하는 수동 테스트 함수 작성**

`Upload.gs`에 다음을 추가한다(이 시점엔 `getOrCreateWorkerFolder`가 아직 없으므로 호출 시 에러가 난다):

```javascript
// ===== 근로자 서류 업로드 사이트 - 업로드 로직 (Google Apps Script) =====

function test_getOrCreateWorkerFolder() {
  const id1 = getOrCreateWorkerFolder('홍길동', '01012345678');
  const id2 = getOrCreateWorkerFolder('홍길동', '01012345678');
  Logger.log('id1=' + id1);
  Logger.log('id2=' + id2);
  Logger.log('same folder: ' + (id1 === id2));
}
```

- [ ] **Step 2: 실패 확인**

Apps Script 에디터에 `Upload.gs`를 붙여넣고, 함수 선택 드롭다운에서 `test_getOrCreateWorkerFolder`를 골라 실행한다.

Expected: 실행 로그에 `ReferenceError: getOrCreateWorkerFolder is not defined` (또는 동일한 취지의 에러).

- [ ] **Step 3: `getOrCreateWorkerFolder` 구현**

```javascript
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
```

- [ ] **Step 4: 통과 확인**

Apps Script 에디터에서 `Upload.gs`를 갱신하고 `test_getOrCreateWorkerFolder`를 다시 실행한다.

Expected: 로그에 `id1`, `id2`가 같은 값으로 출력되고 `same folder: true`가 찍힌다. Drive에서 `ROOT_FOLDER_ID` 폴더를 열어보면 `홍길동_01012345678` 폴더가 하나만 생성돼 있다(중복 생성 안 됨).

- [ ] **Step 5: 에러 케이스 확인**

Script Properties에서 `ROOT_FOLDER_ID` 값을 잠시 지우고 `test_getOrCreateWorkerFolder`를 다시 실행한다.

Expected: `ROOT_FOLDER_ID가 설정되지 않았습니다...` 에러가 던져진다. 확인 후 Step 3에서 설정했던 값으로 `ROOT_FOLDER_ID`를 복원한다.

- [ ] **Step 6: 커밋**

```bash
git add GetWorkerIdSite/Upload.gs
git commit -m "feat: GetWorkerIdSite getOrCreateWorkerFolder 구현"
```

---

### Task 3: `Upload.gs` — `uploadFile`

**Files:**
- Modify: `GetWorkerIdSite/Upload.gs`

**Interfaces:**
- Consumes: `getOrCreateWorkerFolder`(Task 2, 테스트 폴더 준비용)
- Produces: `uploadFile(folderId: string, category: string, base64Data: string, mimeType: string, fileName: string): {fileId: string, fileName: string}` — `mimeType`이 `image/*` 또는 `application/pdf`가 아니거나 디코딩된 크기가 10MB를 초과하면 `Error`를 던짐. 성공 시 파일명은 `{category}_{fileName}`로 저장됨. Task 5가 이 함수를 클라이언트에서 파일별로 호출한다.

- [ ] **Step 1: 실패하는 수동 테스트 함수 작성**

`Upload.gs` 끝에 추가:

```javascript
function test_uploadFile() {
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
```

- [ ] **Step 2: 실패 확인**

Apps Script 에디터에서 `test_uploadFile`을 실행한다.

Expected: `ReferenceError: uploadFile is not defined`.

- [ ] **Step 3: `uploadFile` 구현**

```javascript
var MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

function isAllowedMimeType_(mimeType) {
  return mimeType === 'application/pdf' || mimeType.indexOf('image/') === 0;
}

function uploadFile(folderId, category, base64Data, mimeType, fileName) {
  if (!folderId) throw new Error('folderId가 필요합니다.');
  if (!category) throw new Error('category가 필요합니다.');
  if (!isAllowedMimeType_(mimeType)) {
    throw new Error('이미지 또는 PDF 파일만 업로드할 수 있습니다.');
  }

  const decoded = Utilities.base64Decode(base64Data);
  if (decoded.length > MAX_FILE_BYTES) {
    throw new Error('파일 용량은 10MB를 초과할 수 없습니다.');
  }

  const folder = DriveApp.getFolderById(folderId);
  const blob = Utilities.newBlob(decoded, mimeType, category + '_' + fileName);
  const file = folder.createFile(blob);
  return { fileId: file.getId(), fileName: file.getName() };
}
```

- [ ] **Step 4: 통과 확인**

`Upload.gs`를 갱신하고 `test_uploadFile`을 다시 실행한다.

Expected: 로그에 `upload result: {"fileId":"...","fileName":"신분증_test.png"}`가 찍히고, `OK, zip 거부됨: 이미지 또는 PDF 파일만...` 로그가 이어진다. Drive의 `테스트사용자_01000000000` 폴더에 `신분증_test.png` 파일이 생겼는지 확인한다.

- [ ] **Step 5: 용량 초과 케이스 확인**

`Upload.gs`에 임시로 아래 함수를 추가해 실행한다(용량 제한 확인 후 삭제해도 되는 일회성 확인용):

```javascript
function test_uploadFile_sizeLimit() {
  const folderId = getOrCreateWorkerFolder('테스트사용자', '01000000000');
  const bigBytes = new Array(11 * 1024 * 1024).fill(0); // 11MB
  const bigBase64 = Utilities.base64Encode(bigBytes);
  try {
    uploadFile(folderId, '기타', bigBase64, 'image/png', 'big.png');
    Logger.log('FAIL: 11MB 파일이 거부되지 않음');
  } catch (e) {
    Logger.log('OK, 용량 초과 거부됨: ' + e.message);
  }
}
```

Expected: 로그에 `OK, 용량 초과 거부됨: 파일 용량은 10MB를 초과할 수 없습니다.`가 찍힌다. 확인 후 `test_uploadFile_sizeLimit` 함수는 지워도 된다.

- [ ] **Step 6: 커밋**

```bash
git add GetWorkerIdSite/Upload.gs
git commit -m "feat: GetWorkerIdSite uploadFile 구현 (형식/용량 검증 포함)"
```

---

### Task 4: `index.html` — 폼 마크업 + 클라이언트 검증

**Files:**
- Modify: `GetWorkerIdSite/index.html`

**Interfaces:**
- Consumes: 없음 (서버 호출 없음, 순수 클라이언트 로직)
- Produces:
  - DOM id: `nameInput`, `phoneInput`, `idCardInput`, `bankbookInput`, `healthCertInput`, `etcInput`, `errorMessage`, `submitButton`, `resultArea`
  - `CATEGORY_INPUTS`: `[{ category, inputId, required }]` 배열 (신분증/통장사본 `required: true`, 보건증/기타 `required: false`)
  - `isAllowedFile(file): boolean`
  - `collectFilesToUpload(): { name, phone, files: [{ category, file }] } | null` — 검증 실패 시 `errorMessage`에 메시지를 쓰고 `null` 반환
  - Task 5가 `collectFilesToUpload`와 위 DOM id들을 그대로 사용한다.

- [ ] **Step 1: 폼 마크업 작성**

`index.html`의 `<h1>서류 제출</h1>` 아래에 추가:

```html
<form id="uploadForm">
  <div>
    <label>이름 <input type="text" id="nameInput" required></label>
  </div>
  <div>
    <label>연락처 <input type="tel" id="phoneInput" required></label>
  </div>
  <div>
    <label>신분증 (필수)
      <input type="file" id="idCardInput" accept="image/*,application/pdf" multiple>
    </label>
  </div>
  <div>
    <label>통장사본 (필수)
      <input type="file" id="bankbookInput" accept="image/*,application/pdf" multiple>
    </label>
  </div>
  <div>
    <label>보건증 (선택)
      <input type="file" id="healthCertInput" accept="image/*,application/pdf" multiple>
    </label>
  </div>
  <div>
    <label>기타 서류 (선택)
      <input type="file" id="etcInput" accept="image/*,application/pdf" multiple>
    </label>
  </div>
  <div id="errorMessage" style="color:red;"></div>
  <button type="button" id="submitButton">제출</button>
</form>
<div id="resultArea"></div>
```

- [ ] **Step 2: 클라이언트 검증 스크립트 작성**

`</body>` 앞에 추가:

```html
<script>
  var MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
  var CATEGORY_INPUTS = [
    { category: '신분증', inputId: 'idCardInput', required: true },
    { category: '통장사본', inputId: 'bankbookInput', required: true },
    { category: '보건증', inputId: 'healthCertInput', required: false },
    { category: '기타', inputId: 'etcInput', required: false }
  ];

  function isAllowedFile(file) {
    return file.type === 'application/pdf' || file.type.indexOf('image/') === 0;
  }

  function collectFilesToUpload() {
    var errorEl = document.getElementById('errorMessage');
    errorEl.textContent = '';

    var name = document.getElementById('nameInput').value.trim();
    var phone = document.getElementById('phoneInput').value.trim();
    if (!name) { errorEl.textContent = '이름을 입력해 주세요.'; return null; }
    if (!phone) { errorEl.textContent = '연락처를 입력해 주세요.'; return null; }

    var files = [];
    for (var i = 0; i < CATEGORY_INPUTS.length; i++) {
      var spec = CATEGORY_INPUTS[i];
      var input = document.getElementById(spec.inputId);
      var selected = Array.prototype.slice.call(input.files);

      if (spec.required && selected.length === 0) {
        errorEl.textContent = spec.category + '을(를) 최소 1개 업로드해 주세요.';
        return null;
      }

      for (var j = 0; j < selected.length; j++) {
        var file = selected[j];
        if (!isAllowedFile(file)) {
          errorEl.textContent = file.name + ': 이미지 또는 PDF 파일만 업로드할 수 있습니다.';
          return null;
        }
        if (file.size > MAX_FILE_BYTES) {
          errorEl.textContent = file.name + ': 파일 용량은 10MB를 초과할 수 없습니다.';
          return null;
        }
        files.push({ category: spec.category, file: file });
      }
    }

    return { name: name, phone: phone, files: files };
  }

  document.getElementById('submitButton').addEventListener('click', function () {
    var collected = collectFilesToUpload();
    console.log('collected', collected);
  });
</script>
```

(`submitButton`의 클릭 핸들러는 Task 5에서 실제 업로드 로직으로 교체된다. 지금은 검증 로직만 눈으로 확인하기 위한 임시 콘솔 로그다.)

- [ ] **Step 3: 배포 후 수동 테스트**

`index.html`을 Apps Script 에디터에 반영하고 테스트 배포 URL을 새로고침한다. 브라우저 개발자 도구 콘솔을 열어둔 채로:

1. 아무것도 입력하지 않고 "제출" 클릭 → Expected: 화면에 "이름을 입력해 주세요." 표시
2. 이름/연락처만 입력하고 "제출" 클릭 → Expected: "신분증을(를) 최소 1개 업로드해 주세요." 표시
3. 이름/연락처 입력 + 신분증에 `.txt` 파일 선택 후 "제출" 클릭 → Expected: "...이미지 또는 PDF 파일만 업로드할 수 있습니다." 표시
4. 이름/연락처 입력 + 신분증·통장사본에 정상 이미지 파일 선택 후 "제출" 클릭 → Expected: 에러 메시지 없음, 콘솔에 `collected {name: "...", phone: "...", files: [...]}` 로그 출력 (files 배열에 category별 항목 포함)

- [ ] **Step 4: 커밋**

```bash
git add GetWorkerIdSite/index.html
git commit -m "feat: GetWorkerIdSite 업로드 폼 마크업 및 클라이언트 검증"
```

---

### Task 5: `index.html` — 제출 흐름 (폴더 생성 → 파일별 업로드 → 진행 상태/재시도)

**Files:**
- Modify: `GetWorkerIdSite/index.html`

**Interfaces:**
- Consumes:
  - 서버: `getOrCreateWorkerFolder(name, phone): string` (Task 2), `uploadFile(folderId, category, base64Data, mimeType, fileName): {fileId, fileName}` (Task 3)
  - 클라이언트: `collectFilesToUpload()`, DOM id들 (Task 4)
- Produces: `uploadOneFile(folderId, entry): Promise<boolean>`, `renderFileList(entries)`, 최종 `submitButton` 클릭 핸들러(제출 전체 흐름)

- [ ] **Step 1: 업로드 흐름 스크립트 작성**

Task 4에서 만든 `<script>` 블록 안의 임시 `submitButton` 클릭 핸들러(콘솔 로그만 찍는 부분)를 아래 코드로 통째로 교체한다:

```html
<script>
  function setStatus(entry, text) {
    entry.statusEl.textContent = text;
  }

  function uploadOneFile(folderId, entry) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function () {
        var base64Data = reader.result.split(',')[1];
        setStatus(entry, '업로드 중...');
        google.script.run
          .withSuccessHandler(function (result) {
            setStatus(entry, '성공: ' + result.fileName);
            entry.retryButton.style.display = 'none';
            resolve(true);
          })
          .withFailureHandler(function (error) {
            setStatus(entry, '실패: ' + error.message);
            entry.retryButton.style.display = 'inline';
            resolve(false);
          })
          .uploadFile(folderId, entry.category, base64Data, entry.file.type, entry.file.name);
      };
      reader.readAsDataURL(entry.file);
    });
  }

  function renderFileList(entries) {
    var resultArea = document.getElementById('resultArea');
    resultArea.innerHTML = '';
    entries.forEach(function (entry) {
      var row = document.createElement('div');
      row.textContent = entry.category + ' - ' + entry.file.name + ': ';

      var statusEl = document.createElement('span');
      statusEl.textContent = '대기';
      entry.statusEl = statusEl;

      var retryButton = document.createElement('button');
      retryButton.textContent = '재시도';
      retryButton.style.display = 'none';
      retryButton.addEventListener('click', function () {
        retryButton.style.display = 'none';
        uploadOneFile(entry.folderId, entry);
      });
      entry.retryButton = retryButton;

      row.appendChild(statusEl);
      row.appendChild(retryButton);
      resultArea.appendChild(row);
    });
  }

  document.getElementById('submitButton').addEventListener('click', function () {
    var collected = collectFilesToUpload();
    if (!collected) return;

    var submitButton = document.getElementById('submitButton');
    submitButton.disabled = true;
    renderFileList(collected.files);

    google.script.run
      .withSuccessHandler(function (folderId) {
        collected.files.forEach(function (entry) { entry.folderId = folderId; });

        var index = 0;
        var successCount = 0;
        var failCount = 0;

        function uploadNext() {
          if (index >= collected.files.length) {
            document.getElementById('errorMessage').textContent =
              '완료: 성공 ' + successCount + '건, 실패 ' + failCount + '건';
            submitButton.disabled = false;
            return;
          }
          var entry = collected.files[index];
          index++;
          uploadOneFile(folderId, entry).then(function (ok) {
            if (ok) { successCount++; } else { failCount++; }
            uploadNext();
          });
        }

        uploadNext();
      })
      .withFailureHandler(function (error) {
        document.getElementById('errorMessage').textContent = '폴더 생성 실패: ' + error.message;
        submitButton.disabled = false;
      })
      .getOrCreateWorkerFolder(collected.name, collected.phone);
  });
</script>
```

- [ ] **Step 2: 배포**

`index.html`을 Apps Script 에디터에 반영하고 테스트 배포 URL을 새로고침한다.

- [ ] **Step 3: 정상 제출 시나리오**

이름 "홍길동", 연락처 "01011112222" 입력 + 신분증에 이미지 파일 1개, 통장사본에 PDF 파일 1개 선택 후 "제출" 클릭.

Expected: 각 파일 옆에 "대기 → 업로드 중... → 성공: 신분증_...", "성공: 통장사본_..." 순서로 표시되고, 마지막에 "완료: 성공 2건, 실패 0건" 표시. Drive의 `ROOT_FOLDER_ID` 폴더 안에 `홍길동_01011112222` 폴더가 생기고 그 안에 두 파일이 저장돼 있다.

- [ ] **Step 4: 재제출(같은 이름+연락처) 시나리오**

같은 이름/연락처로 다른 파일 1개(예: 보건증)를 추가 제출.

Expected: 새 폴더가 생기지 않고 기존 `홍길동_01011112222` 폴더에 `보건증_...` 파일이 추가된다.

- [ ] **Step 5: 동명이인(다른 연락처) 시나리오**

이름은 "홍길동"으로 같지만 연락처를 다르게(예: "01033334444") 입력해 제출.

Expected: `홍길동_01033334444`라는 별도 폴더가 새로 생긴다.

- [ ] **Step 6: 항목당 다중 파일 시나리오**

신분증 항목에 이미지 파일 2개를 동시에 선택해 제출.

Expected: 두 파일 모두 각각 "성공"으로 표시되고 Drive 폴더에 `신분증_` 접두사를 가진 파일이 2개 저장된다.

- [ ] **Step 7: 폴더 생성 실패 시나리오**

Script Properties에서 `ROOT_FOLDER_ID` 값을 잠시 지운 뒤 제출.

Expected: "폴더 생성 실패: ROOT_FOLDER_ID가 설정되지 않았습니다..." 메시지가 표시되고 제출 버튼이 다시 활성화된다. 확인 후 `ROOT_FOLDER_ID`를 원래 값으로 복원한다.

- [ ] **Step 8: 개별 파일 실패 + 재시도 시나리오**

정상적으로 제출을 시작해 업로드가 진행되는 동안(여러 파일 선택), Drive에서 방금 생성된 `{이름}_{연락처}` 폴더를 휴지통으로 보내 강제로 실패를 유발한다.

Expected: 그 시점 이후 파일들의 상태가 "실패: ..."로 표시되고 옆에 "재시도" 버튼이 나타난다. Drive 휴지통에서 폴더를 복원한 뒤 "재시도" 버튼을 클릭하면 해당 파일만 다시 업로드되어 "성공"으로 바뀐다.

- [ ] **Step 9: 커밋**

```bash
git add GetWorkerIdSite/index.html
git commit -m "feat: GetWorkerIdSite 제출 흐름 (폴더 생성 후 파일별 순차 업로드 + 재시도)"
```
