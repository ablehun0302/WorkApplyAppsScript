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
