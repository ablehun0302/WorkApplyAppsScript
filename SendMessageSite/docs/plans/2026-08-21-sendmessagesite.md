# SendMessageSite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자가 장소별로 근로자를 조회해 선택한 근로자에게 알리고(Aligo) API로 문자를 발송하는 별도 GAS 웹앱(`SendMessageSite`)을 만든다.

**Architecture:** 기존 근무신청시스템과 완전히 독립된 새 GAS 프로젝트. 로컬에는 `D:\WorkApplyWebsite\SendMessageSite\` 아래 `Code.gs`(인증/진입점), `Sms.gs`(장소별 조회 + 알리고 발송), `index.html`(UI) 세 파일만 새로 만든다. 루트의 `WorkSystemSheet.gs`(기존 공용 데이터 계층)는 두 프로젝트 모두에 수동 복사해 넣는 공용 파일이며, 이번 작업에서는 **읽기만 하고 수정하지 않는다**.

**Tech Stack:** Google Apps Script (server `.gs` + `HtmlService` 클라이언트), Aligo SMS REST API(`UrlFetchApp`), Google Sheets를 DB로 사용.

**Spec:** `D:\WorkApplyWebsite\SendMessageSite\docs\DESIGN.md` (참고: 이 계획 수립 이후 DESIGN.md의 SMS 발송사가 알리고 → SOLAPI로 변경됨. 아래 알리고 관련 내용은 최초 구현 당시 기록이며, 현재 스펙은 DESIGN.md의 변경 이력 섹션 참고)

## Global Constraints

- 이 저장소에는 빌드 도구/테스트 러너/`.clasp.json`이 전혀 없다 (`ApplyWorkerSite/docs/DESIGN.md`, `SendMessageSite/docs/DESIGN.md` 참고). GAS 코드는 로컬에서 실행할 수 없으므로, 각 작업의 "테스트"는 **Apps Script 편집기에서 수동으로 함수를 실행하고 실행 로그(Logger.log)를 확인하는 방식**이다. `npm test` 같은 명령은 존재하지 않는다.
- `WorkSystemSheet.gs`(루트)는 수정 금지. `getSpreadsheet_()`, `getDataSheet_()`, `getAdminData(adminPw)`, `LOCATIONS` 상수를 그대로 재사용한다.
- 장소 결정 규칙(기존 `rebuildLocationSheets_()`와 동일): `effectiveLocation = record.adminLocation || (record.locations[0] || '')`.
- `SendMessageSite`는 별도 GAS 프로젝트이므로 Script Properties도 독립적이다: `ADMIN_PASSWORD`, `SS_ID`, `ALIGO_API_KEY`, `ALIGO_USER_ID`, `ALIGO_SENDER`를 이 프로젝트에 별도로 설정해야 한다.
- 알리고 API 키는 현재 미보유 상태다. 키가 없어도 코드는 명확한 에러로 실패해야 하며, 실제 발송 성공 여부까지는 이 계획만으로 검증할 수 없다 (키 발급 후 사용자가 직접 확인).
- 알리고 `send/` API의 정확한 파라미터명(`key`, `user_id`, `sender`, `receiver`, `msg`, 응답의 `result_code`/`success_cnt`/`error_cnt`)은 알리고 공식 문서 기준 일반적인 규격을 따랐다. 실제 키 발급 후 알리고 문서와 대조해 필드명이 다르면 `buildAligoRequest_`와 응답 파싱 부분만 조정하면 된다(다른 코드에 영향 없음).

---

### Task 1: Code.gs — 관리자 인증 + 진입점

**Files:**
- Create: `SendMessageSite/Code.gs`
- Create: `SendMessageSite/index.html` (최소 스텁 — Task 4에서 완성)

**Interfaces:**
- Consumes: 없음 (최초 파일)
- Produces: `checkAdminPassword(pw)` → boolean, `requireAdmin_(pw)` → void|throws, `doGet()` → HtmlOutput.이후 모든 관리자 전용 함수(Task 2, 3)는 마지막 인자로 받은 `adminPw`를 `requireAdmin_(adminPw)`에 넘겨 검증한다.

- [ ] **Step 1: `SendMessageSite/Code.gs` 작성**

```javascript
// ===== 문자 발송 사이트 서버 코드 (Google Apps Script) =====

function checkAdminPassword(pw) {
  const props = PropertiesService.getScriptProperties();
  return pw === props.getProperty('ADMIN_PASSWORD');
}

// 관리자 전용 함수 진입 시 서버에서 비밀번호를 재검증 (UI 잠금만으로는 우회 가능하므로 필수)
function requireAdmin_(pw) {
  const props = PropertiesService.getScriptProperties();
  if (pw !== props.getProperty('ADMIN_PASSWORD')) throw new Error('관리자 인증이 필요합니다.');
}

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('문자 발송')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
```

- [ ] **Step 2: `SendMessageSite/index.html` 최소 스텁 작성** (Task 4에서 실제 UI로 교체)

```html
<!DOCTYPE html>
<html>
  <head><base target="_top"></head>
  <body>
    <p>SendMessageSite placeholder</p>
  </body>
</html>
```

- [ ] **Step 3: 수동 검증 (Apps Script 편집기)**

로컬에는 GAS 실행 환경이 없으므로, 이 저장소 파일들(`WorkSystemSheet.gs` + `SendMessageSite/Code.gs` + `SendMessageSite/index.html`)을 새 Apps Script 프로젝트에 붙여넣고 Script Properties에 임시로 `ADMIN_PASSWORD=test1234`를 설정한 뒤:

1. 편집기에서 다음 임시 함수를 추가로 붙여넣고 실행(▶):
   ```javascript
   function __test_auth() {
     Logger.log(checkAdminPassword('test1234')); // true 기대
     Logger.log(checkAdminPassword('wrong'));    // false 기대
     try {
       requireAdmin_('wrong');
       Logger.log('FAIL: should have thrown');
     } catch (e) {
       Logger.log('OK: ' + e.message);
     }
   }
   ```
2. 실행 로그(Ctrl+Enter 또는 보기 > 로그)에 `true`, `false`, `OK: 관리자 인증이 필요합니다.`가 순서대로 찍히는지 확인.
3. `__test_auth` 함수는 확인 후 삭제한다(커밋 대상 아님, 편집기에서만 임시로 사용).
4. 웹앱으로 배포(테스트 배포)해서 URL 접속 시 "SendMessageSite placeholder"가 뜨는지 확인.

- [ ] **Step 4: 커밋**

```bash
git add SendMessageSite/Code.gs SendMessageSite/index.html
git commit -m "feat: SendMessageSite 인증/진입점 추가"
```

---

### Task 2: Sms.gs — 장소별 근로자 조회

**Files:**
- Create: `SendMessageSite/Sms.gs`

**Interfaces:**
- Consumes: `WorkSystemSheet.gs`의 `getAdminData(adminPw)` (반환 필드: `key, name, phone, locations(array), adminLocation, ...`), `LOCATIONS` 상수. `Code.gs`의 `requireAdmin_(pw)`.
- Produces: `getWorkersByLocation(adminPw)` → `{ [locationName]: [{key, name, phone}] }` (Task 4의 `index.html`이 이 함수를 호출).

- [ ] **Step 1: `SendMessageSite/Sms.gs`에 `getWorkersByLocation` 작성**

```javascript
// ===== 문자 발송 사이트 — 장소별 조회 + 알리고 발송 =====

function getWorkersByLocation(adminPw) {
  requireAdmin_(adminPw);
  const records = getAdminData(adminPw);

  const groups = {};
  LOCATIONS.forEach(loc => { groups[loc] = []; });
  const UNASSIGNED = '미분류';
  groups[UNASSIGNED] = [];

  records.forEach(r => {
    const effectiveLocation = r.adminLocation || (r.locations[0] || '');
    const bucket = groups.hasOwnProperty(effectiveLocation) ? effectiveLocation : UNASSIGNED;
    groups[bucket].push({ key: r.key, name: r.name, phone: r.phone });
  });

  // 근로자가 한 명도 없는 장소 그룹은 제거 (빈 탭 방지)
  Object.keys(groups).forEach(loc => {
    if (groups[loc].length === 0) delete groups[loc];
  });

  return groups;
}
```

- [ ] **Step 2: 수동 검증 (Apps Script 편집기)**

`WorkSystemSheet.gs` + `Code.gs` + `Sms.gs`가 모두 있는 프로젝트에서, Script Properties의 `SS_ID`를 실제 `근무신청시스템_데이터` 스프레드시트 ID로 설정한 뒤:

```javascript
function __test_workers_by_location() {
  const groups = getWorkersByLocation('test1234'); // Task 1에서 설정한 임시 비밀번호
  Logger.log(JSON.stringify(groups, null, 2));
}
```

실행 후 로그에 찍힌 그룹핑 결과를, `Data` 시트를 직접 열어 몇 명의 `adminLocation`/`locationsJSON` 값과 대조해 다음을 확인한다:
1. `adminLocation`이 있는 근로자는 그 값의 그룹에 들어가는지
2. `adminLocation`이 없고 `locationsJSON`의 첫 값만 있는 근로자는 그 값의 그룹에 들어가는지
3. 둘 다 없는 근로자는 `미분류` 그룹에 들어가는지
4. 잘못된 비밀번호로 호출 시 예외가 발생하는지 (`getWorkersByLocation('wrong')`)

확인 후 `__test_workers_by_location` 함수는 삭제한다.

- [ ] **Step 3: 커밋**

```bash
git add SendMessageSite/Sms.gs
git commit -m "feat: SendMessageSite 장소별 근로자 조회 추가"
```

---

### Task 3: Sms.gs — 알리고 문자 발송

**Files:**
- Modify: `SendMessageSite/Sms.gs` (Task 2에서 만든 파일에 이어서 작성)

**Interfaces:**
- Consumes: `Code.gs`의 `requireAdmin_(pw)`. Script Properties의 `ALIGO_API_KEY`/`ALIGO_USER_ID`/`ALIGO_SENDER`.
- Produces: `buildAligoRequest_(phoneList, message)` → `{key, user_id, sender, receiver, msg}` (내부 헬퍼, 네트워크 호출 없이 페이로드만 구성 — 알리고 키 없이도 이 함수 자체는 키가 있을 때의 구조를 테스트 가능). `sendSms(phoneList, message, adminPw)` → `{success, successCount, errorCount, raw}` (Task 4의 `index.html`이 호출).

- [ ] **Step 1: `buildAligoRequest_`와 `sendSms`를 `SendMessageSite/Sms.gs`에 이어서 작성**

```javascript
function buildAligoRequest_(phoneList, message) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('ALIGO_API_KEY');
  const userId = props.getProperty('ALIGO_USER_ID');
  const sender = props.getProperty('ALIGO_SENDER');
  if (!apiKey || !userId || !sender) {
    throw new Error('알리고 연동 설정이 필요합니다. (ALIGO_API_KEY / ALIGO_USER_ID / ALIGO_SENDER)');
  }
  return {
    key: apiKey,
    user_id: userId,
    sender: sender,
    receiver: phoneList.join(','),
    msg: message
  };
}

function sendSms(phoneList, message, adminPw) {
  requireAdmin_(adminPw);
  if (!phoneList || phoneList.length === 0) throw new Error('발송 대상이 없습니다.');
  if (!message) throw new Error('메시지 내용이 없습니다.');

  const payload = buildAligoRequest_(phoneList, message);
  const response = UrlFetchApp.fetch('https://apis.aligo.in/send/', {
    method: 'post',
    payload: payload,
    muteHttpExceptions: true
  });
  const result = JSON.parse(response.getContentText());

  return {
    success: Number(result.result_code) > 0,
    successCount: Number(result.success_cnt) || 0,
    errorCount: Number(result.error_cnt) || 0,
    raw: result
  };
}
```

- [ ] **Step 2: 수동 검증 (Apps Script 편집기) — 키 미설정 상태**

`ALIGO_API_KEY` 등을 아직 설정하지 않은 상태(현재 실제 상황)에서:

```javascript
function __test_send_sms_no_key() {
  try {
    sendSms(['01000000000'], '테스트', 'test1234');
    Logger.log('FAIL: should have thrown');
  } catch (e) {
    Logger.log('OK: ' + e.message); // "알리고 연동 설정이 필요합니다..." 기대
  }
}
```

로그에 `OK: 알리고 연동 설정이 필요합니다...`가 찍히는지 확인.

- [ ] **Step 3: 수동 검증 (Apps Script 편집기) — 페이로드 구조 확인 (임시 값 사용, 실제 발송 없음)**

```javascript
function __test_build_aligo_request() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('ALIGO_API_KEY', 'dummy');
  props.setProperty('ALIGO_USER_ID', 'dummy');
  props.setProperty('ALIGO_SENDER', '0100000000');

  const payload = buildAligoRequest_(['01011112222', '01033334444'], '테스트 메시지');
  Logger.log(JSON.stringify(payload));
  // 기대: {"key":"dummy","user_id":"dummy","sender":"0100000000","receiver":"01011112222,01033334444","msg":"테스트 메시지"}

  props.deleteProperty('ALIGO_API_KEY');
  props.deleteProperty('ALIGO_USER_ID');
  props.deleteProperty('ALIGO_SENDER');
}
```

로그의 JSON 구조가 기대값과 일치하는지 확인한 뒤, 임시 함수(`__test_send_sms_no_key`, `__test_build_aligo_request`) 둘 다 삭제한다.

> 참고: 실제 알리고 키를 발급받으면 `ALIGO_API_KEY`/`ALIGO_USER_ID`/`ALIGO_SENDER`를 Script Properties에 정식으로 설정하고, 테스트 번호로 `sendSms`를 한 번 더 실행해 실제 발송 결과(`result_code`/`success_cnt`)가 알리고 콘솔의 발송 이력과 일치하는지 확인한다. 이 단계는 키가 없는 현재로서는 수행할 수 없다.

- [ ] **Step 4: 커밋**

```bash
git add SendMessageSite/Sms.gs
git commit -m "feat: SendMessageSite 알리고 문자 발송 추가"
```

---

### Task 4: index.html — 관리자 UI

**Files:**
- Modify: `SendMessageSite/index.html` (Task 1의 스텁을 전체 UI로 교체)

**Interfaces:**
- Consumes: `checkAdminPassword(pw)`, `getWorkersByLocation(adminPw)` (Task 2), `sendSms(phoneList, message, adminPw)` (Task 3). 모두 `google.script.run`으로 호출.
- Produces: 없음 (최종 UI, 이후 작업 없음)

- [ ] **Step 1: `SendMessageSite/index.html` 전체 UI로 교체**

```html
<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <meta charset="UTF-8">
  <style>
    body { font-family: sans-serif; margin: 16px; }
    #loginView input { padding: 8px; font-size: 16px; }
    #mainView { display: none; }
    .tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
    .tab { padding: 6px 10px; border: 1px solid #ccc; cursor: pointer; }
    .tab.active { background: #333; color: #fff; }
    .worker-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
    #messageBox { width: 100%; height: 100px; margin-top: 12px; }
    #result { margin-top: 12px; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div id="loginView">
    <h2>관리자 로그인</h2>
    <input id="pwInput" type="password" placeholder="비밀번호">
    <button onclick="login()">로그인</button>
    <div id="loginError" style="color:red;"></div>
  </div>

  <div id="mainView">
    <h2>문자 발송</h2>
    <div class="tabs" id="tabs"></div>
    <label><input type="checkbox" id="selectAll" onchange="toggleSelectAll()"> 전체선택</label>
    <div id="workerList"></div>
    <textarea id="messageBox" placeholder="보낼 메시지를 입력하세요"></textarea>
    <div>
      <button onclick="send()">발송</button>
    </div>
    <div id="result"></div>
  </div>

  <script>
    let adminPassword = '';
    let groups = {};
    let currentTab = '';

    function login() {
      const pw = document.getElementById('pwInput').value;
      google.script.run
        .withSuccessHandler(function (ok) {
          if (!ok) {
            document.getElementById('loginError').textContent = '비밀번호가 틀렸습니다.';
            return;
          }
          adminPassword = pw;
          document.getElementById('loginView').style.display = 'none';
          document.getElementById('mainView').style.display = 'block';
          loadWorkers();
        })
        .checkAdminPassword(pw);
    }

    function loadWorkers() {
      google.script.run
        .withSuccessHandler(function (result) {
          groups = result;
          const tabNames = Object.keys(groups);
          currentTab = tabNames[0] || '';
          renderTabs(tabNames);
          renderWorkers();
        })
        .withFailureHandler(function (err) {
          document.getElementById('result').textContent = '조회 실패: ' + err.message;
        })
        .getWorkersByLocation(adminPassword);
    }

    function renderTabs(tabNames) {
      const tabsEl = document.getElementById('tabs');
      tabsEl.innerHTML = '';
      tabNames.forEach(function (name) {
        const el = document.createElement('div');
        el.className = 'tab' + (name === currentTab ? ' active' : '');
        el.textContent = name + ' (' + groups[name].length + ')';
        el.onclick = function () {
          currentTab = name;
          renderTabs(tabNames);
          renderWorkers();
        };
        tabsEl.appendChild(el);
      });
    }

    function renderWorkers() {
      const listEl = document.getElementById('workerList');
      listEl.innerHTML = '';
      document.getElementById('selectAll').checked = false;
      (groups[currentTab] || []).forEach(function (w) {
        const row = document.createElement('div');
        row.className = 'worker-row';
        row.innerHTML =
          '<input type="checkbox" class="workerCheck" value="' + w.phone + '">' +
          '<span>' + w.name + ' (' + w.phone + ')</span>';
        listEl.appendChild(row);
      });
    }

    function toggleSelectAll() {
      const checked = document.getElementById('selectAll').checked;
      document.querySelectorAll('.workerCheck').forEach(function (cb) {
        cb.checked = checked;
      });
    }

    function send() {
      const phones = Array.from(document.querySelectorAll('.workerCheck:checked')).map(function (cb) {
        return cb.value;
      });
      const message = document.getElementById('messageBox').value;
      if (phones.length === 0) {
        document.getElementById('result').textContent = '발송 대상을 선택하세요.';
        return;
      }
      if (!message) {
        document.getElementById('result').textContent = '메시지를 입력하세요.';
        return;
      }
      document.getElementById('result').textContent = '발송 중...';
      google.script.run
        .withSuccessHandler(function (res) {
          document.getElementById('result').textContent =
            '발송 완료 — 성공 ' + res.successCount + '건, 실패 ' + res.errorCount + '건';
        })
        .withFailureHandler(function (err) {
          document.getElementById('result').textContent = '발송 실패: ' + err.message;
        })
        .sendSms(phones, message, adminPassword);
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: 수동 검증 (배포된 웹앱에서 브라우저로 직접 확인)**

`WorkSystemSheet.gs` + `SendMessageSite/Code.gs` + `SendMessageSite/Sms.gs` + `SendMessageSite/index.html`을 모두 넣은 Apps Script 프로젝트를 웹앱으로 테스트 배포한 뒤, 배포 URL에 접속해서:

1. 틀린 비밀번호 입력 → "비밀번호가 틀렸습니다." 표시 확인
2. 올바른 비밀번호(Script Properties의 `ADMIN_PASSWORD`) 입력 → 장소 탭과 근로자 목록이 뜨는지 확인, `Data` 시트 내용과 대조
3. 탭 전환 시 목록이 바뀌는지, 전체선택 체크박스가 동작하는지 확인
4. 브라우저 개발자 도구 콘솔에서 로그인 없이 `google.script.run.getWorkersByLocation()`을 직접 호출 → 서버에서 거부(에러)되는지 확인 (DESIGN.md 테스트 체크리스트 1번)
5. 메시지 없이/대상 없이 발송 버튼 클릭 시 안내 문구가 뜨는지 확인
6. 대상 선택 + 메시지 입력 후 발송 클릭 → 알리고 키가 아직 없으므로 "발송 실패: 알리고 연동 설정이 필요합니다..." 메시지가 뜨는지 확인 (정상 동작)

- [ ] **Step 3: 커밋**

```bash
git add SendMessageSite/index.html
git commit -m "feat: SendMessageSite 관리자 UI 추가"
```

---

## Self-Review 결과

- **스펙 커버리지**: DESIGN.md의 프로젝트 구조(Task 1), `getWorkersByLocation`(Task 2), `sendSms`(Task 3), UI 5단계(Task 4), 테스트 체크리스트 1~4번(Task 1/2/4의 수동 검증 단계에 반영)을 모두 다룸. 체크리스트 5번(실제 발송 확인)은 알리고 키가 없어 이 계획 범위에서 수행 불가 — Task 3 Step 3의 참고 문구로 명시.
- **플레이스홀더 스캔**: TBD/TODO 없음. Task 1의 `index.html` 스텁은 Task 4에서 전체 교체됨을 명시.
- **타입/시그니처 일관성**: `getWorkersByLocation(adminPw)` 반환 형태(`{key,name,phone}` 배열의 맵)와 `sendSms(phoneList, message, adminPw)` 반환 형태(`{success,successCount,errorCount,raw}`)가 Task 2/3 정의와 Task 4의 `index.html` 사용부에서 동일하게 일치함을 확인.
