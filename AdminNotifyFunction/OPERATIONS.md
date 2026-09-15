# 운영/관리 가이드

DEPLOY.md대로 배포할 때 실제로 겪은 문제와 해결법, 그리고 배포 후 관리 방법을 정리합니다.

## 배포 시 추가로 필요했던 IAM 권한

새 프로젝트의 기본 컴퓨트 서비스 계정(`PROJECT_NUMBER-compute@developer.gserviceaccount.com`)에는
Editor 역할이 자동으로 붙지 않아서, 아래 역할들을 직접 부여해야 배포가 끝까지 성공합니다.
(`gcloud functions deploy`가 배포 중 "이 역할이 없습니다, 부여할까요? (y/N)"라고 물어보는 것도 있지만,
매번 자동으로 반영되지는 않았습니다 — 안 됐으면 아래처럼 직접 부여하세요.)

```bash
# 소스 zip이 든 GCS 버킷을 Cloud Build가 읽을 수 있어야 함
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member=serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --role=roles/storage.objectViewer

# Cloud Build가 빌드를 실행할 수 있어야 함
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member=serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --role=roles/cloudbuild.builds.builder

# 런타임에서 Secret Manager 시크릿 값을 읽을 수 있어야 함
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member=serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor

# Eventarc 트리거가 Cloud Run 서비스를 호출할 수 있어야 함
gcloud run services add-iam-policy-binding checknewapplications \
  --region=asia-northeast3 \
  --member=serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --role=roles/run.invoker
```

## 겪었던 오류와 원인

| 증상 | 원인 |
|---|---|
| `functions describe` 결과 `Cloud Run service ... not found` | 빌드 실패로 Cloud Run 서비스 자체가 안 만들어짐. Cloud Build 로그(`gcloud builds log BUILD_ID --region=...`) 확인 필요 |
| 빌드 로그: `Access to bucket ... denied` | 컴퓨트 서비스 계정에 `roles/storage.objectViewer` 없음 |
| 배포 명령: `Permission denied on secret ...` | 컴퓨트 서비스 계정에 `roles/secretmanager.secretAccessor` 없음 |
| 함수 로그: `The request was not authenticated ... {run.routes.invoke}` | Eventarc 트리거 서비스 계정에 Cloud Run 서비스의 `roles/run.invoker` 없음 |
| `functions describe` 결과 `Eventarc trigger ... not found` | 위 권한들이 갖춰지지 않아 Cloud Run 리비전이 정상 기동하지 못해서 트리거 연결도 실패 |
| PowerShell에서 `gcloud`가 `.ps1을 로드할 수 없습니다` (보안 오류) | PowerShell 실행 정책이 스크립트 실행을 막음. `gcloud.cmd`로 실행하거나 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` 적용 |
| `.bat` 파일에서 배포 명령이 깨짐 | bash용 줄이음 문자 `\`를 그대로 씀. Windows cmd(.bat)는 `^`를 써야 함 |
| SMS 발송 함수 로그: `NotEnoughBalance` | GCP 문제 아님. SOLAPI 계정 캐시/포인트 잔액 부족 — SOLAPI 콘솔에서 충전 필요 |

## 상태 확인

```bash
# 함수 상태 (state: ACTIVE 이고 CRITICAL 에러 없어야 정상)
gcloud functions describe checkNewApplications --region=asia-northeast3 --gen2

# 실행 로그
gcloud functions logs read checkNewApplications --region=asia-northeast3 --gen2 --limit=20

# 특정 빌드 실패 원인 확인
gcloud builds log BUILD_ID --region=asia-northeast3
```

## Cloud Scheduler (5분마다 실행 잡) 제어

```bash
# 즉시 정지 (리소스는 남아있음, 나중에 재개 가능)
gcloud scheduler jobs pause notify-every-5min --location=asia-northeast3

# 재개
gcloud scheduler jobs resume notify-every-5min --location=asia-northeast3

# 수동 1회 실행 (테스트용)
gcloud scheduler jobs run notify-every-5min --location=asia-northeast3

# 완전 삭제 (되돌릴 수 없음, 재생성하려면 DEPLOY.md 5단계 다시 실행)
gcloud scheduler jobs delete notify-every-5min --location=asia-northeast3
```

함수 코드를 수정해서 재배포(`gcloud functions deploy ...`)해도 Cloud Scheduler 잡은 별개 리소스라 영향받지
않습니다. 일시정지 상태였다면 재배포 후에도 계속 일시정지 상태로 남아있습니다.

## Google Cloud Console에서 관리하기

프로젝트: 콘솔 상단의 프로젝트 선택기에서 `YOUR_PROJECT_ID`(배포 시 `gcloud config set project`로 설정한 것)를 선택

- **Cloud Scheduler**: 콘솔 검색창에 "Cloud Scheduler" → `notify-every-5min` 행에서 일시중지/재개/강제 실행/삭제
- **Cloud Functions**: 검색창에 "Cloud Functions" → `checkNewApplications` → 상태, 로그, 트리거 확인 및 삭제
- **Secret Manager**: 검색창에 "Secret Manager" → 시크릿 값 교체/삭제
- **Pub/Sub**: 검색창에 "Pub/Sub" → 토픽 `admin-notify-trigger` 확인
- **IAM**: 검색창에 "IAM" → 서비스 계정별 부여된 역할 확인/수정
