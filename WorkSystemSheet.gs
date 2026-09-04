// ===== 근무 신청 시스템 데이터 계층 (Google Sheets 접근 + CRUD) =====

const LOCATIONS = ['신세계푸드 원남', '델몬트_원남', 'BGF푸드_진천', '물류우리와_금왕', '포장우리와_금왕', '주방보조_전국', '기타'];

const NEW_SHEET_NAME = '근무신청시스템_데이터'; // 시트 생성 시 해당 이름으로 생성

function sanitizeSheetName_(name) {
  return name.replace(/[\/\\\?\*\[\]:]/g, '_').substring(0, 90);
}

function getRosterSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName('Roster');
  if (!sheet) {
    sheet = ss.insertSheet('Roster');
    sheet.appendRow(['key', 'healthCertExpiry', 'hireDate', 'sortOrder']);
    sheet.getRange('B:C').setNumberFormat('@');
    cleanupDefaultSheets_(ss);
  }
  return sheet;
}

function getRosterData(adminPw) {
  requireAdmin_(adminPw);
  const sheet = getRosterSheet_();
  const data = sheet.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < data.length; i++) {
    list.push({
      key: data[i][0],
      healthCertExpiry: data[i][1] || '',
      hireDate: data[i][2] || '',
      sortOrder: Number(data[i][3]) || 0
    });
  }
  return list;
}

function saveRosterEntry(key, healthCertExpiry, hireDate, adminPw) {
  requireAdmin_(adminPw);
  const sheet = getRosterSheet_();
  const row = findRow_(sheet, 0, key);
  let existingOrder = 0;
  if (row !== -1) existingOrder = Number(sheet.getRange(row, 4).getValue()) || 0;
  const rowData = [key, healthCertExpiry || '', hireDate || '', existingOrder];
  if (row === -1) sheet.appendRow(rowData);
  else sheet.getRange(row, 1, 1, 4).setValues([rowData]);
  return true;
}

// 이름 순서 맞바꾸기 (관리자가 근로자별 신청현황에서 위/아래로 이동)
function swapSortOrder(keyA, keyB, adminPw) {
  requireAdmin_(adminPw);
  const sheet = getRosterSheet_();
  function getOrCreateRow(key) {
    let row = findRow_(sheet, 0, key);
    if (row === -1) {
      sheet.appendRow([key, '', '', 0]);
      row = sheet.getLastRow();
    }
    return row;
  }
  const rowA = getOrCreateRow(keyA);
  const rowB = getOrCreateRow(keyB);
  const orderA = Number(sheet.getRange(rowA, 4).getValue()) || 0;
  const orderB = Number(sheet.getRange(rowB, 4).getValue()) || 0;
  sheet.getRange(rowA, 4).setValue(orderB);
  sheet.getRange(rowB, 4).setValue(orderA);
  return true;
}

// ---- 근로 이력 (자동: 배치 시 기록 / 수동: 과거 월별 입력) ----
function getHistorySheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName('History');
  if (!sheet) {
    sheet = ss.insertSheet('History');
    sheet.appendRow(['histKey', 'key', 'date']);
    sheet.getRange('C:C').setNumberFormat('@');
    cleanupDefaultSheets_(ss);
  }
  return sheet;
}

function logHistory_(key, date) {
  const sheet = getHistorySheet_();
  const histKey = key + '_' + date;
  const row = findRow_(sheet, 0, histKey);
  if (row === -1) sheet.appendRow([histKey, key, date]);
}

function removeHistory_(key, date) {
  const sheet = getHistorySheet_();
  const histKey = key + '_' + date;
  const row = findRow_(sheet, 0, histKey);
  if (row > -1) sheet.deleteRow(row);
}

// 근로자 신청 화면(getTwoWeekDates, index.html)과 동일한 규칙(이번 주 월요일부터 14일)의
// 날짜 집합을 서버에서 계산한다. 이 창 밖의 날짜는 애초에 화면에 보이지 않으므로 신청 수정 시
// shifts에 안 들어있어도 "취소"가 아니라 단순히 편집 대상이 아니었던 것으로 봐야 한다.
function getCurrentTwoWeekDateSet_() {
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const dayOfWeek = Number(Utilities.formatDate(now, tz, 'u')); // 1=월 ... 7=일
  const start = new Date(now);
  start.setDate(start.getDate() - (dayOfWeek - 1));
  const set = new Set();
  for (let i = 0; i < 14; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    set.add(Utilities.formatDate(d, tz, 'yyyy-MM-dd'));
  }
  return set;
}

// 근로자 신청 수정/취소로 사라진 (날짜,시프트) 중, 실제로 화면에 보였던(=이번 주~다음 주)
// 날짜에 한해서만 Assign/History에서 제거한다.
// oldShifts/newShifts: [{date, day, night}, ...] (전체 취소 시 newShifts는 빈 배열)
function removeCanceledAssignments_(key, oldShifts, newShifts) {
  const currentWindow = getCurrentTwoWeekDateSet_();
  const newMap = {};
  (newShifts || []).forEach(s => { newMap[s.date] = s; });
  const asheet = getAssignSheet_();
  (oldShifts || []).forEach(old => {
    if (!currentWindow.has(old.date)) return; // 화면에 안 보이는(지난 주 이전) 날짜는 취소로 보지 않는다
    const cur = newMap[old.date] || {};
    ['day', 'night'].forEach(shift => {
      if (!old[shift] || cur[shift]) return;
      const row = findRow_(asheet, 0, makeAssignKey_(old.date, shift, key));
      if (row > -1) asheet.deleteRow(row);
      const otherShift = shift === 'day' ? 'night' : 'day';
      const stillHas = findRow_(asheet, 0, makeAssignKey_(old.date, otherShift, key)) > -1;
      if (!stillHas) removeHistory_(key, old.date);
    });
  });
}

function getPastMonthlySheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName('PastMonthly');
  if (!sheet) {
    sheet = ss.insertSheet('PastMonthly');
    sheet.appendRow(['pmKey', 'key', 'yearMonth', 'days']);
    sheet.getRange('C:C').setNumberFormat('@');
    cleanupDefaultSheets_(ss);
  }
  return sheet;
}

function getPastMonthlyEntries(key, adminPw) {
  requireAdmin_(adminPw);
  const sheet = getPastMonthlySheet_();
  const data = sheet.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === key) list.push({ yearMonth: String(data[i][2]), days: Number(data[i][3]) || 0 });
  }
  return list;
}

function savePastMonthly(key, yearMonth, days, adminPw) {
  requireAdmin_(adminPw);
  const sheet = getPastMonthlySheet_();
  const pmKey = key + '_' + yearMonth;
  const row = findRow_(sheet, 0, pmKey);
  const rowData = [pmKey, key, yearMonth, Number(days) || 0];
  if (row === -1) sheet.appendRow(rowData);
  else sheet.getRange(row, 1, 1, 4).setValues([rowData]);
  return true;
}

function deletePastMonthly(key, yearMonth, adminPw) {
  requireAdmin_(adminPw);
  const sheet = getPastMonthlySheet_();
  const pmKey = key + '_' + yearMonth;
  const row = findRow_(sheet, 0, pmKey);
  if (row > -1) sheet.deleteRow(row);
  return true;
}

// 자동(History) + 수동(PastMonthly)을 합쳐 사람별 월별 근로일수 / 연속근로개월수 계산
function getWorkStats(adminPw) {
  requireAdmin_(adminPw);
  const histSheet = getHistorySheet_();
  const histData = histSheet.getDataRange().getValues();
  const autoByKey = {};
  for (let i = 1; i < histData.length; i++) {
    const k = histData[i][1];
    const d = toDateStr_(histData[i][2]);
    const ym = d.substring(0, 7);
    if (!autoByKey[k]) autoByKey[k] = {};
    autoByKey[k][ym] = (autoByKey[k][ym] || 0) + 1;
  }

  const pmSheet = getPastMonthlySheet_();
  const pmData = pmSheet.getDataRange().getValues();
  const manualByKey = {};
  for (let i = 1; i < pmData.length; i++) {
    const k = pmData[i][1];
    const ym = String(pmData[i][2]);
    if (!manualByKey[k]) manualByKey[k] = {};
    manualByKey[k][ym] = Number(pmData[i][3]) || 0;
  }

  const allKeys = new Set(Object.keys(autoByKey).concat(Object.keys(manualByKey)));
  const result = {};
  const now = new Date();
  allKeys.forEach(k => {
    const monthly = Object.assign({}, manualByKey[k] || {}, autoByKey[k] || {});
    let consecutive = 0;
    const cursor = new Date(now.getFullYear(), now.getMonth(), 1);
    while (true) {
      const ym = Utilities.formatDate(cursor, Session.getScriptTimeZone(), 'yyyy-MM');
      if (monthly[ym] && monthly[ym] > 0) {
        consecutive++;
        cursor.setMonth(cursor.getMonth() - 1);
      } else {
        break;
      }
    }
    result[k] = { monthly: monthly, consecutiveMonths: consecutive };
  });
  return result;
}

function getSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  let ssId = props.getProperty('SS_ID');
  let ss = null;
  if (ssId) {
    try { ss = SpreadsheetApp.openById(ssId); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(NEW_SHEET_NAME);
    props.setProperty('SS_ID', ss.getId());
  }
  return ss;
}

function cleanupDefaultSheets_(ss) {
  ss.getSheets().forEach(s => {
    if (['Data', 'Assign', 'Target', 'Roster'].indexOf(s.getName()) === -1 && s.getLastRow() === 0) {
      ss.deleteSheet(s);
    }
  });
}

function getDataSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName('Data');
  if (!sheet) {
    sheet = ss.insertSheet('Data');
    sheet.appendRow(['key', 'name', 'phone', 'pin', 'updatedAt', 'shiftsJSON', 'locationsJSON', 'adminLocation', 'message', 'gender', 'adminGender', 'adConsent']);
    cleanupDefaultSheets_(ss);
  }
  sheet.getRange('D:D').setNumberFormat('@'); // pin 앞자리 0 유실 방지 (기존 시트에도 매번 적용)
  return sheet;
}

function getAssignSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName('Assign');
  if (!sheet) {
    sheet = ss.insertSheet('Assign');
    sheet.appendRow(['assignKey', 'date', 'shift', 'key', 'name', 'gender', 'floor', 'isEducation', 'isNew', 'isWomenWage', 'location']);
    sheet.getRange('B:B').setNumberFormat('@');
    cleanupDefaultSheets_(ss);
  }
  return sheet;
}

function getTargetSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName('Target');
  if (!sheet) {
    sheet = ss.insertSheet('Target');
    sheet.appendRow(['targetKey', 'date', 'shift', 'maleTarget', 'femaleTarget']);
    sheet.getRange('B:B').setNumberFormat('@');
    cleanupDefaultSheets_(ss);
  }
  return sheet;
}

function toDateStr_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value);
}

// 숫자처럼 보이는 값(pin 등)이 시트에 쓸 때 자동으로 숫자로 변환되어 앞자리 0이 사라지는 것을 방지
function toTextCell_(v) {
  const s = String(v || '');
  return s ? "'" + s : '';
}

function makeKey_(name, pin) {
  return Utilities.base64Encode(name.trim() + '|' + pin.trim());
}
function makeAssignKey_(date, shift, key) {
  return date + '_' + shift + '_' + key;
}
function makeTargetKey_(date, shift) {
  return date + '_' + shift;
}
function findRow_(sheet, colIndex, value) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][colIndex] === value) return i + 1;
  }
  return -1;
}

// ---- 신청 관련 ----
function lookupRecord(name, pin) {
  const sheet = getDataSheet_();
  const key = makeKey_(name, pin);
  const row = findRow_(sheet, 0, key);
  if (row === -1) return null;
  const v = sheet.getRange(row, 1, 1, 12).getValues()[0];
  return { name: v[1], phone: v[2], shifts: JSON.parse(v[5] || '[]'), locations: JSON.parse(v[6] || '[]'), message: v[8] || '', gender: v[9] || '', adConsent: v[11] || '' };
}

// 여러 명의 근무자를 한 번에 일괄 등록 (관리자 추가 화면에서 사용)
function batchSaveRecords(list, adminPw) {
  requireAdmin_(adminPw);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getDataSheet_();
    const data = sheet.getDataRange().getValues();
    const keyToRow = {};
    for (let i = 1; i < data.length; i++) keyToRow[data[i][0]] = i + 1;
    const now = new Date().toISOString();

    const newRows = [];
    const pendingNewIndexByKey = {}; // 같은 배치(list) 안에 동일 key가 두 번 들어와도 새 행이 중복 생성되지 않도록 추적
    list.forEach(item => {
      const key = makeKey_(item.name, item.pin || '');
      const row = keyToRow[key];
      let existingAdminLocation = '';
      let existingAdminGender = '';
      let existingAdConsent = '';
      if (row) {
        existingAdminLocation = sheet.getRange(row, 8).getValue() || '';
        existingAdminGender = sheet.getRange(row, 11).getValue() || '';
        existingAdConsent = sheet.getRange(row, 12).getValue() || '';
      }
      const rowData = [
        key, (item.name || '').trim(), toTextCell_((item.phone || '').trim()), toTextCell_((item.pin || '').trim()), now,
        JSON.stringify(item.shifts || []), JSON.stringify(item.locations || []),
        existingAdminLocation, '', item.gender || '', existingAdminGender, existingAdConsent
      ];
      if (row) {
        sheet.getRange(row, 1, 1, 12).setValues([rowData]);
      } else if (pendingNewIndexByKey.hasOwnProperty(key)) {
        newRows[pendingNewIndexByKey[key]] = rowData;
      } else {
        pendingNewIndexByKey[key] = newRows.length;
        newRows.push(rowData);
      }
    });

    // 새로 추가되는 사람은 한 번에 묶어서 기록 (건별 appendRow보다 훨씬 빠름)
    if (newRows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 12).setValues(newRows);
    }
  } finally {
    lock.releaseLock();
  }

  rebuildLocationSheets_();
  return true;
}

function saveRecord(name, pin, phone, shifts, locations, message, gender, adConsent) {
  // 동시에 두 요청이 들어오면 둘 다 "기존 행 없음"으로 보고 동일 key로 각각 appendRow 하여
  // 중복 행이 생길 수 있어(findRow_는 항상 첫 번째 매칭 행만 찾으므로 이후 수정은 그 중 하나만 반영됨),
  // 찾기~쓰기 구간을 잠가 원자적으로 만든다.
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  const key = makeKey_(name, pin);
  let oldShifts = [];
  let mergedShifts = [];
  try {
    const sheet = getDataSheet_();
    const row = findRow_(sheet, 0, key);
    const now = new Date().toISOString();
    let existingAdminLocation = '';
    let existingAdminGender = '';
    if (row !== -1) {
      existingAdminLocation = sheet.getRange(row, 8).getValue() || '';
      existingAdminGender = sheet.getRange(row, 11).getValue() || '';
      oldShifts = JSON.parse(sheet.getRange(row, 6).getValue() || '[]');
    }
    // 오늘 이전 날짜는 화면에서 수정이 막혀 있지만, 클라이언트를 우회해 saveRecord가 직접 호출될 수도 있으므로
    // 서버에서도 과거 날짜분은 기존 값을 그대로 유지하고 클라이언트가 보낸 값은 무시한다.
    const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const pastOldShifts = oldShifts.filter(s => s.date < todayStr);
    const newShifts = (shifts || []).filter(s => s.date >= todayStr);
    mergedShifts = pastOldShifts.concat(newShifts);
    const rowData = [key, name.trim(), toTextCell_(phone.trim()), toTextCell_(pin.trim()), now, JSON.stringify(mergedShifts), JSON.stringify(locations || []), existingAdminLocation, (message || '').trim(), gender || '', existingAdminGender, adConsent || ''];
    console.log("pin: %s, phone: %s", pin, phone);
    if (row === -1) sheet.appendRow(rowData);
    else sheet.getRange(row, 1, 1, 12).setValues([rowData]);
  } finally {
    lock.releaseLock();
  }
  // 신청 수정으로 이번에 빠진 (날짜,시프트)만 부분취소로 보고 Assign/History에서 제거한다.
  removeCanceledAssignments_(key, oldShifts, mergedShifts);
  rebuildLocationSheets_();
  return true;
}

// 관리자가 성별 표시를 직접 수정
function setAdminGender(key, gender, adminPw) {
  requireAdmin_(adminPw);
  const sheet = getDataSheet_();
  const row = findRow_(sheet, 0, key);
  if (row === -1) return false;
  sheet.getRange(row, 11).setValue(gender || '');
  return true;
}

// 여러 명의 성별을 한 번에 일괄 저장
function batchSetGender(list, adminPw) {
  requireAdmin_(adminPw);
  const sheet = getDataSheet_();
  const data = sheet.getDataRange().getValues();
  const keyToRow = {};
  for (let i = 1; i < data.length; i++) keyToRow[data[i][0]] = i + 1;
  list.forEach(item => {
    const row = keyToRow[item.key];
    if (row) sheet.getRange(row, 11).setValue(item.gender || '');
  });
  return true;
}

// 여러 명의 배치 장소를 한 번에 일괄 저장
function batchSetLocations(list, adminPw) {
  requireAdmin_(adminPw);
  const sheet = getDataSheet_();
  const data = sheet.getDataRange().getValues();
  const keyToRow = {};
  for (let i = 1; i < data.length; i++) keyToRow[data[i][0]] = i + 1;
  list.forEach(item => {
    const row = keyToRow[item.key];
    if (row) sheet.getRange(row, 8).setValue(item.location || '');
  });
  rebuildLocationSheets_();
  return true;
}

// 여러 날짜/시간대의 목표 인원을 한 번에 일괄 저장
function batchSaveTargets(list, adminPw) {
  requireAdmin_(adminPw);
  const sheet = getTargetSheet_();
  const data = sheet.getDataRange().getValues();
  const keyToRow = {};
  for (let i = 1; i < data.length; i++) keyToRow[data[i][0]] = i + 1;
  list.forEach(item => {
    const targetKey = makeTargetKey_(item.date, item.shift);
    const rowData = [targetKey, item.date, item.shift, Number(item.maleTarget) || 0, Number(item.femaleTarget) || 0];
    const row = keyToRow[targetKey];
    if (!row) {
      sheet.appendRow(rowData);
      keyToRow[targetKey] = sheet.getLastRow();
    } else {
      sheet.getRange(row, 1, 1, 5).setValues([rowData]);
    }
  });
  return true;
}

// 전체신청자(roster) 화면의 건강증만료일/입사일을 한 번에 일괄 저장
function batchSaveRoster(list, adminPw) {
  requireAdmin_(adminPw);
  const sheet = getRosterSheet_();
  const data = sheet.getDataRange().getValues();
  const keyToRow = {};
  for (let i = 1; i < data.length; i++) keyToRow[data[i][0]] = i + 1;
  list.forEach(item => {
    let row = keyToRow[item.key];
    let existingOrder = 0;
    if (row) existingOrder = Number(sheet.getRange(row, 4).getValue()) || 0;
    const rowData = [item.key, item.healthCertExpiry || '', item.hireDate || '', existingOrder];
    if (!row) {
      sheet.appendRow(rowData);
      keyToRow[item.key] = sheet.getLastRow();
    } else {
      sheet.getRange(row, 1, 1, 4).setValues([rowData]);
    }
  });
  return true;
}

// 관리자가 실제 배치 장소를 별도로 지정/변경 (신청 장소와 다를 수 있음)
// 관리자가 근로자의 근무 일정(주간/야간)을 직접 수정
function adminUpdateShifts(key, shifts, adminPw) {
  requireAdmin_(adminPw);
  const sheet = getDataSheet_();
  const row = findRow_(sheet, 0, key);
  if (row === -1) return false;
  sheet.getRange(row, 6).setValue(JSON.stringify(shifts));
  rebuildLocationSheets_();
  return true;
}

// 연락처/생년월일(핀)을 나중에 추가/수정. 핀이 바뀌면 key가 바뀌므로 관련 시트를 모두 옮겨준다.
function setContactInfo(oldKey, phone, newPin, adminPw) {
  requireAdmin_(adminPw);
  const sheet = getDataSheet_();
  const row = findRow_(sheet, 0, oldKey);
  if (row === -1) return false;

  const name = sheet.getRange(row, 2).getValue();
  const currentPin = sheet.getRange(row, 4).getValue() || '';
  const finalPin = (newPin === undefined || newPin === null) ? currentPin : newPin;
  const newKey = makeKey_(name, finalPin || '');

  sheet.getRange(row, 3).setValue(toTextCell_(phone || ''));
  sheet.getRange(row, 4).setValue(toTextCell_(finalPin || ''));

  if (newKey !== oldKey) {
    sheet.getRange(row, 1).setValue(newKey);
    reKeyRelatedSheets_(oldKey, newKey);
  }
  rebuildLocationSheets_();
  return true;
}

function reKeyRelatedSheets_(oldKey, newKey) {
  const assignSheet = getAssignSheet_();
  const aData = assignSheet.getDataRange().getValues();
  for (let i = 1; i < aData.length; i++) {
    if (aData[i][3] === oldKey) {
      const newAssignKey = makeAssignKey_(aData[i][1], aData[i][2], newKey);
      assignSheet.getRange(i + 1, 1).setValue(newAssignKey);
      assignSheet.getRange(i + 1, 4).setValue(newKey);
    }
  }

  const histSheet = getHistorySheet_();
  const hData = histSheet.getDataRange().getValues();
  for (let i = 1; i < hData.length; i++) {
    if (hData[i][1] === oldKey) {
      const dateStr = toDateStr_(hData[i][2]);
      histSheet.getRange(i + 1, 1).setValue(newKey + '_' + dateStr);
      histSheet.getRange(i + 1, 2).setValue(newKey);
    }
  }

  const rosterSheet = getRosterSheet_();
  const rData = rosterSheet.getDataRange().getValues();
  for (let i = 1; i < rData.length; i++) {
    if (rData[i][0] === oldKey) rosterSheet.getRange(i + 1, 1).setValue(newKey);
  }

  const pmSheet = getPastMonthlySheet_();
  const pData = pmSheet.getDataRange().getValues();
  for (let i = 1; i < pData.length; i++) {
    if (pData[i][1] === oldKey) {
      const ym = String(pData[i][2]);
      pmSheet.getRange(i + 1, 1).setValue(newKey + '_' + ym);
      pmSheet.getRange(i + 1, 2).setValue(newKey);
    }
  }
}

function setAdminLocation(key, location, adminPw) {
  requireAdmin_(adminPw);
  const sheet = getDataSheet_();
  const row = findRow_(sheet, 0, key);
  if (row === -1) return false;
  sheet.getRange(row, 8).setValue(location || '');
  rebuildLocationSheets_();
  return true;
}

function deleteRecord(name, pin) {
  const sheet = getDataSheet_();
  const key = makeKey_(name, pin);
  const row = findRow_(sheet, 0, key);
  let oldShifts = [];
  if (row > -1) {
    oldShifts = JSON.parse(sheet.getRange(row, 6).getValue() || '[]');
    sheet.deleteRow(row);
  }
  // 취소 시점에 신청되어 있던 (날짜,시프트)의 배치만 Assign/History에서 제거하고, 그 외 이력은 보존한다.
  removeCanceledAssignments_(key, oldShifts, []);
  rebuildLocationSheets_();
  return true;
}

function getAdminData(adminPw) {
  requireAdmin_(adminPw);
  const sheet = getDataSheet_();
  const data = sheet.getDataRange().getValues();

  const rosterSheet = getRosterSheet_();
  const rosterData = rosterSheet.getDataRange().getValues();
  const orderByKey = {};
  for (let i = 1; i < rosterData.length; i++) {
    orderByKey[rosterData[i][0]] = Number(rosterData[i][3]) || 0;
  }

  const records = [];
  for (let i = 1; i < data.length; i++) {
    records.push({
      key: data[i][0],
      name: data[i][1],
      phone: data[i][2],
      pin: data[i][3] || '',
      shifts: JSON.parse(data[i][5] || '[]'),
      locations: JSON.parse(data[i][6] || '[]'),
      adminLocation: data[i][7] || '',
      message: data[i][8] || '',
      gender: data[i][9] || '',
      adminGender: data[i][10] || '',
      adConsent: data[i][11] || '',
      sortOrder: orderByKey[data[i][0]] || 0
    });
  }
  return records;
}

// 근무 장소별로 별도 시트에 데이터 복제 (신청/수정/취소 시마다 전체 재구성)
function rebuildLocationSheets_() {
  const ss = getSpreadsheet_();
  const dataSheet = getDataSheet_();
  const data = dataSheet.getDataRange().getValues();
  const records = [];
  for (let i = 1; i < data.length; i++) {
    const requested = JSON.parse(data[i][6] || '[]');
    const adminLoc = data[i][7] || '';
    records.push({
      name: data[i][1], phone: data[i][2], updatedAt: data[i][4],
      shiftsJSON: data[i][5],
      effectiveLocation: adminLoc || (requested[0] || '')
    });
  }

  LOCATIONS.forEach(loc => {
    const sheetName = sanitizeSheetName_(loc);
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);
    sheet.clear();
    const matched = records.filter(r => r.effectiveLocation === loc);
    const rows = [['name', 'phone', 'updatedAt', 'shiftsJSON']]
      .concat(matched.map(r => [r.name, toTextCell_(r.phone), r.updatedAt, r.shiftsJSON]));
    sheet.getRange(1, 1, rows.length, 4).setValues(rows);
  });
}

// ---- 배치 관련 ----
// Data 시트 기준 근로자별 신청 근무지(adminLocation 우선, 없으면 첫 신청 근무지)를 일괄 조회
function getKeyToLocationMap_() {
  const sheet = getDataSheet_();
  const data = sheet.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < data.length; i++) {
    let locations = [];
    try { locations = JSON.parse(data[i][6] || '[]'); } catch (e) {}
    map[data[i][0]] = data[i][7] || locations[0] || '';
  }
  return map;
}

function getAssignments(adminPw) {
  requireAdmin_(adminPw);
  const sheet = getAssignSheet_();
  const data = sheet.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < data.length; i++) {
    list.push({
      date: toDateStr_(data[i][1]), shift: data[i][2], key: data[i][3],
      name: data[i][4], gender: data[i][5], floor: data[i][6],
      isEducation: data[i][7] === true || data[i][7] === 'TRUE',
      isNew: data[i][8] === true || data[i][8] === 'TRUE',
      isWomenWage: data[i][9] === true || data[i][9] === 'TRUE',
      location: data[i][10] || ''
    });
  }
  return list;
}

function saveAssignment(date, shift, key, name, gender, floor, isEducation, isNew, isWomenWage, adminPw) {
  requireAdmin_(adminPw);
  const sheet = getAssignSheet_();
  const assignKey = makeAssignKey_(date, shift, key);
  const row = findRow_(sheet, 0, assignKey);
  const location = getKeyToLocationMap_()[key] || '';
  const rowData = [assignKey, date, shift, key, name, gender, floor, !!isEducation, !!isNew, !!isWomenWage, location];
  if (row === -1) sheet.appendRow(rowData);
  else sheet.getRange(row, 1, 1, 11).setValues([rowData]);
  logHistory_(key, date);
  return true;
}

// 여러 명을 한 번에 배치 (서버 왕복을 1번으로 줄여서 빠르게 처리)
function batchSaveAssignments(list, adminPw) {
  requireAdmin_(adminPw);
  const sheet = getAssignSheet_();
  const data = sheet.getDataRange().getValues();
  const keyToRow = {};
  for (let i = 1; i < data.length; i++) keyToRow[data[i][0]] = i + 1;
  const keyToLocation = getKeyToLocationMap_();

  list.forEach(item => {
    const assignKey = makeAssignKey_(item.date, item.shift, item.key);
    const rowData = [assignKey, item.date, item.shift, item.key, item.name, item.gender, item.floor, !!item.isEducation, !!item.isNew, !!item.isWomenWage, keyToLocation[item.key] || ''];
    const row = keyToRow[assignKey];
    if (!row) {
      sheet.appendRow(rowData);
      keyToRow[assignKey] = sheet.getLastRow();
    } else {
      sheet.getRange(row, 1, 1, 11).setValues([rowData]);
    }
    logHistory_(item.key, item.date);
  });
  return true;
}

function removeAssignment(date, shift, key, adminPw) {
  requireAdmin_(adminPw);
  const sheet = getAssignSheet_();
  const assignKey = makeAssignKey_(date, shift, key);
  const row = findRow_(sheet, 0, assignKey);
  if (row > -1) sheet.deleteRow(row);

  // 같은 날짜에 다른 시프트로 남아있는 배치가 없을 때만 이력에서도 제거
  const otherShift = shift === 'day' ? 'night' : 'day';
  const otherAssignKey = makeAssignKey_(date, otherShift, key);
  const stillHas = findRow_(sheet, 0, otherAssignKey) > -1;
  if (!stillHas) removeHistory_(key, date);
  return true;
}

// 여러 명을 한 번에 배치취소 (서버 왕복을 1번으로 줄여서 빠르게 처리)
function batchRemoveAssignments(list, adminPw) {
  requireAdmin_(adminPw);
  const sheet = getAssignSheet_();
  const data = sheet.getDataRange().getValues();
  const keyToRow = {};
  for (let i = 1; i < data.length; i++) keyToRow[data[i][0]] = i + 1;

  const rowsToDelete = [];
  list.forEach(item => {
    const assignKey = makeAssignKey_(item.date, item.shift, item.key);
    const row = keyToRow[assignKey];
    if (row) rowsToDelete.push(row);
  });
  rowsToDelete.sort((a, b) => b - a).forEach(row => sheet.deleteRow(row));

  // 같은 날짜에 다른 시프트로 남아있는 배치가 없을 때만 이력에서도 제거
  list.forEach(item => {
    const otherShift = item.shift === 'day' ? 'night' : 'day';
    const otherAssignKey = makeAssignKey_(item.date, otherShift, item.key);
    const stillHas = findRow_(sheet, 0, otherAssignKey) > -1;
    if (!stillHas) removeHistory_(item.key, item.date);
  });
  return true;
}

// ---- 목표 인원 관련 ----
function getTargets(adminPw) {
  requireAdmin_(adminPw);
  const sheet = getTargetSheet_();
  const data = sheet.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < data.length; i++) {
    list.push({
      date: toDateStr_(data[i][1]), shift: data[i][2],
      maleTarget: Number(data[i][3]) || 0,
      femaleTarget: Number(data[i][4]) || 0
    });
  }
  return list;
}

function saveTarget(date, shift, maleTarget, femaleTarget, adminPw) {
  requireAdmin_(adminPw);
  const sheet = getTargetSheet_();
  const targetKey = makeTargetKey_(date, shift);
  const row = findRow_(sheet, 0, targetKey);
  const rowData = [targetKey, date, shift, Number(maleTarget) || 0, Number(femaleTarget) || 0];
  if (row === -1) sheet.appendRow(rowData);
  else sheet.getRange(row, 1, 1, 5).setValues([rowData]);
  return true;
}
