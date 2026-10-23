// ===== 근무 신청 시스템 서버 코드 (Google Apps Script) =====

function checkAdminPassword(pw) {
  try {
    requireAdmin_(pw);
    return true;
  } catch (e) {
    return false;
  }
}

// 관리자 전용 함수 진입 시 서버에서 비밀번호를 재검증 (UI 잠금만으로는 우회 가능하므로 필수)
// ADMIN_PASSWORD가 비어 있으면 getProperty가 null이라 null을 보낸 호출이 통과하므로 먼저 막는다.
function requireAdmin_(pw) {
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!expected || pw !== expected) throw new Error('관리자 인증이 필요합니다.');
}

var PAGE_FILES = { home: 'Home', worker: 'WorkerView', admin: 'AdminView', upload: 'UploadView' };

function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || 'home';
  var file = PAGE_FILES[page] || PAGE_FILES.home;
  var template = HtmlService.createTemplateFromFile(file);
  // 화면 이동 링크용. doGet()이 렌더링되는 실제 iframe 주소(googleusercontent.com)와
  // 브라우저 주소창의 /exec 주소가 달라서 상대경로(href="?page=...")로는 이동이 안 됨 -> 절대 URL을 서버에서 내려줌
  template.baseUrl = ScriptApp.getService().getUrl();
  return template.evaluate()
    .setTitle('근무 신청 시스템')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
