# 배포 방법

gcloud CLI가 설치·인증된 환경에서 아래 명령을 순서대로 직접 실행하세요 (이 저장소 루트에서 실행 가정).
`YOUR_PROJECT_ID`, `실제_...` 로 표시된 값은 본인 값으로 바꿔야 합니다.

## 0. 프로젝트 설정 및 API 활성화

```bash
gcloud config set project YOUR_PROJECT_ID

gcloud services enable \
  cloudfunctions.googleapis.com \
  run.googleapis.com \
  eventarc.googleapis.com \
  pubsub.googleapis.com \
  cloudscheduler.googleapis.com \
  sheets.googleapis.com \
  secretmanager.googleapis.com
```

## 1. SOLAPI 시크릿 등록 (Secret Manager)

기존 GAS 스크립트 속성(SOLAPI_API_KEY / SOLAPI_API_SECRET / SOLAPI_SENDER)과 같은 값을 사용합니다.
관리자 알림 수신번호(ADMIN_NOTIFY_PHONE)는 새로 정해서 넣으세요.

```bash
echo -n "실제_API_KEY" | gcloud secrets create SOLAPI_API_KEY --data-file=-
echo -n "실제_API_SECRET" | gcloud secrets create SOLAPI_API_SECRET --data-file=-
echo -n "실제_발신번호" | gcloud secrets create SOLAPI_SENDER --data-file=-
echo -n "관리자_수신번호" | gcloud secrets create ADMIN_NOTIFY_PHONE --data-file=-
```

## 2. Pub/Sub 토픽 생성

```bash
gcloud pubsub topics create admin-notify-trigger
```

## 3. Cloud Function 배포 (Gen2, Pub/Sub 트리거 — HTTP 엔드포인트 없음)

`SPREADSHEET_ID`는 GAS 스크립트 속성 `SS_ID` 값(또는 스프레드시트 URL의 `/d/`와 `/edit` 사이 문자열)입니다.

```bash
gcloud functions deploy checkNewApplications \
  --gen2 \
  --runtime=nodejs20 \
  --region=asia-northeast3 \
  --source=./AdminNotifyFunction \
  --entry-point=checkNewApplications \
  --trigger-topic=admin-notify-trigger \
  --set-env-vars=SPREADSHEET_ID=실제_스프레드시트ID \
  --set-secrets=SOLAPI_API_KEY=SOLAPI_API_KEY:latest,SOLAPI_API_SECRET=SOLAPI_API_SECRET:latest,SOLAPI_SENDER=SOLAPI_SENDER:latest,ADMIN_NOTIFY_PHONE=ADMIN_NOTIFY_PHONE:latest
```

배포 로그에 찍히는 런타임 서비스 계정 이메일(보통 `PROJECT_NUMBER-compute@developer.gserviceaccount.com`)을 기억해두세요.

## 4. 스프레드시트 공유

방금 확인한 서비스 계정 이메일을 대상 구글 시트에 **편집자**로 공유하세요 (Sheets API 읽기/쓰기 권한 필요 — M열에 notifiedAt 기록).

## 5. Cloud Scheduler로 5분마다 실행

```bash
gcloud scheduler jobs create pubsub notify-every-5min \
  --schedule="*/5 * * * *" \
  --topic=admin-notify-trigger \
  --message-body="check" \
  --location=asia-northeast3
```

## 확인

```bash
gcloud scheduler jobs run notify-every-5min --location=asia-northeast3
gcloud functions logs read checkNewApplications --region=asia-northeast3 --gen2 --limit=20
```

## 왜 클라이언트가 이 함수를 호출할 수 없는가

HTTP 트리거가 아니라 Pub/Sub(Eventarc) 트리거로 배포했기 때문에 이 함수엔 공개 URL 자체가 없습니다.
실행시키려면 `admin-notify-trigger` 토픽에 `pubsub.topics.publish` 권한이 있어야 하는데, 이 권한은
Cloud Scheduler 잡에만 부여되어 있고 워커/관리자 웹앱(GAS) 쪽에는 애초에 그 권한도, 발행 대상 토픽
이름을 알 방법도 없습니다.
