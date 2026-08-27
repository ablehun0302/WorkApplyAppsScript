// ===== 근로자 서류 업로드 사이트 서버 코드 (Google Apps Script) =====

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('서류 제출')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
