ApplyWorkerSite: 근무신청 사이트

공용 스크립트: WorkSystemSheet.gs

## 스크립트 외부에서 설정해야 하는 것

코드에 들어 있지 않아서 직접 설정해야 동작하는 항목들이다.

### 1. 스크립트 속성 (Apps Script 편집기 > 프로젝트 설정 > 스크립트 속성)

| 속성 | 필수 여부 | 용도 | 없을 때 |
|---|---|---|---|
| `ADMIN_PASSWORD` | 필수 | 관리자 화면 로그인, 관리자 전용 함수 검증 (`Code.gs`) | 관리자 로그인이 되지 않음 |
| `ROOT_FOLDER_ID` | 서류 업로드를 쓰면 필수 | 근로자별 서류 폴더를 만들 구글 드라이브 상위 폴더 ID (`Upload.gs`) | 업로드 화면에서 오류 |
| `SOLAPI_API_KEY` | 문자 발송을 쓰면 필수 | SOLAPI API 키 (`Sms.gs`) | 문자 발송 시 오류 |
| `SOLAPI_API_SECRET` | 문자 발송을 쓰면 필수 | SOLAPI API 시크릿 (`Sms.gs`) | 문자 발송 시 오류 |
| `SOLAPI_SENDER` | 선택 | 기본 발신번호. 발송 화면에서 발신번호를 직접 입력하면 그 값이 우선 | 발신번호를 입력하지 않으면 오류 |
| `SOLAPI_OPT_OUT_NUMBER` | 광고성 문자를 보내면 필수 | 광고 문자에 붙는 무료수신거부(080) 번호 | 광고성 문자 발송 시 오류 |
| `SS_ID` | 선택 | 데이터를 저장하는 스프레드시트 ID (`WorkSystemSheet.gs`) | 새 스프레드시트를 만들고 그 ID를 자동으로 저장 |

- `SS_ID`는 비워 두면 처음 실행할 때 자동으로 채워진다. 이미 쓰던 스프레드시트를 연결하려면 직접 넣는다.
- `SS_ID`에 적힌 스프레드시트를 열 수 없으면(삭제, 권한 없음) 새 스프레드시트를 만들어 값을 덮어쓴다.

### 2. 웹앱 배포

`doGet()`으로 화면을 내려주므로 Apps Script 편집기에서 웹앱으로 배포해야 한다. 코드를 고친 뒤에는 새 버전으로 다시 배포해야 반영된다.

`appsscript.json`이 저장소에 없어서 실행 계정, 액세스 범위 같은 배포 설정은 편집기에서 직접 관리한다.

### 3. SOLAPI 계정

API 키와 시크릿을 발급받고, 발신번호를 SOLAPI에 미리 등록해 둔다.

### 4. Cloud Function `checkNewApplications` (Apps Script와 별도)

`gcloudDeploy.bat`으로 배포한다. 함수 소스(`AdminNotifyFunction` 폴더)와 `gcloudDeploy.bat`은 저장소에 올라가지 않는다.

- 환경변수: `SPREADSHEET_ID`
- GCP Secret Manager 시크릿: `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `SOLAPI_SENDER`, `ADMIN_NOTIFY_PHONE`
- 실행 트리거: Pub/Sub 토픽 `admin-notify-trigger`

이 값들은 스크립트 속성과 따로 관리되므로, SOLAPI 키나 스프레드시트를 바꾸면 양쪽을 모두 고쳐야 한다.

### 5. Drive API 고급 서비스 (서류 업로드의 신분증 OCR)

Apps Script 편집기 > 서비스 > **Drive API**(v3)를 추가한다. 서류 제출 때 신분증에서 주민번호 앞 6자리를 읽어 폴더 이름(`이름 생년월일6자리`)을 만드는 데 쓴다(`Upload.gs`의 `extractBirthFromIdCard`). 추가한 뒤 권한을 다시 승인하고 새 버전으로 배포한다.

켜지 않으면 신분증을 읽지 못하고, 화면에 입력한 생년월일을 쓴다. 그것도 없으면 `이름 연락처` 폴더에 저장된다.
