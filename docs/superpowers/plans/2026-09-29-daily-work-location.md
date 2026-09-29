# 날짜별 근무지 신청 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 근무자가 근무지를 날짜마다 다르게 신청하고, 관리자가 배치판에서 날짜별 근무지를 보고 바꿀 수 있게 한다.

**Architecture:** `Data` 시트 F열 `shiftsJSON`의 날짜 항목에 `location`을 추가하되, 기본 근무지(H열 → G열 첫값)와 다를 때만 저장한다. 값이 없으면 기본 근무지로 떨어지므로 기존 데이터는 마이그레이션 없이 그대로 동작한다. 흩어져 있던 `adminLocation || locations[0]` 계산을 날짜 인자를 받는 헬퍼 하나로 모으고, 서버·클라이언트 각각에 둔다.

**Tech Stack:** Google Apps Script (`.gs`), GAS HTML Service 템플릿(`.html` 안의 인라인 JS), Google Sheets를 데이터 저장소로 사용. 빌드 도구·패키지 매니저·테스트 러너 없음.

**Spec:** `docs/superpowers/specs/2026-09-29-daily-work-location-design.md`

## Global Constraints

- **테스트 코드를 작성하지 않는다.** 이 프로젝트엔 테스트 러너가 없고, 검증은 배포 후 수동 체크리스트로 한다(스펙의 "검증 체크리스트"). 각 태스크의 검증 단계는 체크리스트 항목을 직접 확인하는 것이다.
- 관리자 전용 서버 함수는 첫 줄에서 `requireAdmin_(adminPw)`를 호출한다. 클라이언트는 `adminRun()` 또는 `runScript(...)`로 호출하며 마지막 인자로 `adminPassword`를 넘긴다.
- `Data` 시트를 읽고 쓰는 구간은 `LockService.getScriptLock()` + `waitLock(30000)`으로 감싸고 `finally`에서 `releaseLock()` 한다 (`saveRecord():434`의 기존 패턴).
- `JSON.parse` 실패는 삼키고 로그만 남긴다: `catch (e) { Logger.log('실패 원인: ' + e.message); }` (`getKeyToLocationMap_():735`의 기존 패턴).
- 주석은 한국어로, "왜"를 적는다. 기존 코드의 주석 밀도와 어조를 따른다.
- `LOCATIONS` 상수는 `WorkSystemSheet.gs:3`과 `ApplyWorkerSite/SharedScript.html:3`에 같은 값으로 중복 정의되어 있다. 이번 작업에서 통합하지 않고 그대로 둔다.
- `Data` 시트 컬럼 인덱스(0-based): 0 key, 1 name, 2 phone, 3 pin, 4 updatedAt, 5 shiftsJSON, 6 locationsJSON, 7 adminLocation, 8 message, 9 gender, 10 adminGender, 11 adConsent. `getRange`의 열 번호는 1-based이므로 F열은 6, G열은 7, H열은 8이다.
- `Assign` 시트 K열(근무지)은 `getRange(row, 11)`이다.

## Review Focus

- **`Assign` K열이 빈 옛 배치 기록** — K열은 나중에 추가된 컬럼이라 그 이전 기록은 비어 있다. 폴백 없이 `a.location`만 보면 옛 배치가 모든 근무지 탭에서 사라진다. Task 4에서 폴백을 넣고 검증한다.
- **같은 날 주간·야간이 둘 다 배치된 상태에서 근무지 변경** — `Assign`에 두 행이 있으므로 한 행만 갱신하면 주간과 야간의 근무지가 어긋난다. Task 3에서 날짜가 일치하는 모든 행을 갱신한다.
- **`LOCATIONS`에 없는 근무지 값** — 근무지 목록이 바뀌면 과거 값이 목록에 없을 수 있다. `<select>`에 해당 `<option>`이 없으면 브라우저가 첫 항목을 고르므로, 화면을 열기만 해도 근무지가 조용히 바뀐 것처럼 보인다. Task 7에서 목록에 없는 값은 옵션을 덧붙여 보존한다.
- **신청하지 않은 날짜에 `setShiftLocation` 호출** — 배치판에서 근무지를 바꾸는 사이 근무자가 그 날짜 신청을 취소할 수 있다. Task 3에서 대상 항목이 없으면 `false`를 반환하고 시트를 건드리지 않는다.
- **손상된 `shiftsJSON`** — 파싱에 실패하면 그 근무자의 모든 날짜가 조용히 사라진다. Task 1·3에서 `try/catch`로 감싸 빈 배열로 떨어뜨리고 로그를 남긴다.

---

### Task 1: 서버 — 날짜별 실효 근무지 계산과 배치 기록 반영

**Files:**
- Modify: `WorkSystemSheet.gs:729-739` (`getKeyToLocationMap_` 교체)
- Modify: `WorkSystemSheet.gs:770` (`saveAssignment`)
- Modify: `WorkSystemSheet.gs:792,797` (`batchSaveAssignments`)

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  - `effectiveLocationOf_(shifts, adminLocation, locations, dateStr) -> string`
  - `makeLocationLookup_() -> function(key, dateStr) -> string`

- [ ] **Step 1: `getKeyToLocationMap_`을 날짜를 받는 버전으로 교체**

`WorkSystemSheet.gs:727-739`의 다음 블록을 통째로 바꾼다.

기존:

```js
// ---- 배치 관련 ----
// Data 시트 기준 근로자별 신청 근무지(adminLocation 우선, 없으면 첫 신청 근무지)를 일괄 조회
function getKeyToLocationMap_() {
  const sheet = getDataSheet_();
  const data = sheet.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < data.length; i++) {
    let locations = [];
    try { locations = JSON.parse(data[i][6] || '[]'); } catch (e) { Logger.log('실패 원인: ' + e.message); }
    map[data[i][0]] = data[i][7] || locations[0] || '';
  }
  return map;
}
```

교체:

```js
// ---- 배치 관련 ----
// 그 날짜에 실제로 적용되는 근무지. shifts에 location이 지정된 날은 그 값이 우선하고,
// 없으면 기본 근무지(관리자 지정 → 근무자가 고른 첫 신청 장소)로 떨어진다.
function effectiveLocationOf_(shifts, adminLocation, locations, dateStr) {
  const found = (shifts || []).filter(function (s) { return s.date === dateStr; })[0];
  return (found && found.location) || adminLocation || (locations && locations[0]) || '';
}

// Data 시트를 한 번만 읽어두고 (key, 날짜) → 실효 근무지를 돌려주는 함수를 만든다.
// 배치 건마다 시트를 다시 읽지 않기 위해 조회 함수 형태로 반환한다.
function makeLocationLookup_() {
  const sheet = getDataSheet_();
  const data = sheet.getDataRange().getValues();
  const byKey = {};
  for (let i = 1; i < data.length; i++) {
    let shifts = [];
    let locations = [];
    try { shifts = JSON.parse(data[i][5] || '[]'); } catch (e) { Logger.log('실패 원인: ' + e.message); }
    try { locations = JSON.parse(data[i][6] || '[]'); } catch (e) { Logger.log('실패 원인: ' + e.message); }
    byKey[data[i][0]] = { shifts: shifts, adminLocation: data[i][7] || '', locations: locations };
  }
  return function (key, dateStr) {
    const rec = byKey[key];
    if (!rec) return '';
    return effectiveLocationOf_(rec.shifts, rec.adminLocation, rec.locations, dateStr);
  };
}
```

- [ ] **Step 2: `saveAssignment`이 그 날짜의 근무지를 기록하게 한다**

`WorkSystemSheet.gs:770` 한 줄을 바꾼다.

기존:

```js
    const location = getKeyToLocationMap_()[key] || '';
```

교체:

```js
    const location = makeLocationLookup_()(key, date) || '';
```

- [ ] **Step 3: `batchSaveAssignments`도 같이 바꾼다**

`WorkSystemSheet.gs:792`:

```js
    const keyToLocation = getKeyToLocationMap_();
```

교체:

```js
    const locationAt = makeLocationLookup_();
```

`WorkSystemSheet.gs:797`의 `rowData`에서 K열 값 부분만 바꾼다.

기존:

```js
      const rowData = [assignKey, item.date, item.shift, item.key, item.name, assignGender, item.floor, !!item.isEducation, !!item.isNew, !!item.isWomenWage, keyToLocation[item.key] || '', item.transport || ''];
```

교체:

```js
      const rowData = [assignKey, item.date, item.shift, item.key, item.name, assignGender, item.floor, !!item.isEducation, !!item.isNew, !!item.isWomenWage, locationAt(item.key, item.date) || '', item.transport || ''];
```

- [ ] **Step 4: `getKeyToLocationMap_` 호출부가 남아있지 않은지 확인**

Run: `grep -rn "getKeyToLocationMap_" .`
Expected: 결과 없음. 하나라도 남아 있으면 그 호출부도 `makeLocationLookup_()`으로 바꾼다.

- [ ] **Step 5: 배포하고 회귀를 확인한다**

GAS 편집기에 `WorkSystemSheet.gs`를 반영하고 웹앱을 새로 배포한다. 관리자 화면에서 확인:

- 날짜별 근무지를 한 번도 지정하지 않은 근무자를 배치하면 `Assign` K열에 전과 같은 근무지가 들어간다
- 일괄배치도 같은 값이 들어간다
- 배치판·집계표가 전과 동일하게 보인다

- [ ] **Step 6: 커밋**

```bash
git add WorkSystemSheet.gs
git commit -m "배치 기록의 근무지를 날짜별로 판단하도록 서버 헬퍼 교체"
```

---

### Task 2: 서버 — `shifts`를 덮어쓸 때 날짜별 근무지 보존

**Files:**
- Modify: `WorkSystemSheet.gs:564-571` (`adminUpdateShifts`)
- Modify: `WorkSystemSheet.gs:392-408` (`batchSaveRecords`)

**Interfaces:**
- Consumes: 없음
- Produces: `mergeShiftLocations_(oldShifts, newShifts) -> Array`

관리자 화면 세 곳(신청날짜 수정 모드, 일정수정 오버레이, 근무자 추가 오버레이)이 `shifts`를 `{date, day, night}`만으로 다시 만들어 통째로 덮어쓴다. 클라이언트 세 군데를 각각 고치는 대신 서버에서 병합한다. 앞으로 비슷한 경로가 생겨도 자동으로 보호된다.

- [ ] **Step 1: 병합 헬퍼를 추가한다**

`WorkSystemSheet.gs`의 `adminUpdateShifts` 바로 위(`:562`의 주석 앞)에 넣는다.

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

- [ ] **Step 2: `adminUpdateShifts`가 병합해서 저장하게 한다**

`WorkSystemSheet.gs:564-571` 전체를 바꾼다.

기존:

```js
function adminUpdateShifts(key, shifts, adminPw) {
  requireAdmin_(adminPw);
  const sheet = getDataSheet_();
  const row = findRow_(sheet, 0, key);
  if (row === -1) return false;
  sheet.getRange(row, 6).setValue(JSON.stringify(shifts));
  return true;
}
```

교체:

```js
function adminUpdateShifts(key, shifts, adminPw) {
  requireAdmin_(adminPw);
  const sheet = getDataSheet_();
  const row = findRow_(sheet, 0, key);
  if (row === -1) return false;
  let oldShifts = [];
  try { oldShifts = JSON.parse(sheet.getRange(row, 6).getValue() || '[]'); } catch (e) { Logger.log('실패 원인: ' + e.message); }
  sheet.getRange(row, 6).setValue(JSON.stringify(mergeShiftLocations_(oldShifts, shifts)));
  return true;
}
```

- [ ] **Step 3: `batchSaveRecords`도 병합하게 한다**

`WorkSystemSheet.gs:392-408`의 `list.forEach` 블록에서 기존 값을 읽는 부분과 `rowData` 조립 부분을 바꾼다.

기존:

```js
      let existingAdminLocation = '';
      let existingAdminGender = '';
      let existingAdConsent = '';
      if (row) {
        // 위에서 이미 읽어둔 data 배열에 있는 값이므로 getRange().getValue()로 다시 조회하지 않는다.
        existingAdminLocation = data[row - 1][7] || '';
        existingAdminGender = data[row - 1][10] || '';
        existingAdConsent = data[row - 1][11] || '';
      }
      const rowData = [
        key, (item.name || '').trim(), toTextCell_((item.phone || '').trim()), toTextCell_((item.pin || '').trim()), now,
        JSON.stringify(item.shifts || []), JSON.stringify(item.locations || []),
        existingAdminLocation, '', item.gender || '', existingAdminGender, existingAdConsent
      ];
```

교체:

```js
      let existingAdminLocation = '';
      let existingAdminGender = '';
      let existingAdConsent = '';
      let existingShifts = [];
      if (row) {
        // 위에서 이미 읽어둔 data 배열에 있는 값이므로 getRange().getValue()로 다시 조회하지 않는다.
        existingAdminLocation = data[row - 1][7] || '';
        existingAdminGender = data[row - 1][10] || '';
        existingAdConsent = data[row - 1][11] || '';
        try { existingShifts = JSON.parse(data[row - 1][5] || '[]'); } catch (e) { Logger.log('실패 원인: ' + e.message); }
      }
      const rowData = [
        key, (item.name || '').trim(), toTextCell_((item.phone || '').trim()), toTextCell_((item.pin || '').trim()), now,
        JSON.stringify(mergeShiftLocations_(existingShifts, item.shifts || [])), JSON.stringify(item.locations || []),
        existingAdminLocation, '', item.gender || '', existingAdminGender, existingAdConsent
      ];
```

- [ ] **Step 4: 배포하고 확인한다**

`Data` 시트에서 근무자 한 명의 F열을 직접 편집해 한 날짜에 `"location":"BGF푸드_진천"`을 넣어둔 뒤:

- 관리자 화면 "신청날짜 수정" 모드로 그 사람의 **다른** 날짜를 토글하고 저장 → F열의 `location`이 남아 있다
- "일정수정" 오버레이로 저장 → `location`이 남아 있다
- 근무자 추가 오버레이에 그 사람 이름을 입력해 불러오고 저장 → `location`이 남아 있다

- [ ] **Step 5: 커밋**

```bash
git add WorkSystemSheet.gs
git commit -m "관리자 화면이 shifts를 덮어써도 날짜별 근무지가 지워지지 않게 병합"
```

---

### Task 3: 서버 — `setShiftLocation` 추가

**Files:**
- Modify: `WorkSystemSheet.gs` (`setAdminLocation():640` 뒤에 추가)

**Interfaces:**
- Consumes: `findRow_`, `getDataSheet_`, `getAssignSheet_`, `toDateStr_` (모두 기존 함수)
- Produces:
  - `setShiftLocation(key, date, location, adminPw) -> boolean`
  - `updateAssignLocation_(key, date, location) -> void`

- [ ] **Step 1: 함수를 추가한다**

`WorkSystemSheet.gs`의 `setAdminLocation` 함수(`:640-648`) 바로 뒤에 넣는다.

```js
// 관리자가 배치판 날짜 칸에서 그 날짜만의 근무지를 지정/해제한다.
// 기본 근무지와 같은 값을 고르면 예외를 해제(location 삭제)하는 것으로 본다.
function setShiftLocation(key, date, location, adminPw) {
  requireAdmin_(adminPw);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let effective = '';
  try {
    const sheet = getDataSheet_();
    const row = findRow_(sheet, 0, key);
    if (row === -1) return false;

    let shifts = [];
    try { shifts = JSON.parse(sheet.getRange(row, 6).getValue() || '[]'); } catch (e) { Logger.log('실패 원인: ' + e.message); }
    const target = shifts.filter(function (s) { return s.date === date; })[0];
    // 근무지를 바꾸는 사이 근무자가 그 날짜 신청을 취소했을 수 있다. 없는 날짜는 만들지 않는다.
    if (!target) return false;

    let locations = [];
    try { locations = JSON.parse(sheet.getRange(row, 7).getValue() || '[]'); } catch (e) { Logger.log('실패 원인: ' + e.message); }
    const baseLocation = sheet.getRange(row, 8).getValue() || locations[0] || '';

    if (!location || location === baseLocation) delete target.location;
    else target.location = location;

    sheet.getRange(row, 6).setValue(JSON.stringify(shifts));
    effective = target.location || baseLocation;
  } finally {
    lock.releaseLock();
  }
  updateAssignLocation_(key, date, effective);
  return true;
}

// 이미 배치된 날짜의 근무지를 관리자가 바꿨으면 Assign 시트 K열도 맞춰준다.
// 같은 날 주간/야간이 둘 다 배치돼 있으면 두 행 모두 갱신해야 근무지가 어긋나지 않는다.
function updateAssignLocation_(key, date, location) {
  const sheet = getAssignSheet_();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][3] === key && toDateStr_(data[i][1]) === date) {
      sheet.getRange(i + 1, 11).setValue(location);
    }
  }
}
```

- [ ] **Step 2: GAS 편집기에서 직접 호출해 확인한다**

GAS 편집기에 임시 함수를 만들어 실행한다(확인 후 삭제).

```js
function tmpTestSetShiftLocation() {
  const key = '여기에 Data 시트 A열의 key를 붙여넣기';
  const pw = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  Logger.log(setShiftLocation(key, '2026-09-30', 'BGF푸드_진천', pw));
}
```

확인 항목:

- F열 해당 날짜 항목에 `"location":"BGF푸드_진천"`이 들어간다
- 기본 근무지와 같은 값을 넣어 다시 호출하면 `location` 키가 사라진다
- 신청하지 않은 날짜를 넣으면 `false`가 반환되고 F열이 그대로다
- 그 날짜에 주간·야간이 둘 다 배치된 상태로 호출하면 `Assign` K열 두 행이 모두 바뀐다

- [ ] **Step 3: 임시 함수를 지우고 커밋**

```bash
git add WorkSystemSheet.gs
git commit -m "관리자가 날짜별 근무지를 지정하는 setShiftLocation 추가"
```

---

### Task 4: 관리자 — 실효 근무지 헬퍼와 배치판 필터

**Files:**
- Modify: `ApplyWorkerSite/AdminView.html:279-282` (`workerLocation`)
- Modify: `ApplyWorkerSite/AdminView.html:487` (`showFloorMenu` 호출부)
- Modify: `ApplyWorkerSite/AdminView.html:2255-2320` (`renderAdmin`)
- Modify: `ApplyWorkerSite/AdminView.html:2120,2140-2141` (`buildAssignBoard` 시그니처)
- Modify: `ApplyWorkerSite/AdminView.html:2016,2025,2050,2060` (`buildShiftBlock`)

**Interfaces:**
- Consumes: 없음 (클라이언트 자체 헬퍼)
- Produces:
  - `effectiveLocation(rec, dateStr) -> string`
  - `locationMatches(rec, dateStr) -> boolean`
  - `assignmentLocation(a, recByKey) -> string`
  - `workerLocation(key, dateStr) -> string` (시그니처 변경)

- [ ] **Step 1: 헬퍼 세 개를 추가하고 `workerLocation`을 바꾼다**

`AdminView.html:279-282`를 바꾼다.

기존:

```js
function workerLocation(key) {
  const rec = lastRecords.find(r => r.key === key);
  return rec ? (rec.adminLocation || (rec.locations && rec.locations[0]) || '') : '';
}
```

교체:

```js
// 그 날짜에 실제로 적용되는 근무지. shifts에 location이 지정된 날은 그 값이 우선하고,
// 없으면 기본 근무지(관리자 지정 → 근무자가 고른 첫 신청 장소)로 떨어진다.
function effectiveLocation(rec, dateStr) {
  if (!rec) return '';
  const found = (rec.shifts || []).find(s => s.date === dateStr);
  return (found && found.location) || rec.adminLocation || (rec.locations && rec.locations[0]) || '';
}
// 현재 선택된 근무지 탭에 이 날짜가 속하는지. '전체' 탭이면 모든 날짜가 속한다.
function locationMatches(rec, dateStr) {
  return currentLocationFilter === '전체' || effectiveLocation(rec, dateStr) === currentLocationFilter;
}
// 배치 기록의 근무지. 배치 당시 Assign K열에 박아둔 값이 기준이라, 근무자가 나중에 신청
// 근무지를 바꿔도 확정된 배치는 그 탭에 남는다. K열이 없던 시절의 옛 기록만 Data로 폴백한다.
function assignmentLocation(a, recByKey) {
  return a.location || effectiveLocation(recByKey && recByKey[a.key], a.date);
}
function workerLocation(key, dateStr) {
  return effectiveLocation(lastRecords.find(r => r.key === key), dateStr);
}
```

`effectiveLocation`이 `currentLocationFilter`를 참조하는 `locationMatches`보다 앞에 있어야 하는 건 아니지만(함수 선언은 호이스팅됨), `currentLocationFilter`는 `:291`에서 선언되므로 `locationMatches`를 호출하는 시점이 그 뒤여야 한다. 렌더 함수들은 모두 그 뒤에 실행되므로 문제없다.

- [ ] **Step 2: `showFloorMenu`가 그날 근무지로 층 목록을 고르게 한다**

`AdminView.html:487`:

기존:

```js
  const loc = workerLocation(key);
```

교체:

```js
  const loc = workerLocation(key, dateStr);
```

- [ ] **Step 3: `renderAdmin`의 필터를 날짜별로 바꾼다**

`AdminView.html:2262-2314`를 바꾼다.

기존:

```js
  const filteredRecords = (currentLocationFilter === '전체')
    ? (records || [])
    : (records || []).filter(rec => {
        const effective = rec.adminLocation || (rec.locations && rec.locations[0]) || '';
        return effective === currentLocationFilter;
      });

  const byDate = {};
  filteredRecords.forEach(rec => {
    const loc = rec.adminLocation || (rec.locations && rec.locations[0]) || '';
    const gnd = rec.adminGender || rec.gender || '';
    (rec.shifts||[]).forEach(s => {
      if (!byDate[s.date]) byDate[s.date] = { day: [], night: [] };
      if (s.day) byDate[s.date].day.push({ key: rec.key, name: rec.name, pin: rec.pin || '', location: loc, gender: gnd });
      if (s.night) byDate[s.date].night.push({ key: rec.key, name: rec.name, pin: rec.pin || '', location: loc, gender: gnd });
    });
  });
```

교체:

```js
  // 근무지가 날짜마다 다를 수 있으므로 "이 사람이 이 탭 소속인가"가 아니라
  // "이 탭에 해당하는 날짜가 하루라도 있는가"로 거른다.
  const filteredRecords = (currentLocationFilter === '전체')
    ? (records || [])
    : (records || []).filter(rec => (rec.shifts || []).some(s => locationMatches(rec, s.date)));

  const byDate = {};
  filteredRecords.forEach(rec => {
    const gnd = rec.adminGender || rec.gender || '';
    (rec.shifts||[]).forEach(s => {
      if (!locationMatches(rec, s.date)) return;
      const loc = effectiveLocation(rec, s.date);
      if (!byDate[s.date]) byDate[s.date] = { day: [], night: [] };
      if (s.day) byDate[s.date].day.push({ key: rec.key, name: rec.name, pin: rec.pin || '', location: loc, gender: gnd });
      if (s.night) byDate[s.date].night.push({ key: rec.key, name: rec.name, pin: rec.pin || '', location: loc, gender: gnd });
    });
  });
```

기존 (`:2288-2297`):

```js
  const keyToLocation = {};
  const keyToPin = {};
  const keyToWeek1Count = {};
  const keyToWeek2Count = {};
  (records || []).forEach(rec => {
    keyToLocation[rec.key] = rec.adminLocation || (rec.locations && rec.locations[0]) || '';
    keyToPin[rec.key] = rec.pin || '';
    keyToWeek1Count[rec.key] = (rec.shifts || []).filter(s => week1Set.has(s.date)).length;
    keyToWeek2Count[rec.key] = (rec.shifts || []).filter(s => week2Set.has(s.date)).length;
  });
```

교체:

```js
  const recByKey = {};
  const keyToPin = {};
  const keyToWeek1Count = {};
  const keyToWeek2Count = {};
  (records || []).forEach(rec => {
    recByKey[rec.key] = rec;
    keyToPin[rec.key] = rec.pin || '';
    keyToWeek1Count[rec.key] = (rec.shifts || []).filter(s => week1Set.has(s.date)).length;
    keyToWeek2Count[rec.key] = (rec.shifts || []).filter(s => week2Set.has(s.date)).length;
  });
```

기존 (`:2305-2314`):

```js
  // 배치 기록은 행마다 근무지를 판단한다. Data에 있는 근무자는 현재 근무지 기준으로 거르고,
  // 신청 전체 취소로 Data에서 사라진 근무자는 배치 당시 Assign에 저장된 근무지 기준으로 거른다.
  const boardAssignments = (currentLocationFilter === '전체') ? (assignments || []) : (assignments || []).filter(a => {
    const loc = keyToLocation.hasOwnProperty(a.key) ? keyToLocation[a.key] : a.location;
    return loc === currentLocationFilter;
  });
  const allowedKeys = (currentLocationFilter === '전체') ? null : new Set(
    filteredRecords.map(r => r.key).concat(boardAssignments.map(a => a.key))
  );
  html += buildAssignBoard(allDates, byDate, boardAssignments, targets || [], allowedKeys, keyToLocation, keyToPin, keyToWeek1Count, keyToWeek2Count, week1Set);
```

교체:

```js
  // 배치 기록은 배치 당시 Assign K열에 저장된 근무지로 거른다. 근무자가 나중에 신청 근무지를
  // 바꿔도 확정된 배치가 다른 탭으로 옮겨가지 않게 하기 위해서다.
  const boardAssignments = (currentLocationFilter === '전체') ? (assignments || [])
    : (assignments || []).filter(a => assignmentLocation(a, recByKey) === currentLocationFilter);
  const allowedKeys = (currentLocationFilter === '전체') ? null : new Set(
    filteredRecords.map(r => r.key).concat(boardAssignments.map(a => a.key))
  );
  html += buildAssignBoard(allDates, byDate, boardAssignments, targets || [], allowedKeys, recByKey, keyToPin, keyToWeek1Count, keyToWeek2Count, week1Set);
```

- [ ] **Step 4: `buildAssignBoard`와 `buildShiftBlock`의 파라미터 이름을 맞춘다**

`AdminView.html:2120`:

기존:

```js
function buildAssignBoard(allDates, byDate, assignments, targets, allowedKeys, keyToLocation, keyToPin, keyToWeek1Count, keyToWeek2Count, week1Set) {
```

교체:

```js
function buildAssignBoard(allDates, byDate, assignments, targets, allowedKeys, recByKey, keyToPin, keyToWeek1Count, keyToWeek2Count, week1Set) {
```

`AdminView.html:2140-2141`:

기존:

```js
    html += buildShiftBlock(dateStr, 'day', dayApplicants, assignments, dayTarget, allowedKeys, keyToLocation, keyToPin, keyToTotalCount);
    html += buildShiftBlock(dateStr, 'night', nightApplicants, assignments, nightTarget, allowedKeys, keyToLocation, keyToPin, keyToTotalCount);
```

교체:

```js
    html += buildShiftBlock(dateStr, 'day', dayApplicants, assignments, dayTarget, allowedKeys, recByKey, keyToPin, keyToTotalCount);
    html += buildShiftBlock(dateStr, 'night', nightApplicants, assignments, nightTarget, allowedKeys, recByKey, keyToPin, keyToTotalCount);
```

`AdminView.html:2016`:

기존:

```js
function buildShiftBlock(dateStr, shift, applicants, assignments, target, allowedKeys, keyToLocation, keyToPin, keyToTotalCount) {
```

교체:

```js
function buildShiftBlock(dateStr, shift, applicants, assignments, target, allowedKeys, recByKey, keyToPin, keyToTotalCount) {
```

- [ ] **Step 5: `buildShiftBlock` 안의 근무지 참조 세 곳을 바꾼다**

`AdminView.html:2025`:

기존:

```js
  const locOf = (a) => (keyToLocation && keyToLocation[a.key]) || a.location;
```

교체:

```js
  const locOf = (a) => assignmentLocation(a, recByKey);
```

`AdminView.html:2050`과 `:2060`은 같은 내용의 줄이다. 둘 다 바꾼다.

기존:

```js
    const locTag = (currentLocationFilter === '전체' && keyToLocation && keyToLocation[a.key]) ? ` <span class="loc-badge">${keyToLocation[a.key]}</span>` : '';
```

교체:

```js
    const locTag = (currentLocationFilter === '전체' && assignmentLocation(a, recByKey)) ? ` <span class="loc-badge">${assignmentLocation(a, recByKey)}</span>` : '';
```

- [ ] **Step 6: `keyToLocation`이 남아있지 않은지 확인**

Run: `grep -n "keyToLocation" ApplyWorkerSite/AdminView.html`
Expected: 결과 없음.

- [ ] **Step 7: 배포하고 확인한다**

`Data` 시트에서 근무자 한 명의 F열 한 날짜에 `"location"`을 직접 넣어 기본 근무지와 다르게 만든 뒤 관리자 화면에서 확인:

- 그 날짜가 지정한 근무지 탭의 배치판에 나타나고, 기본 근무지 탭에서는 그 날짜만 빠진다
- 두 탭의 "신청자 집계(배치전)" 숫자가 각각 맞다
- 미배치 칩의 층 드롭다운이 그날 근무지의 층 목록을 보여준다(델몬트_원남이면 증평·음성·괴산…)
- 델몬트_원남으로 지정한 날짜의 칩에만 이동수단 드롭다운이 나타난다
- **K열이 빈 옛 배치 기록이 전과 같이 근무지 탭에 나타난다** (폴백 확인)
- 배치 확정 후 `Data` F열의 그 날짜 `location`을 바꿔도 배치 기록은 원래 탭에 남는다

- [ ] **Step 8: 커밋**

```bash
git add ApplyWorkerSite/AdminView.html
git commit -m "관리자 배치판의 근무지 필터를 날짜별로 판단하도록 변경"
```

---

### Task 5: 관리자 — 근무자×요일 표의 날짜별 필터

**Files:**
- Modify: `ApplyWorkerSite/AdminView.html:603-610,649-659` (`buildWorkerWeekShiftTable`)
- Modify: `ApplyWorkerSite/SharedStyles.html:66` 부근 (스타일 추가)

**Interfaces:**
- Consumes: `locationMatches(rec, dateStr)` (Task 4)
- Produces: 없음

- [ ] **Step 1: 표에 넘길 `shifts`를 날짜별로 걸러둔다**

`AdminView.html:603-610`을 바꾼다.

기존:

```js
  const relevant = records.filter(rec => (rec.shifts || []).some(s => weekSet.has(s.date) && s[shiftKey]));

  const withMeta = relevant.map(rec => ({
    key: rec.key, name: rec.name, pin: rec.pin || '',
    gender: rec.adminGender || rec.gender || '',
    sortOrder: rec.sortOrder || 0,
    shifts: rec.shifts || []
  }));
```

교체:

```js
  const relevant = records.filter(rec => (rec.shifts || []).some(s => weekSet.has(s.date) && s[shiftKey] && locationMatches(rec, s.date)));

  // shifts를 여기서 미리 걸러두면 날짜 칸 렌더와 합계 계산이 함께 날짜별로 맞아떨어진다.
  // allShifts는 "다른 근무지라 빠진 날짜"와 "아예 신청이 없는 날짜"를 구분하는 데 쓴다.
  const withMeta = relevant.map(rec => ({
    key: rec.key, name: rec.name, pin: rec.pin || '',
    gender: rec.adminGender || rec.gender || '',
    sortOrder: rec.sortOrder || 0,
    shifts: (rec.shifts || []).filter(s => locationMatches(rec, s.date)),
    allShifts: rec.shifts || []
  }));
```

- [ ] **Step 2: 다른 근무지 날짜 칸을 구분해 클릭을 막는다**

`AdminView.html:649-655`의 `weekDatesStr.forEach` 앞부분을 바꾼다.

기존:

```js
    weekDatesStr.forEach((dateStr, i) => {
      const found = r.shifts.find(s => s.date === dateStr && s[shiftKey]);
      const cellId = 'dcell_' + shiftKey + '_' + dateStr + '_' + r.key;
      if (!found) {
        rowHtml += `<td id="${cellId}" class="date-cell" onclick="handleDateCellClick(event,'${dateStr}','${shiftKey}','${r.key}',false)">-</td>`;
        return;
      }
```

교체:

```js
    weekDatesStr.forEach((dateStr, i) => {
      const found = r.shifts.find(s => s.date === dateStr && s[shiftKey]);
      const cellId = 'dcell_' + shiftKey + '_' + dateStr + '_' + r.key;
      if (!found) {
        // 다른 근무지로 신청한 날짜는 클릭을 막는다. 열어두면 신청날짜 수정 모드에서 빈 칸처럼
        // 보이는 칸을 눌렀을 때 실제로는 신청이 해제된다(toggleDateSelection이 원본을 보므로).
        const otherLocation = r.allShifts.find(s => s.date === dateStr && s[shiftKey]);
        if (otherLocation) {
          rowHtml += `<td id="${cellId}" class="date-cell date-cell-other" title="다른 근무지로 신청한 날짜">·</td>`;
          return;
        }
        rowHtml += `<td id="${cellId}" class="date-cell" onclick="handleDateCellClick(event,'${dateStr}','${shiftKey}','${r.key}',false)">-</td>`;
        return;
      }
```

- [ ] **Step 3: 스타일을 추가한다**

`SharedStyles.html:66`의 `.date-cell { cursor: default; }` 바로 뒤에 넣는다.

```css
  .date-cell-other { color: #ddd; cursor: not-allowed; }
  body.date-edit-mode .date-cell-other:hover { outline: none; }
```

- [ ] **Step 4: 배포하고 확인한다**

- 다른 근무지로 신청한 날짜 칸이 `·`로 보이고, 신청이 아예 없는 날짜는 `-`로 보인다
- 신청날짜 수정 모드에서 `·` 칸을 눌러도 아무 일도 일어나지 않는다
- `-` 칸은 전처럼 눌러서 날짜를 추가할 수 있다
- 표 하단 합계가 그 탭에 해당하는 인원만 센다
- '전체' 탭에서는 `·` 칸이 하나도 없다

- [ ] **Step 5: 커밋**

```bash
git add ApplyWorkerSite/AdminView.html ApplyWorkerSite/SharedStyles.html
git commit -m "근무자×요일 표에서 다른 근무지 날짜를 구분 표시하고 클릭 차단"
```

---

### Task 6: 관리자 — 날짜 칸 팝업에 근무지 섹션

**Files:**
- Modify: `ApplyWorkerSite/AdminView.html:474-520` (`showFloorMenu`)
- Modify: `ApplyWorkerSite/AdminView.html:523-537` 뒤 (`setCellLocation` 추가)

**Interfaces:**
- Consumes: `setShiftLocation(key, date, location, adminPw)` (Task 3), `workerLocation(key, dateStr)` (Task 4)
- Produces: 없음

- [ ] **Step 1: 팝업에 근무지 섹션을 추가한다**

`AdminView.html:513`의 "지우기" 버튼 생성 코드 **앞**에 넣는다. 즉 `const clearBtn = ...` 바로 위다.

```js
  // 층/이동수단 버튼은 saveAssignment로 배치를 확정시키지만, 근무지 버튼은 신청 근무지만 바꾼다.
  const locSep = document.createElement('div');
  locSep.textContent = '근무지 (이 날짜만)';
  locSep.style.cssText = 'font-size:11px; color:#888; padding:4px 10px 0; border-top:1px solid #eee; margin-top:2px;';
  menu.appendChild(locSep);
  LOCATIONS.forEach(l => {
    const btn = document.createElement('button');
    btn.textContent = (l === loc ? '✓ ' : '') + l;
    btn.style.cssText = 'font-size:12px; padding:6px 10px; border:none; background:#f4fbf0; border-radius:6px; cursor:pointer; text-align:left;';
    btn.onclick = function(e) { e.stopPropagation(); setCellLocation(dateStr, key, l); };
    menu.appendChild(btn);
  });
```

- [ ] **Step 2: 저장 함수를 추가한다**

`AdminView.html:537`의 `setCellFloor` 함수가 끝나는 `}` 바로 뒤에 넣는다.

```js
// 그 날짜의 근무지만 바꾼다. 배치를 만들지는 않는다(층/이동수단 버튼과 다른 점).
function setCellLocation(dateStr, key, location) {
  adminRun()
    .withSuccessHandler(function() { closeFloorMenu(); saveScrollForRefresh(); loadAdmin(); })
    .withFailureHandler(function(err) { alert('근무지 변경 오류: ' + err.message); })
    .setShiftLocation(key, dateStr, location, adminPassword);
}
```

- [ ] **Step 3: 배포하고 확인한다**

- 근무자×요일 표의 날짜 칸을 누르면 팝업 아래쪽에 "근무지 (이 날짜만)" 섹션이 보이고, 현재 근무지에 `✓`가 붙어 있다
- 다른 근무지를 고르면 화면이 새로 그려지고 그 날짜만 해당 탭으로 옮겨간다
- 근무지를 고르는 것만으로는 배치가 확정되지 않는다(배치 확정 명단에 나타나지 않는다)
- 이미 배치된 날짜의 근무지를 바꾸면 `Assign` K열도 같이 바뀐다
- 기본 근무지와 같은 값을 고르면 `Data` F열에서 `location`이 사라진다
- 층 버튼과 이동수단 버튼은 전과 같이 배치를 확정시킨다

- [ ] **Step 4: 커밋**

```bash
git add ApplyWorkerSite/AdminView.html
git commit -m "배치판 날짜 칸 팝업에서 그 날짜의 근무지를 바꿀 수 있게 함"
```

---

### Task 7: 근무자 신청 화면의 날짜별 근무지 선택

**Files:**
- Modify: `ApplyWorkerSite/WorkerView.html:30` (레이블)
- Modify: `ApplyWorkerSite/WorkerView.html:55-66` (라디오 렌더)
- Modify: `ApplyWorkerSite/WorkerView.html:81-123` (`buildDateList`, `toggleShift`)
- Modify: `ApplyWorkerSite/WorkerView.html:193` (`submitApplication`)
- Modify: `ApplyWorkerSite/SharedStyles.html:15` (스타일)

**Interfaces:**
- Consumes: `LOCATIONS` (`SharedScript.html:3`)
- Produces: 없음

- [ ] **Step 1: 레이블을 바꾼다**

`WorkerView.html:30`:

기존:

```html
      <label>근무 장소 (해당되는 곳 한 곳만 선택)</label>
```

교체:

```html
      <label>기본 근무 장소</label>
      <div class="sub" style="margin:-2px 0 6px;">평소 가는 곳을 고르세요. 날짜마다 다른 곳에 간다면 아래 달력에서 그 날짜만 바꿀 수 있어요.</div>
```

- [ ] **Step 2: 기본 근무장소 라디오가 바뀔 때 날짜별 드롭다운을 따라가게 한다**

`WorkerView.html:55-66`을 바꾼다.

기존:

```js
function renderLocationCheckboxes(selectedLocations) {
  const container = document.getElementById('locationCheckboxes');
  container.innerHTML = LOCATIONS.map(loc => {
    const checked = (selectedLocations || []).indexOf(loc) > -1 ? 'checked' : '';
    const id = 'loc_' + loc.replace(/[^a-zA-Z0-9가-힣]/g, '_');
    return `<label><input type="radio" name="workLocation" id="${id}" value="${loc}" ${checked}>${loc}</label>`;
  }).join('');
}
function getSelectedLocations() {
  const checked = document.querySelector('input[name="workLocation"]:checked');
  return checked ? [checked.value] : [];
}
```

교체:

```js
function renderLocationCheckboxes(selectedLocations) {
  const container = document.getElementById('locationCheckboxes');
  container.innerHTML = LOCATIONS.map(loc => {
    const checked = (selectedLocations || []).indexOf(loc) > -1 ? 'checked' : '';
    const id = 'loc_' + loc.replace(/[^a-zA-Z0-9가-힣]/g, '_');
    return `<label><input type="radio" name="workLocation" id="${id}" value="${loc}" ${checked} onchange="onBaseLocationChange()">${loc}</label>`;
  }).join('');
}
function getSelectedLocations() {
  const checked = document.querySelector('input[name="workLocation"]:checked');
  return checked ? [checked.value] : [];
}
function currentBaseLocation() {
  return getSelectedLocations()[0] || '';
}
// 기본 근무장소를 바꾸면 따로 지정하지 않은 날짜(selections[key].location이 빈 값)의
// 드롭다운도 같이 따라간다. 그 날짜만 다른 곳으로 바꿔둔 것은 그대로 둔다.
function onBaseLocationChange() {
  const base = currentBaseLocation();
  Object.keys(selections).forEach(key => {
    if (selections[key].location) return;
    const sel = document.getElementById('loc-' + key);
    if (sel) setSelectValue(sel, base);
  });
}
// 근무지 목록이 바뀌어 저장된 값이 LOCATIONS에 없을 수 있다. 그대로 두면 브라우저가 첫 항목을
// 골라버려 근무지가 조용히 바뀌므로, 없는 값은 옵션을 덧붙여 보존한다.
function setSelectValue(sel, value) {
  if (!value) return;
  if (!Array.from(sel.options).some(o => o.value === value)) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    sel.appendChild(opt);
  }
  sel.value = value;
}
```

- [ ] **Step 3: 날짜 행에 근무지 드롭다운을 그린다**

`WorkerView.html:95-117`의 날짜 행 생성 부분을 바꾼다.

기존:

```js
    const key = formatDate(d);
    const dow = DAY_NAMES[d.getDay()];
    selections[key] = { day: false, night: false };
    if (prefill) {
      const found = prefill.find(s => s.date === key);
      if (found) { selections[key].day = !!found.day; selections[key].night = !!found.night; }
    }
    const row = document.createElement('div');
    row.className = 'date-row';
    const isWeekend = (d.getDay()===0 || d.getDay()===6);
    const isPast = key < todayKey;
    const dayBtnClass = 'shift-btn' + (selections[key].day?' selected':'') + (isPast?' disabled':'');
    const nightBtnClass = 'shift-btn' + (selections[key].night?' selected':'') + (isPast?' disabled':'');
    const dayOnclick = isPast ? '' : ` onclick="toggleShift('${key}','day')"`;
    const nightOnclick = isPast ? '' : ` onclick="toggleShift('${key}','night')"`;
    row.innerHTML = `
      <div class="${isWeekend?'weekend':''}">${d.getMonth()+1}/${d.getDate()} (${dow})</div>
      <div class="shift-btns">
        <div class="${dayBtnClass}" id="day-${key}"${dayOnclick}>주간</div>
        <div class="${nightBtnClass}" id="night-${key}"${nightOnclick}>야간</div>
      </div>`;
    container.appendChild(row);
```

교체:

```js
    const key = formatDate(d);
    const dow = DAY_NAMES[d.getDay()];
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
      <div class="shift-btns">
        <div class="${dayBtnClass}" id="day-${key}"${dayOnclick}>주간</div>
        <div class="${nightBtnClass}" id="night-${key}"${nightOnclick}>야간</div>
      </div>
      <select class="date-loc" id="loc-${key}" ${isPast?'disabled':''} onchange="setDateLocation('${key}', this.value)" style="display:${hasShift?'':'none'};">${locOptions}</select>`;
    container.appendChild(row);
    setSelectValue(document.getElementById('loc-' + key), selections[key].location || currentBaseLocation());
```

- [ ] **Step 4: 주간/야간 토글에 드롭다운 표시를 연동한다**

`WorkerView.html:120-123`을 바꾼다.

기존:

```js
function toggleShift(key, type) {
  selections[key][type] = !selections[key][type];
  document.getElementById(type+'-'+key).classList.toggle('selected', selections[key][type]);
}
```

교체:

```js
function toggleShift(key, type) {
  selections[key][type] = !selections[key][type];
  document.getElementById(type+'-'+key).classList.toggle('selected', selections[key][type]);
  syncDateLocationVisibility(key);
}

// 주간/야간을 하나라도 고른 날짜에만 근무지 드롭다운을 보여준다.
// 신청을 모두 해제하면 그 날짜의 근무지 지정도 함께 지운다.
function syncDateLocationVisibility(key) {
  const sel = document.getElementById('loc-' + key);
  if (!sel) return;
  const on = selections[key].day || selections[key].night;
  sel.style.display = on ? '' : 'none';
  if (!on) {
    selections[key].location = '';
    setSelectValue(sel, currentBaseLocation());
  }
}

// 기본 근무장소와 같은 값을 고르는 것은 "그 날짜만 다르게"를 해제하는 뜻으로 본다.
function setDateLocation(key, value) {
  selections[key].location = (value === currentBaseLocation()) ? '' : value;
}
```

- [ ] **Step 5: 저장할 때 예외 지정만 보낸다**

`WorkerView.html:193`을 바꾼다.

기존:

```js
  const chosen = Object.entries(selections).filter(([k,v]) => v.day || v.night).map(([k,v]) => ({date:k, day:v.day, night:v.night}));
```

교체:

```js
  const base = currentBaseLocation();
  const chosen = Object.entries(selections).filter(([k,v]) => v.day || v.night).map(([k,v]) => {
    const item = { date: k, day: v.day, night: v.night };
    // 기본 근무장소와 같으면 저장하지 않는다. 그래야 나중에 기본 근무장소가 바뀔 때 따라간다.
    if (v.location && v.location !== base) item.location = v.location;
    return item;
  });
```

- [ ] **Step 6: 스타일을 추가한다**

`SharedStyles.html:15`의 `.date-row` 규칙에 `flex-wrap: wrap;`을 더하고, 그 아래에 `.date-loc`을 추가한다.

기존:

```css
  .date-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
```

교체:

```css
  .date-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
  .date-loc { flex-basis: 100%; margin-top: 6px; padding: 6px 8px; border: 1px solid #ddd; border-radius: 8px; font-size: 13px; font-family: inherit; background: white; }
  .date-loc:disabled { background: #f5f5f5; color: #aaa; }
```

- [ ] **Step 7: 배포하고 확인한다**

근무자 신청 화면에서:

- 주간이나 야간을 누르면 그 날짜 행 아래에 근무지 드롭다운이 나타난다
- 둘 다 해제하면 드롭다운이 사라진다
- 드롭다운을 건드리지 않고 저장하면 `Data` F열에 `location`이 들어가지 않는다
- 기본값과 같은 값을 골라도 `location`이 들어가지 않는다
- 다른 값을 고르고 저장하면 그 날짜에만 `location`이 들어간다
- 저장 후 다시 조회하면 그 날짜 드롭다운이 지정한 값으로 복원된다
- 기본 근무장소 라디오를 바꾸면 예외 지정이 없던 드롭다운들이 같이 바뀌고, 예외로 바꾼 날짜는 그대로다
- 오늘 이전 날짜의 드롭다운은 비활성화되어 있다
- 휴대폰 화면 폭에서 드롭다운이 다음 줄에 전체 폭으로 나타나고 가로 스크롤이 생기지 않는다
- `Data` 시트 F열에 `"location":"없는근무지"`처럼 `LOCATIONS`에 없는 값을 직접 넣고 조회하면, 드롭다운이 첫 항목으로 바뀌지 않고 그 값을 그대로 보여준다 (`setSelectValue`의 옵션 보존)

- [ ] **Step 8: 커밋**

```bash
git add ApplyWorkerSite/WorkerView.html ApplyWorkerSite/SharedStyles.html
git commit -m "근무자가 날짜마다 근무지를 다르게 신청할 수 있게 함"
```

---

### Task 8: 설계 문서 변경 이력 반영

**Files:**
- Modify: `ApplyWorkerSite/docs/DESIGN.md`

**Interfaces:**
- Consumes: 없음
- Produces: 없음

- [ ] **Step 1: 데이터 모델 설명을 갱신한다**

`ApplyWorkerSite/docs/DESIGN.md:21`의 `Data` 시트 설명을 바꾼다.

기존:

```
- `Data`: 근로자 신청 원장 (key, 이름, 전화, PIN(생년월일6자리), 근무 희망일 JSON, 희망 장소 JSON, 관리자 지정 장소, 메시지, 성별, 관리자 지정 성별, 광고 수신 동의 여부)
```

교체:

```
- `Data`: 근로자 신청 원장 (key, 이름, 전화, PIN(생년월일6자리), 근무 희망일 JSON, 희망 장소 JSON, 관리자 지정 장소, 메시지, 성별, 관리자 지정 성별, 광고 수신 동의 여부)
  - 근무 희망일 JSON(F열)의 각 항목은 `{date, day, night}`이고, 그 날짜만 다른 근무지로 갈 때 `location`이 추가된다. `location`이 없으면 기본 근무지(관리자 지정 장소 → 희망 장소 첫 값)를 쓴다.
```

- [ ] **Step 2: 변경 이력 항목을 추가한다**

`ApplyWorkerSite/docs/DESIGN.md:66`의 `## 변경 이력` 바로 아래, 기존 첫 항목 앞에 넣는다.

```markdown
### 2026-09-29: 근무자가 날짜마다 다른 근무지를 신청할 수 있게 함

근무지가 근무자당 하나뿐이라 "월~금은 신세계푸드, 토·일은 BGF" 같은 신청을 표현할 수 없었고, 근무자들이 이를 자유 메시지 칸에 글로 적어 보내면 관리자가 읽고 손으로 처리했다.

`Data` F열 `shiftsJSON`의 날짜 항목에 `location`을 추가하되, **기본 근무지와 다를 때만** 저장한다. 값이 없으면 기본 근무지로 떨어지므로 기존 데이터는 마이그레이션 없이 그대로 동작하고, 관리자가 "이 사람 통째로 이동"(`setAdminLocation`)을 눌렀을 때 예외 지정이 없는 날짜들이 그대로 따라간다. 매번 `location`을 채워 저장하면 이 기존 기능이 무력화되므로 일부러 비워 두는 쪽을 택했다.

여기저기 흩어져 있던 `adminLocation || locations[0]` 계산은 날짜를 받는 헬퍼로 모았다(서버 `effectiveLocationOf_`/`makeLocationLookup_`, 클라이언트 `effectiveLocation`). 배치판의 근무지 탭은 이제 사람이 아니라 날짜 칸 단위로 거른다.

배치 확정 명단만은 `Assign` K열에 박아둔 배치 당시 근무지로 판정한다(K열이 비어 있던 옛 기록은 `Data`로 폴백). 기존에는 확정된 배치도 `Data`를 다시 읽어 판정했기 때문에, 근무자가 나중에 신청 근무지를 바꾸면 관리자가 확정해둔 배치가 소리 없이 다른 탭으로 옮겨갔다.

관리자는 근무자×요일 표의 날짜 칸 팝업(기존 층/이동수단 팝업)에서 그 날짜의 근무지를 바꾼다(`setShiftLocation`). 층·이동수단 버튼과 달리 배치를 확정시키지 않는다. 같은 표에서 다른 근무지로 신청한 날짜는 `·`로 표시하고 클릭을 막았다 — 열어두면 신청날짜 수정 모드에서 빈 칸처럼 보이는 칸을 눌렀을 때 실제로는 신청이 해제된다.

관리자 화면 세 곳(신청날짜 수정 모드, 일정수정 오버레이, 근무자 추가 오버레이)이 `shifts`를 `{date, day, night}`로만 다시 만들어 덮어쓰기 때문에 날짜별 근무지가 지워질 수 있었다. 클라이언트 세 군데를 각각 고치는 대신 서버(`adminUpdateShifts`, `batchSaveRecords`)에서 `mergeShiftLocations_`로 병합하도록 했다.
```

- [ ] **Step 3: 커밋**

```bash
git add ApplyWorkerSite/docs/DESIGN.md
git commit -m "설계 문서에 날짜별 근무지 변경 이력 추가"
```
