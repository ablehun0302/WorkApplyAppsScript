// ===== 관리자 문자 발송 (SOLAPI) =====

function buildSolapiAuthHeader_() {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('SOLAPI_API_KEY');
  const apiSecret = props.getProperty('SOLAPI_API_SECRET');
  if (!apiKey || !apiSecret) {
    throw new Error('SOLAPI 연동 설정이 필요합니다. (SOLAPI_API_KEY / SOLAPI_API_SECRET)');
  }
  const date = new Date().toISOString();
  const salt = Utilities.getUuid();
  const signatureBytes = Utilities.computeHmacSha256Signature(date + salt, apiSecret);
  const signature = signatureBytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

// 광고성 메시지에 (광고) 접두어 + 무료수신거부 안내를 자동으로 붙임 (정보통신망법 요건)
function applyAdvertisingNotice_(message) {
  const props = PropertiesService.getScriptProperties();
  const optOutNumber = props.getProperty('SOLAPI_OPT_OUT_NUMBER');
  if (!optOutNumber) throw new Error('SOLAPI 연동 설정이 필요합니다. (SOLAPI_OPT_OUT_NUMBER)');

  let text = message;
  if (!text.startsWith('(광고)')) text = '(광고) ' + text;
  if (text.indexOf('무료수신거부') === -1) text += `\n무료수신거부 ${optOutNumber}`;
  return text;
}

function sendSms(phoneList, message, isAdvertising, senderOverride, adminPw) {
  requireAdmin_(adminPw);
  if (!phoneList || phoneList.length === 0) throw new Error('발송 대상이 없습니다.');
  if (!message) throw new Error('메시지 내용이 없습니다.');

  const props = PropertiesService.getScriptProperties();
  const sender = senderOverride || props.getProperty('SOLAPI_SENDER');
  if (!sender) throw new Error('SOLAPI 연동 설정이 필요합니다. (SOLAPI_SENDER 또는 발신번호 입력)');

  const text = isAdvertising ? applyAdvertisingNotice_(message) : message;

  const payload = {
    messages: phoneList.map(to => ({ to: to, from: sender, text: text }))
  };

  const response = UrlFetchApp.fetch('https://api.solapi.com/messages/v4/send-many/detail', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: buildSolapiAuthHeader_() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();
  if (responseCode !== 200) {
    throw new Error('SOLAPI 서버 응답 오류 (상태 코드: ' + responseCode + '): ' + responseText);
  }
  let result;
  try {
    result = JSON.parse(responseText);
  } catch (e) {
    throw new Error('SOLAPI 응답을 해석할 수 없습니다: ' + responseText);
  }

  // count.sentSuccess/sentFailed는 통신사 발송 완료 후(비동기) 채워지는 값이라 호출 직후엔 항상 0이다.
  // 호출 직후 바로 알 수 있는 결과는 SOLAPI 접수 결과인 registeredSuccess/registeredFailed이며, 공식 SDK도 이 값으로 성공/실패를 판단한다.
  const count = result.groupInfo && result.groupInfo.count ? result.groupInfo.count : {};
  const successCount = Number(count.registeredSuccess) || 0;
  const errorCount = Number(count.registeredFailed) || 0;

  return {
    success: successCount > 0 && errorCount === 0,
    successCount: successCount,
    errorCount: errorCount,
    raw: result
  };
}
