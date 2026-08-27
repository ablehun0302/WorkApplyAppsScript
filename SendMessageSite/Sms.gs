// ===== 문자 발송 사이트 — 장소별 조회 + 알리고 발송 =====

function getWorkersByLocation(adminPw) {
  requireAdmin_(adminPw);
  const records = getAdminData(adminPw);

  const groups = {};
  LOCATIONS.forEach(loc => { groups[loc] = []; });
  const UNASSIGNED = '미분류';
  groups[UNASSIGNED] = [];

  records.forEach(r => {
    const effectiveLocation = r.adminLocation || (r.locations[0] || '');
    const bucket = groups.hasOwnProperty(effectiveLocation) ? effectiveLocation : UNASSIGNED;
    groups[bucket].push({ key: r.key, name: r.name, phone: r.phone });
  });

  // 근로자가 한 명도 없는 장소 그룹은 제거 (빈 탭 방지)
  Object.keys(groups).forEach(loc => {
    if (groups[loc].length === 0) delete groups[loc];
  });

  return groups;
}

function buildAligoRequest_(phoneList, message) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('ALIGO_API_KEY');
  const userId = props.getProperty('ALIGO_USER_ID');
  const sender = props.getProperty('ALIGO_SENDER');
  if (!apiKey || !userId || !sender) {
    throw new Error('알리고 연동 설정이 필요합니다. (ALIGO_API_KEY / ALIGO_USER_ID / ALIGO_SENDER)');
  }
  return {
    key: apiKey,
    user_id: userId,
    sender: sender,
    receiver: phoneList.join(','),
    msg: message
  };
}

function sendSms(phoneList, message, adminPw) {
  requireAdmin_(adminPw);
  if (!phoneList || phoneList.length === 0) throw new Error('발송 대상이 없습니다.');
  if (!message) throw new Error('메시지 내용이 없습니다.');

  const payload = buildAligoRequest_(phoneList, message);
  const response = UrlFetchApp.fetch('https://apis.aligo.in/send/', {
    method: 'post',
    payload: payload,
    muteHttpExceptions: true
  });
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();
  if (responseCode !== 200) {
    throw new Error('알리고 서버 응답 오류 (상태 코드: ' + responseCode + '): ' + responseText);
  }
  let result;
  try {
    result = JSON.parse(responseText);
  } catch (e) {
    throw new Error('알리고 응답을 해석할 수 없습니다: ' + responseText);
  }

  return {
    success: Number(result.result_code) > 0,
    successCount: Number(result.success_cnt) || 0,
    errorCount: Number(result.error_cnt) || 0,
    raw: result
  };
}
