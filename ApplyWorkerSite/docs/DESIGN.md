# ApplyWorkerSite 설계 (기존 코드 분석 기반, 최초 분석: 2026-08-21)

## 목적

근로자가 이름+생년월일 6자리로 근무일(주간/야간)을 신청·수정하고, 관리자가 장소별로 인원을 배치·관리하는 GAS(Google Apps Script) 웹앱.

Google Apps Script 기반 웹앱으로, 서버 로직(`Code.gs` + `SheetData.gs`) + `index.html`(단일 페이지 UI+클라이언트 로직)로 구성되어 있습니다. 데이터베이스 대신 Google Sheets를 사용하는 전형적인 GAS 패턴입니다.

> `Code.gs`와 `SheetData.gs`는 별도 파일이지만 GAS가 프로젝트 내 모든 `.gs` 파일을 하나의 전역 스코프로 자동 병합하므로, `index.html`의 `google.script.run.함수명()` 호출은 함수가 어느 파일에 있는지와 무관하게 그대로 동작합니다.

## 프로젝트 구조

- **`doGet()`**: 웹앱 진입점. `index.html`을 렌더링하고, iframe 임베드를 전부 허용(`ALLOWALL`).
- **`Code.gs`**: `doGet()`과 관리자 인증(`checkAdminPassword`, `requireAdmin_`, `ADMIN_PASSWORD`)만 담당.
- **`SheetData.gs`**: 시트 접근·CRUD·비즈니스 로직 전부(신청/배치/목표인원/근속통계 등).

## 데이터 모델 (시트 구성)

`getSpreadsheet_()`가 스크립트 속성(`SS_ID`)에 저장된 스프레드시트를 열거나, 없으면 새로 생성합니다.

- `Data`: 근로자 신청 원장 (key, 이름, 전화, PIN(생년월일6자리), 근무 희망일 JSON, 희망 장소 JSON, 관리자 지정 장소, 메시지, 성별, 관리자 지정 성별)
- `Assign`: 실제 배치 결과 (날짜/시프트/근로자/성별/층/교육·신규·여성임금 플래그)
- `Target`: 날짜·시프트별 목표 인원(남/여)
- `Roster`: 보건증 만료일/입사일/정렬순서
- `History`(자동 기록) + `PastMonthly`(수동 입력): 월별 근로일수·연속근무월수 계산용
- 장소별 시트(`신세계푸드 원남` 등): 신청/수정/삭제마다 전체 재구성되는 파생 뷰
- **`key` 생성**: `base64(이름|PIN)` — 암호화가 아니라 단순 인코딩이라 사실상 원문 노출과 다름없습니다.

## 플로우

### 근로자(신청자) 플로우

이름+생년월일 6자리로 조회 → 있으면 기존 신청 수정, 없으면 신규 신청(연락처 필수). 2주치(이번 주 월요일부터) 날짜별로 주간/야간 버튼을 토글해 신청하고, 성별·희망 장소(단일 선택)·자유 메시지를 함께 저장. 전체 취소도 가능.

### 관리자 플로우

비밀번호(`Code.gs`에 평문 하드코딩) 입력 후 두 서브뷰:
1. **배치판**: 장소 탭별 필터링, 주차별 표(근로자×요일, 층별 마크 아이콘), 목표인원 대비 현재 배치, 미배치자 칩에서 성별/층/교육/신규/여성임금 지정 후 개별·일괄 배치, 텍스트 미리보기 복사(문자 발송용 포맷).
2. **전체신청자 목록**: 보건증 만료일/입사일 편집, 월별 근로일수 자동+수동 합산, 연속근무개월수, 체크박스 선택 후 SOLAPI API로 서버에서 직접 문자 발송(`Sms.gs`).

성별 미지정자 일괄 지정 패널, 순서 바꾸기(▲▼), 관리자가 이름/연락처/PIN으로 근로자를 직접 추가하는 오버레이(자동완성 + 30초 자동저장), 5분마다 화면의 미저장 변경사항을 자동 저장하는 타이머도 있습니다.

## 알려진 이슈

**1. 관리자 인증이 UI 레벨에서만 작동함 (✅ 수정 완료)**
`checkAdminPassword`는 그냥 boolean을 리턴하는 서버 함수이고, 실제 데이터 조회/수정 함수들(`getAdminData`, `batchSaveAssignments`, `saveRosterEntry` 등)은 별도의 권한 체크가 전혀 없었습니다. GAS 웹앱은 클라이언트에서 `google.script.run.함수명()`으로 어떤 서버 함수든 직접 호출할 수 있기 때문에, 관리자 비밀번호를 몰라도 브라우저 개발자 도구에서 `google.script.run.getAdminData()`를 실행하면 전체 근로자의 이름·전화번호·**생년월일(PIN)**·성별이 그대로 노출되는 문제가 있었습니다.

**적용한 수정**: 관리자 전용 서버 함수 23개(`getAdminData`, `getRosterData`, `getWorkStats`, `getAssignments`, `getTargets`, `saveAssignment`/`batchSaveAssignments`/`removeAssignment`, `saveTarget`/`batchSaveTargets`, `setAdminGender`/`batchSetGender`, `setAdminLocation`/`batchSetLocations`, `adminUpdateShifts`, `setContactInfo`, `saveRosterEntry`/`batchSaveRoster`, `swapSortOrder`, `getPastMonthlyEntries`/`savePastMonthly`/`deletePastMonthly`, `batchSaveRecords`)에 마지막 인자로 `adminPw`를 추가하고, 함수 진입 시 `requireAdmin_(adminPw)`가 `ADMIN_PASSWORD`와 비교해 틀리면 예외를 던지도록 함(`Code.gs`). 클라이언트는 관리자 로그인 성공 시 입력한 비밀번호를 `adminPassword` 전역 변수에 보관했다가, 위 함수들을 호출할 때마다 함께 전송하도록 모든 호출부를 수정함(`index.html`). 이제 로그인 없이 개발자 도구로 직접 호출해도 서버에서 거부됩니다.

(참고: 워커 본인 조회/신청/취소(`lookupRecord`, `saveRecord`, `deleteRecord`)는 이름+생년월일6자리가 곧 본인 확인 수단인 기존 설계 그대로 유지했으며 이번 수정 범위에 포함하지 않았습니다.)

**2. PIN(생년월일 6자리)이 "비밀번호" 겸 개인정보로 이중 사용됨**
`getAdminData()`가 PIN을 평문으로 그대로 반환하고, `key`도 base64(이름|PIN)라 디코딩 한 줄이면 복원됩니다. 생년월일은 추측 가능한 값이라 본인확인 수단으로는 약하고, 동시에 개인정보라 노출 시 문제가 더 큽니다.

**3. `batchSaveRecords` 함수가 중복 정의됨 (Code.gs:284, Code.gs:316)**
동일 이름으로 두 번 정의되어 있어 첫 번째(284행)는 완전히 죽은 코드이고 실제로는 두 번째(316행)만 사용됩니다. 로직 차이는 거의 없어 보이지만(두 번째가 신규 행 append를 배치 처리해 더 빠름), 첫 번째 블록은 정리 대상입니다.

**4. 동시성 제어 없음**
모든 저장 함수가 "행 찾기 → 읽기 → 쓰기" 패턴이고 `LockService`를 쓰지 않습니다. 여러 근로자가 동시에 신청하거나 관리자가 동시에 배치를 저장하면 레이스 컨디션으로 덮어쓰기/유실이 생길 수 있습니다.

**5. `rebuildLocationSheets_()`가 매 저장마다 전체 재구성**
신청/수정/삭제/장소변경 등 거의 모든 쓰기 작업 후 전체 `Data` 시트를 읽고 모든 장소 시트를 clear+rewrite 합니다. 근로자 수가 늘어나면 매 호출 비용이 선형으로 커지고, GAS 실행시간 할당량(6분)에 걸릴 수 있습니다.

이 중 **1번(관리자 함수 미인증 접근)**과 **2번(개인정보 평문 노출)**은 실제 서비스 중이라면 가장 먼저 손봐야 할 부분입니다.

## 변경 이력

### 2026-09-03(3): 발송 완료 건수가 항상 0으로 표시되는 버그 수정

`sendSms`가 `count.sentSuccess`/`count.sentFailed`를 읽고 있었는데, 이 값은 통신사 발송이 실제로 완료된 뒤(비동기) 채워지는 값이라 `send-many/detail` 호출 직후 응답에는 항상 0이다(SOLAPI PHP 공식 SDK 소스 확인 — SDK 자체도 성공/실패 판단에 `sentSuccess`가 아니라 `registeredFailed`/`total`을 씀). 호출 직후 즉시 알 수 있는 값은 SOLAPI 접수 결과인 `registeredSuccess`/`registeredFailed`이므로 이 필드로 교체했다.

### 2026-09-03(2): 광고성 메시지 여부 · 발신번호 지정 기능 추가

SOLAPI API는 메시지 객체에 "광고 여부"를 넘기는 필드가 없다(공식 SDK 모델 기준 확인). 따라서 문자 패널에 "광고성 메시지" 체크박스를 추가하고, 체크 시 `applyAdvertisingNotice_()`가 본문에 `(광고)` 접두어와 `무료수신거부 [SOLAPI_OPT_OUT_NUMBER]` 안내를 자동으로 붙이도록 `Sms.gs`를 수정했다(정보통신망법 요건 충족용, 080 수신거부 번호는 발신번호와 별도로 Script Properties에 저장). 또한 발신번호 입력란을 추가해 매 발송마다 원하는 번호를 지정할 수 있도록 했고, 비워두면 기존처럼 `SOLAPI_SENDER` 기본값을 사용한다. `sendSms` 시그니처가 `(phoneList, message, isAdvertising, senderOverride, adminPw)`로 변경됨.

### 2026-09-03: 문자 발송을 SOLAPI API 직접 호출로 전환

기존 "전체신청자 목록"의 문자 발송(개별 `sendSingleSms`, 일괄 `sendBulkSms`)은 `window.open('sms:...')`로 OS 문자 앱을 열어주는 방식이었다. 이를 `Sms.gs`(신규)의 `sendSms(phoneList, message, adminPw)` 서버 함수로 교체해, `SendMessageSite` 프로젝트에서 설계했던 것과 동일한 SOLAPI HMAC-SHA256 인증 방식으로 서버에서 직접 발송하도록 변경했다. Script Properties에 `SOLAPI_API_KEY` / `SOLAPI_API_SECRET` / `SOLAPI_SENDER`를 설정해야 동작한다. 클라이언트는 발송 전 `confirm()`으로 재확인하고, 결과로 성공/실패 건수를 표시한다.

### 2026-08-21

**1. `Code.gs` → `Code.gs` + `SheetData.gs` 분리**
`Code.gs`에는 `doGet()`과 관리자 인증(`checkAdminPassword`, `requireAdmin_`, `ADMIN_PASSWORD`)만 남기고, 시트 접근·CRUD·비즈니스 로직 전부(신청/배치/목표인원/근속통계 등)를 `SheetData.gs`로 이동. 원본과 함수·상수 이름 목록을 diff로 대조해 누락/중복 없음을 확인함(기존에 있던 `batchSaveRecords` 중복 정의는 손대지 않고 그대로 옮김 — 위 3번 이슈 그대로 유지).

**2. 민감정보 점검 (코드 전체 + git 전체 히스토리)**
- `ADMIN_PASSWORD` 외에 API 키/OAuth·Bearer 토큰/하드코딩된 스프레드시트 ID·실제 전화번호 등은 발견되지 않음. `SS_ID`는 코드가 아니라 `PropertiesService`에 런타임 저장되는 정상 패턴.
- 위 2번 이슈(PIN 평문 저장/반환)와 `makeKey_`의 `base64Encode(name|pin)`가 개인정보 관점에서 실질적 위험으로 재확인됨. base64는 암호화가 아니므로 `getAdminData()` 응답의 `key` 값만으로도 `atob()` 한 번이면 이름+생년월일 복원 가능.
- git 커밋 이력(`init project`, `관리자 인증 서버에서 확인하도록 함`, `pin 0 없어지는 오류 해결`) 전체를 확인했으나 과거에 있었다가 지워진 별도 시크릿 흔적 없음.

**다음 후보**: PIN 해시 저장(`Utilities.computeDigest` 등)으로 평문 노출 제거, `key` 생성 방식을 복원 불가능한 해시로 변경.
