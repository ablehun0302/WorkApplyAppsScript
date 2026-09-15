// Pub/Sub 트리거 전용 Cloud Function (Gen2). HTTP 엔드포인트가 없어서 워커/관리자 웹앱의
// 클라이언트가 이 함수를 직접 호출할 방법이 없다 — Cloud Scheduler가 5분마다 Pub/Sub 토픽에
// 메시지를 발행해야만 실행된다.
//
// 동작: Data 시트에서 notifiedAt(M열)이 비어있는 행(=아직 관리자에게 알리지 않은 신청)을 찾아
// SOLAPI로 문자 발송 후 notifiedAt에 현재 시각을 기록한다. 같은 행을 두 번 알리지 않기 위한
// 상태는 Firestore 등 별도 저장소 없이 시트 자체(M열)에 보관한다.
//
// 이미 알림을 보낸 사람이 신청일자(F열)만 바꿔서 재신청하는 경우를 감지하기 위해, 알림을
// 보낼 때의 F열 값을 N열에 같이 저장해둔다. 다음 실행에서 F열 값이 N열과 다르면 "일정 변경"으로
// 다시 알린다. N열이 비어있는(이 기능 도입 전에 이미 알림을 보낸) 행은 재알림 없이 현재 F열
// 값만 채워 넣어 다음 비교부터 정상 동작하게 한다.

const functions = require('@google-cloud/functions-framework');
const { google } = require('googleapis');
const crypto = require('crypto');

const DATA_RANGE = 'Data!A2:N';

functions.cloudEvent('checkNewApplications', async () => {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const authClient = await google.auth.getClient({
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const sheets = google.sheets({ version: 'v4', auth: authClient });

  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: DATA_RANGE });
  const rows = res.data.values || [];

  const updates = [];
  const newNames = [];
  const changedNames = [];
  for (let i = 0; i < rows.length; i++) {
    const name = rows[i][1];
    const shiftDate = rows[i][5];
    const notifiedAt = rows[i][12];
    const notifiedShiftDate = rows[i][13];
    if (!name) continue;

    if (!notifiedAt) {
      newNames.push(name);
    } else if (!notifiedShiftDate) {
      updates.push({ range: `Data!N${i + 2}`, values: [[shiftDate || '']] });
      continue;
    } else if (shiftDate !== notifiedShiftDate) {
      changedNames.push(name);
    } else {
      continue;
    }

    updates.push(
      { range: `Data!M${i + 2}`, values: [[new Date().toISOString()]] },
      { range: `Data!N${i + 2}`, values: [[shiftDate || '']] }
    );
  }

  const messages = [];
  if (newNames.length > 0) messages.push(`[근무 신청] ${newNames.length}건: ${newNames.join(', ')}`);
  if (changedNames.length > 0) messages.push(`[일정 변경] ${changedNames.length}건: ${changedNames.join(', ')}`);

  if (messages.length > 0) {
    await sendSms_(process.env.ADMIN_NOTIFY_PHONE, messages.join(' / '));
  }

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'RAW', data: updates }
    });
  }
});

async function sendSms_(phone, text) {
  const apiKey = process.env.SOLAPI_API_KEY;
  const apiSecret = process.env.SOLAPI_API_SECRET;
  const sender = process.env.SOLAPI_SENDER;

  const date = new Date().toISOString();
  const salt = crypto.randomUUID();
  const signature = crypto.createHmac('sha256', apiSecret).update(date + salt).digest('hex');
  const authHeader = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;

  const response = await fetch('https://api.solapi.com/messages/v4/send-many/detail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body: JSON.stringify({ messages: [{ to: phone, from: sender, text }] })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SOLAPI 오류 (상태 코드 ${response.status}): ${body}`);
  }
}
