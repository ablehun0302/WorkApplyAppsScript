# SendMessageSite 설계 (최초 작성: 2026-08-21)

## 목적

관리자가 `근무신청시스템_데이터` 스프레드시트에 등록된 근로자를 장소별로 조회하고, 선택한 근로자에게 SOLAPI(舊 쿨SMS) API로 문자를 발송하는 별도 사이트.

## 프로젝트 구조

기존 근무신청시스템(`ApplyWorkerSite`)과 **완전히 독립된 새 GAS 프로젝트**(별도 배포 URL, 별도 Script Properties)로 만든다. 로컬 미러링 구조는 다음과 같다.

```
D:\WorkApplyWebsite\
  WorkSystemSheet.gs          # 기존 공용 데이터 계층 (그대로 재사용, 수정하지 않음)
  ApplyWorkerSite\
    Code.gs
    index.html
  SendMessageSite\
    Code.gs                   # 신규
    Sms.gs                    # 신규
    index.html                # 신규
    DESIGN.md                 # 본 문서
```

`WorkSystemSheet.gs`는 두 GAS 프로젝트 모두에 수동으로 복사해 넣는 공용 파일이라는 기존 관례를 그대로 따른다. `SendMessageSite`용 실제 GAS 프로젝트를 만들 때는 `WorkSystemSheet.gs`(원본 그대로) + `SendMessageSite/Code.gs` + `SendMessageSite/Sms.gs` + `SendMessageSite/index.html` 네 파일을 함께 넣는다. `WorkSystemSheet.gs`는 이번 작업에서 **읽기만 하고 수정하지 않는다.**

## 재사용하는 기존 함수 (WorkSystemSheet.gs)

- `getSpreadsheet_()` / `getDataSheet_()`: Script Properties의 `SS_ID`로 기존 스프레드시트를 연다. `SendMessageSite` 프로젝트의 Script Properties에도 동일한 `SS_ID` 값을 별도로 설정해야 한다(프로젝트가 분리되어 있으므로 속성도 분리됨).
- `getAdminData(adminPw)`: `Data` 시트 전체를 `{key, name, phone, locations, adminLocation, ...}` 형태로 반환. 장소 그룹핑의 데이터 소스로 그대로 사용.
- `LOCATIONS` 상수: 장소 탭 순서를 이 배열 순서에 맞춘다 (`신세계푸드 원남`, `델몬트_원남`, `BGF푸드_진천`, `물류우리와_금왕`, `포장우리와_금왕`, `주방보조_전국`, `기타`).
- `requireAdmin_`은 재사용하지 않고 `SendMessageSite/Code.gs`에서 동일 패턴으로 새로 정의한다(별도 프로젝트라 Script Properties가 분리되므로 비밀번호도 독립적으로 관리됨).

## 파일별 역할

### `SendMessageSite/Code.gs`
`ApplyWorkerSite/Code.gs`와 동일한 패턴:
```javascript
function checkAdminPassword(pw) { ... } // PropertiesService의 ADMIN_PASSWORD와 비교
function requireAdmin_(pw) { ... }      // 관리자 전용 함수 진입 시 재검증
function doGet() { ... }                // index.html 렌더링
```

### `SendMessageSite/Sms.gs`
- `getWorkersByLocation(adminPw)`
  - `requireAdmin_(adminPw)` 검증 후 `getAdminData(adminPw)` 호출
  - 각 근로자의 `effectiveLocation = record.adminLocation || (record.locations[0] || '')` 로 장소 결정 (기존 `rebuildLocationSheets_()`와 동일한 우선순위 규칙)
  - `{ location: [{ key, name, phone }] }` 형태로 그룹핑해 반환. 장소가 없는 근로자는 `'미분류'` 그룹으로 모음
- `buildSolapiAuthHeader_()`
  - Script Properties의 `SOLAPI_API_KEY` / `SOLAPI_API_SECRET`를 읽어 HMAC-SHA256 인증 헤더를 생성
  - `date`: 현재 시각(ISO 8601), `salt`: 랜덤 hex 문자열, `signature`: `Utilities.computeHmacSha256Signature(date + salt, apiSecret)`를 hex로 인코딩
  - 반환값: `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}` 형식의 문자열 (그대로 `Authorization` 헤더 값으로 사용)
  - 키가 비어 있으면(`아직 준비 안 됨` 상태) 명확한 에러 메시지를 던져 UI에서 "SOLAPI 연동 전" 안내를 표시
- `sendSms(phoneList, message, adminPw)`
  - `requireAdmin_(adminPw)` 검증, 빈 번호 목록/빈 메시지 검증
  - Script Properties의 `SOLAPI_SENDER`(사전 등록된 발신번호)와 `buildSolapiAuthHeader_()`를 이용해 `UrlFetchApp.fetch('https://api.solapi.com/messages/v4/send-many/detail', ...)` 호출
  - 요청 바디: `{ messages: phoneList.map(to => ({ to, from: SOLAPI_SENDER, text: message })) }` (번호별로 동일 메시지를 담은 메시지 객체 배열 — 알리고처럼 콤마 목록 한 줄이 아니라 SOLAPI v4 API 규격)
  - SOLAPI 응답의 `count.total` / `count.sentSuccess` / `count.sentFailed` (및 실패 시 `errorMessage`/`failedMessageList`)를 파싱해 기존과 동일한 `{ success: boolean, successCount, errorCount, raw }` 형태로 반환 → `index.html`의 소비 인터페이스는 변경 없음
  - HTTP 상태코드가 200이 아니거나 JSON 파싱에 실패하면 원문 응답을 포함한 명확한 에러를 던짐

### `SendMessageSite/index.html`
1. 관리자 비밀번호 입력 화면 (`checkAdminPassword`)
2. 로그인 후 `getWorkersByLocation` 호출 → 장소 탭(`LOCATIONS` 순서) + 탭별 근로자 체크박스 목록, 전체선택 토글
3. 메시지 자유 입력 textarea
4. 발송 버튼 → 선택된 근로자의 전화번호만 모아 `sendSms` 호출
5. 결과 영역에 성공/실패 건수 표시 (Aligo가 번호별 결과가 아닌 집계 결과를 반환하므로, 번호별 성공/실패가 아닌 **전체 성공/실패 건수**로 안내)

## Script Properties (SendMessageSite 프로젝트 전용)

| 키 | 용도 | 비고 |
|---|---|---|
| `ADMIN_PASSWORD` | 관리자 로그인 | 기존 사이트와 별도 값 |
| `SS_ID` | 근무신청시스템 스프레드시트 ID | 기존 스프레드시트와 동일 ID로 설정 필요 |
| `SOLAPI_API_KEY` | SOLAPI API 키 | **아직 미보유 — 자리만 마련, 발급 후 설정** |
| `SOLAPI_API_SECRET` | SOLAPI API 시크릿 | 위와 동일. HMAC 서명 생성에만 사용, 절대 클라이언트로 노출하지 않음 |
| `SOLAPI_SENDER` | SOLAPI 콘솔에 사전 등록된 발신번호 | 위와 동일 |

## 범위 밖 (단순성 우선, 필요 시 추후 확장)

- 발송 이력 로그 저장
- 메시지 개인화(이름 치환 등 템플릿)
- 예약 발송
- 동시 저장/발송에 대한 락(LockService) — 조회/발송이 대부분이라 기존 시스템과 같은 수준의 동시성 리스크만 존재

## 에러 처리

- 관리자 인증 실패: `requireAdmin_`이 예외 발생 → 클라이언트에서 로그인 화면으로 되돌림 (기존 패턴과 동일)
- SOLAPI 키 미설정: `sendSms`가 명확한 에러 메시지로 실패 → UI에 "SOLAPI 연동 설정이 필요합니다" 표시
- SOLAPI API 자체 오류(네트워크/응답/HTTP 상태 오류): `UrlFetchApp.fetch` 예외, 200이 아닌 응답 코드, JSON 파싱 실패, `count.sentFailed > 0`을 모두 잡아 사용자에게 원문 메시지 노출

## 테스트 체크리스트 (수동, GAS 특성상 자동화 테스트 없음)

1. 비밀번호 없이 브라우저 콘솔에서 `google.script.run.getWorkersByLocation()` / `sendSms()` 직접 호출 시 서버에서 거부되는지 확인
2. `getWorkersByLocation` 결과가 `Data` 시트의 실제 `adminLocation`/`locations` 값과 일치하는지 확인 (관리자 지정 장소 우선순위 포함)
3. 장소 미지정 근로자가 `'미분류'` 그룹으로 정상적으로 묶이는지 확인
4. SOLAPI 키 미설정 상태에서 발송 시도 → 명확한 안내 메시지 노출 확인
5. SOLAPI 키 발급 후, 테스트 번호 1~2개로 실제 발송 → 결과 집계(성공/실패 건수)가 SOLAPI 콘솔의 발송 이력과 일치하는지 확인

## 변경 이력

### 2026-08-21: 알리고 → SOLAPI

최초 설계는 알리고(Aligo) API였으나, 구현 완료 후 알리고가 **발신 서버 IP 사전 등록(화이트리스트)을 요구**한다는 사실을 확인했다. GAS의 `UrlFetchApp.fetch()`는 Google의 동적 IP 풀에서 나가므로 이 요구사항을 충족할 수 없어, 별도 고정 IP 중계 서버 없이는 GAS→알리고 직접 호출이 불가능하다는 결론에 도달했다.

대안으로 SOLAPI(舊 쿨SMS)를 조사한 결과:
- 인증 방식이 IP 화이트리스트가 아니라 **API Key + Secret 기반 HMAC-SHA256 서명**이다. 요청마다 timestamp+salt를 API Secret으로 서명해 `Authorization` 헤더에 실어 보내므로, 호출 IP가 무엇이든 서명만 맞으면 인증된다.
- 오히려 SOLAPI가 자사 API 서버의 고정 IP 도메인(`api-static.solapi.com`)을 제공하는 쪽이지, 발신자 서버 IP를 SOLAPI에 등록하는 구조가 아니다.
- **Google Apps Script 연동 공식 튜토리얼**이 존재하며 `UrlFetchApp.fetch` + `Utilities.computeHmacSha256Signature`로 만든 완전한 예제 코드를 제공한다 — GAS의 동적 IP를 전제로 한 서비스라는 뜻이다.

따라서 SMS 발송사를 **알리고 → SOLAPI로 변경**하고, 이전에 논의했던 고정 IP 중계 서버 방안은 폐기한다. 위 설계 문서는 이 변경을 반영해 갱신되었다(재사용 함수/파일별 역할/Script Properties/에러 처리 섹션의 알리고 관련 서술은 SOLAPI 기준으로 대체됨).
