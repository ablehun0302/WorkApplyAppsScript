// ===== 근무 신청 시스템 데이터 계층 (Google Sheets 접근 + CRUD) =====

const NEW_SHEET_NAME = '근무신청시스템_데이터'; // 시트 생성 시 해당 이름으로 생성

function getOrCreateSheet_(name, headers, textFormatCols) {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    if (textFormatCols) sheet.getRange(textFormatCols).setNumberFormat('@');
    cleanupDefaultSheets_(ss);
  }
  return sheet;
}

function getRosterSheet_() {
  return getOrCreateSheet_('Roster', ['key', 'healthCertExpiry', 'hireDate', 'sortOrder'], 'B:C');
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
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getRosterSheet_();
    const row = findRow_(sheet, 0, key);
    let existingOrder = 0;
    if (row !== -1) existingOrder = Number(sheet.getRange(row, 4).getValue()) || 0;
    const rowData = [key, healthCertExpiry || '', hireDate || '', existingOrder];
    if (row === -1) sheet.appendRow(rowData);
    else sheet.getRange(row, 1, 1, 4).setValues([rowData]);
  } finally {
    lock.releaseLock();
  }
  return true;
}

// 이름 순서 맞바꾸기 (관리자가 근로자별 신청현황에서 위/아래로 이동)
function swapSortOrder(keyA, keyB, adminPw) {
  requireAdmin_(adminPw);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
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
  } finally {
    lock.releaseLock();
  }
  return true;
}

// ---- 근로 이력 (자동: 배치 시 기록 / 수동: 과거 월별 입력) ----
function getHistorySheet_() {
  return getOrCreateSheet_('History', ['histKey', 'key', 'date'], 'C:C');
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

// logHistory_/removeHistory_를 루프 안에서 건별로 호출하면 매번 History 시트를 통째로 다시 읽게 되므로,
// 여러 건을 처리할 때는 시트를 한 번만 읽어서 처리하는 아래 배치 버전을 사용한다.
function batchLogHistory_(items) {
  if (!items || items.length === 0) return;
  const sheet = getHistorySheet_();
  const data = sheet.getDataRange().getValues();
  const existing = new Set();
  for (let i = 1; i < data.length; i++) existing.add(data[i][0]);

  const seen = new Set();
  const newRows = [];
  items.forEach(item => {
    const histKey = item.key + '_' + item.date;
    if (existing.has(histKey) || seen.has(histKey)) return;
    seen.add(histKey);
    newRows.push([histKey, item.key, item.date]);
  });
  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 3).setValues(newRows);
  }
}

function batchRemoveHistory_(items) {
  if (!items || items.length === 0) return;
  const sheet = getHistorySheet_();
  const data = sheet.getDataRange().getValues();
  const keyToRow = {};
  for (let i = 1; i < data.length; i++) keyToRow[data[i][0]] = i + 1;

  const rowsToDelete = new Set();
  items.forEach(item => {
    const row = keyToRow[item.key + '_' + item.date];
    if (row) rowsToDelete.add(row);
  });
  Array.from(rowsToDelete).sort((a, b) => b - a).forEach(row => sheet.deleteRow(row));
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

  // 날짜 수만큼 findRow_(=시트 전체 재조회)가 반복 호출되는 것을 막기 위해
  // Assign 시트를 한 번만 읽어 메모리에서 처리한다.
  const asheet = getAssignSheet_();
  const aData = asheet.getDataRange().getValues();
  const assignKeyToRow = {};
  for (let i = 1; i < aData.length; i++) assignKeyToRow[aData[i][0]] = i + 1;

  const rowsToDelete = [];
  const historyRemovals = [];
  (oldShifts || []).forEach(old => {
    if (!currentWindow.has(old.date)) return; // 화면에 안 보이는(지난 주 이전) 날짜는 취소로 보지 않는다
    const cur = newMap[old.date] || {};
    ['day', 'night'].forEach(shift => {
      if (!old[shift] || cur[shift]) return;
      const assignKey = makeAssignKey_(old.date, shift, key);
      const row = assignKeyToRow[assignKey];
      if (row) {
        rowsToDelete.push(row);
        delete assignKeyToRow[assignKey];
      }
      const otherShift = shift === 'day' ? 'night' : 'day';
      const stillHas = !!assignKeyToRow[makeAssignKey_(old.date, otherShift, key)];
      if (!stillHas) historyRemovals.push({ key: key, date: old.date });
    });
  });

  rowsToDelete.sort((a, b) => b - a).forEach(row => asheet.deleteRow(row));
  batchRemoveHistory_(historyRemovals);
}

function getPastMonthlySheet_() {
  return getOrCreateSheet_('PastMonthly', ['pmKey', 'key', 'yearMonth', 'days'], 'C:C');
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
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getPastMonthlySheet_();
    const pmKey = key + '_' + yearMonth;
    const row = findRow_(sheet, 0, pmKey);
    const rowData = [pmKey, key, yearMonth, Number(days) || 0];
    if (row === -1) sheet.appendRow(rowData);
    else sheet.getRange(row, 1, 1, 4).setValues([rowData]);
  } finally {
    lock.releaseLock();
  }
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
    try { ss = SpreadsheetApp.openById(ssId); } catch (e) { Logger.log('실패 원인: ' + e.message); ss = null; }
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

const DATA_HEADERS = ['key', 'name', 'phone', 'pin', 'updatedAt', 'shiftsJSON', 'locationsJSON', 'adminLocation', 'message', 'gender', 'adminGender', 'adConsent'];

function getDataSheet_() {
  const sheet = getOrCreateSheet_('Data', DATA_HEADERS);
  sheet.getRange('D:D').setNumberFormat('@'); // pin 앞자리 0 유실 방지 (기존 시트에도 매번 적용)
  return sheet;
}

// Data에 없는 신규 근무자의 신청은 관리자가 승인하기 전까지 이 시트에 쌓인다.
// 컬럼을 Data와 똑같이 두어 승인할 때 행을 그대로 옮긴다(adminLocation·adminGender 칸은 비워 둔다).
function getPendingSheet_() {
  const sheet = getOrCreateSheet_('신규데이터', DATA_HEADERS);
  sheet.getRange('D:D').setNumberFormat('@');
  return sheet;
}

function getAssignSheet_() {
  return getOrCreateSheet_('Assign', ['assignKey', 'date', 'shift', 'key', 'name', 'gender', 'floor', 'isEducation', 'isNew', 'isWomenWage', 'location', 'transport'], 'B:B');
}

function getTargetSheet_() {
  return getOrCreateSheet_('Target', ['targetKey', 'date', 'shift', 'maleTarget', 'femaleTarget'], 'B:B');
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
function lookupRecordInSheet_(sheet, key) {
  const data = sheet.getDataRange().getValues();
  let record = null;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      const v = data[i];
      // adminLocation은 근무자가 고치는 값이 아니지만, 날짜별 근무지의 기준이 되는 "기본 근무지"가
      // adminLocation → locations[0] 순이므로 신청 화면이 이 값을 알아야 실효 근무지를 맞게 보여준다.
      record = { name: v[1], phone: v[2], shifts: JSON.parse(v[5] || '[]'), locations: JSON.parse(v[6] || '[]'), adminLocation: v[7] || '', message: v[8] || '', gender: v[9] || '', adConsent: v[11] || '' };
    }
  }
  return record;
}

// record: 기존 신청 내역(name+pin 정확히 일치)
// pending: Data에는 없고 신규데이터 시트에 승인 대기 중인 신청이면 true
function lookupRecord(name, pin) {
  try {
    const key = makeKey_(name, pin);
    let record = lookupRecordInSheet_(getDataSheet_(), key);
    let pending = false;
    if (!record) {
      record = lookupRecordInSheet_(getPendingSheet_(), key);
      pending = !!record;
    }
    return { record: record, pending: pending };
  } catch (e) {
    Logger.log('lookupRecord 실패 원인: ' + e.message);
    throw e;
  }
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
      let existingShifts = [];
      if (row) {
        // 위에서 이미 읽어둔 data 배열에 있는 값이므로 getRange().getValue()로 다시 조회하지 않는다.
        existingAdminLocation = data[row - 1][7] || '';
        existingAdminGender = data[row - 1][10] || '';
        existingAdConsent = data[row - 1][11] || '';
        try { existingShifts = JSON.parse(data[row - 1][5] || '[]'); } catch (e) { Logger.log('실패 원인: ' + e.message); }
      }
      const rowData = [
        key, (item.name || '').trim(), toTextCell_((item.phone || '').trim()), toTextCell_((item.pin || '').trim()), now,
        JSON.stringify(mergeShiftExtras_(existingShifts, item.shifts || [])), JSON.stringify(item.locations || []),
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

  return true;
}

function saveRecord(name, pin, phone, shifts, locations, message, gender, adConsent) {
  // 행을 읽고 다시 쓰는 사이에 다른 요청(관리자의 근무자 추가 등)이 같은 행을 바꾸면 그 변경을
  // 덮어쓰게 되므로, 찾기~쓰기 구간을 잠가 원자적으로 만든다.
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  const key = makeKey_(name, pin);
  let oldShifts = [];
  let mergedShifts = [];
  try {
    const sheet = getDataSheet_();
    const row = findRow_(sheet, 0, key);
    // Data에 등록된 사람(이름+생년월일 일치)의 신청만 Data에 바로 반영한다. 새 사람의 신청은
    // 신규데이터 시트에 두었다가 관리자가 승인하면 Data로 옮긴다.
    if (row === -1) {
      savePendingRecord_(key, name, pin, phone, shifts, locations, message, gender, adConsent);
      return 'pending';
    }
    const now = new Date().toISOString();
    const existingAdminLocation = sheet.getRange(row, 8).getValue() || '';
    const existingAdminGender = sheet.getRange(row, 11).getValue() || '';
    oldShifts = JSON.parse(sheet.getRange(row, 6).getValue() || '[]');
    // 오늘 이전 날짜는 화면에서 수정이 막혀 있지만, 클라이언트를 우회해 saveRecord가 직접 호출될 수도 있으므로
    // 서버에서도 과거 날짜분은 기존 값을 그대로 유지하고 클라이언트가 보낸 값은 무시한다.
    const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const pastOldShifts = oldShifts.filter(s => s.date < todayStr);
    const newShifts = (shifts || []).filter(s => s.date >= todayStr);
    mergedShifts = pastOldShifts.concat(newShifts);
    const rowData = [key, name.trim(), toTextCell_(phone.trim()), toTextCell_(pin.trim()), now, JSON.stringify(mergedShifts), JSON.stringify(locations || []), existingAdminLocation, (message || '').trim(), gender || '', existingAdminGender, adConsent || ''];
    console.log("pin: %s, phone: %s", pin, phone);
    sheet.getRange(row, 1, 1, 12).setValues([rowData]);
  } finally {
    lock.releaseLock();
  }
  // 신청 수정으로 이번에 빠진 (날짜,시프트)만 부분취소로 보고 Assign/History에서 제거한다.
  removeCanceledAssignments_(key, oldShifts, mergedShifts);
  return true;
}

// ---- 신규 근무자 신청(승인 대기) ----
// saveRecord의 잠금 안에서 호출된다. 같은 사람이 승인 전에 다시 저장하면 그 행을 덮어쓴다.
function savePendingRecord_(key, name, pin, phone, shifts, locations, message, gender, adConsent) {
  const sheet = getPendingSheet_();
  const row = findRow_(sheet, 0, key);
  const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const newShifts = (shifts || []).filter(s => s.date >= todayStr);
  const rowData = [key, name.trim(), toTextCell_(phone.trim()), toTextCell_(pin.trim()), new Date().toISOString(), JSON.stringify(newShifts), JSON.stringify(locations || []), '', (message || '').trim(), gender || '', '', adConsent || ''];
  if (row === -1) sheet.appendRow(rowData);
  else sheet.getRange(row, 1, 1, 12).setValues([rowData]);
}

function getPendingRecords(adminPw) {
  requireAdmin_(adminPw);
  const data = getPendingSheet_().getDataRange().getValues();
  const records = [];
  for (let i = 1; i < data.length; i++) {
    records.push({
      key: data[i][0],
      name: data[i][1],
      phone: data[i][2],
      pin: data[i][3] || '',
      // 관리자가 본 신청과 승인하는 신청이 같은 내용인지 approvePending이 대조하는 값(저장 시각)
      version: String(data[i][4] || ''),
      shifts: JSON.parse(data[i][5] || '[]'),
      locations: JSON.parse(data[i][6] || '[]'),
      message: data[i][8] || '',
      gender: data[i][9] || ''
    });
  }
  return records;
}

// 승인: 신규데이터의 신청을 Data로 옮기고 신규데이터에서는 지운다.
// edits({name, pin, phone, gender, locations, shifts})를 넘기면 관리자가 고친 값으로 등록한다(수정 후 승인).
// 그 사이 다른 관리자가 이미 처리해 대기 행이 없으면 false를 돌려준다.
// 관리자 화면은 자동 갱신이 없어, 목록을 불러온 뒤 신청자가 내용을 고쳤을 수 있다. 그대로 승인하면
// 관리자가 보지 못한 내용이 등록되고, 수정 후 승인이면 신청자가 고친 내용이 덮어써지므로
// version(목록을 불러올 때 받은 값)이 달라졌으면 아무것도 쓰지 않고 'changed'를 돌려준다.
function approvePending(key, edits, version, adminPw) {
  requireAdmin_(adminPw);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let newKey = key;
  let oldShifts = [];
  let mergedShifts = [];
  try {
    const pendingSheet = getPendingSheet_();
    const pendingRow = findRow_(pendingSheet, 0, key);
    if (pendingRow === -1) return false;
    const p = pendingSheet.getRange(pendingRow, 1, 1, 12).getValues()[0];
    if (String(p[4] || '') !== version) return 'changed';
    let name = String(p[1]);
    let pin = String(p[3] || '');
    let phone = String(p[2] || '');
    let gender = p[9] || '';
    let locations = JSON.parse(p[6] || '[]');
    let shifts = JSON.parse(p[5] || '[]');
    if (edits) {
      name = String(edits.name || '').trim();
      if (!name) throw new Error('이름을 입력해주세요.');
      pin = String(edits.pin || '').trim();
      phone = String(edits.phone || '').trim();
      gender = edits.gender || '';
      locations = edits.locations || [];
      // 관리자 화면은 날짜별 근무지를 보내지 않으므로 근무자가 고른 값을 되살린다.
      shifts = mergeShiftExtras_(shifts, edits.shifts || []);
    }
    newKey = makeKey_(name, pin);

    const sheet = getDataSheet_();
    const row = findRow_(sheet, 0, newKey);
    let existingAdminLocation = '';
    let existingAdminGender = '';
    mergedShifts = shifts;
    if (row > -1) {
      // 대기 중에 관리자가 같은 사람을 근무자 추가로 이미 등록한 경우다. 행을 새로 만들면 같은 key가
      // 2개가 되므로 그 행에 신청을 반영한다 — 근무자가 직접 저장했을 때(saveRecord)와 같은 규칙이다.
      const existing = sheet.getRange(row, 1, 1, 12).getValues()[0];
      existingAdminLocation = existing[7] || '';
      existingAdminGender = existing[10] || '';
      oldShifts = JSON.parse(existing[5] || '[]');
      const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      mergedShifts = oldShifts.filter(s => s.date < todayStr).concat(shifts.filter(s => s.date >= todayStr));
    }
    const rowData = [newKey, name, toTextCell_(phone), toTextCell_(pin), new Date().toISOString(), JSON.stringify(mergedShifts), JSON.stringify(locations), existingAdminLocation, p[8] || '', gender, existingAdminGender, p[11] || ''];
    if (row === -1) sheet.appendRow(rowData);
    else sheet.getRange(row, 1, 1, 12).setValues([rowData]);
    pendingSheet.deleteRow(pendingRow);
  } finally {
    lock.releaseLock();
  }
  removeCanceledAssignments_(newKey, oldShifts, mergedShifts);
  return true;
}

// 거절: 신규데이터에서 신청을 지운다. Data에는 아무것도 남지 않는다.
function rejectPending(key, adminPw) {
  requireAdmin_(adminPw);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return deletePendingRow_(key);
  } finally {
    lock.releaseLock();
  }
}

// 찾은 행 번호로 지우는 사이 다른 요청(승인·거절)이 앞의 행을 지우면 엉뚱한 신청이 지워지므로,
// 호출하는 쪽에서 잠금을 잡은 채로 불러야 한다.
function deletePendingRow_(key) {
  const sheet = getPendingSheet_();
  const row = findRow_(sheet, 0, key);
  if (row === -1) return false;
  sheet.deleteRow(row);
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
  return true;
}

// 여러 날짜/시간대의 목표 인원을 한 번에 일괄 저장
function batchSaveTargets(list, adminPw) {
  requireAdmin_(adminPw);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
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
  } finally {
    lock.releaseLock();
  }
  return true;
}

// 전체신청자(roster) 화면의 건강증만료일/입사일을 한 번에 일괄 저장
function batchSaveRoster(list, adminPw) {
  requireAdmin_(adminPw);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getRosterSheet_();
    const data = sheet.getDataRange().getValues();
    const keyToRow = {};
    for (let i = 1; i < data.length; i++) keyToRow[data[i][0]] = i + 1;
    list.forEach(item => {
      let row = keyToRow[item.key];
      let existingOrder = 0;
      // 위에서 이미 읽어둔 data 배열에 있는 값이므로 getRange().getValue()로 다시 조회하지 않는다.
      if (row) existingOrder = Number(data[row - 1][3]) || 0;
      const rowData = [item.key, item.healthCertExpiry || '', item.hireDate || '', existingOrder];
      if (!row) {
        sheet.appendRow(rowData);
        keyToRow[item.key] = sheet.getLastRow();
      } else {
        sheet.getRange(row, 1, 1, 4).setValues([rowData]);
      }
    });
  } finally {
    lock.releaseLock();
  }
  return true;
}

// 관리자 화면들은 날짜별 근무지를 다루지 않고, 주방보조가 아닌 날짜는 shifts를 {date, day, night}로만
// 다시 만들어 덮어쓴다. 그대로 저장하면 근무자가 지정해둔 날짜별 location과 주방보조 근무형태·시간
// (workType, timeFrom, timeTo)이 지워지므로, 새 값에 없는 것은 같은 날짜의 기존 값을 되살려준다.
function mergeShiftExtras_(oldShifts, newShifts) {
  const oldByDate = {};
  (oldShifts || []).forEach(function (s) { oldByDate[s.date] = s; });
  return (newShifts || []).map(function (s) {
    const old = oldByDate[s.date];
    if (!old) return s;
    const merged = Object.assign({}, s);
    if (!merged.location && old.location) merged.location = old.location;
    if (!merged.workType && old.workType) {
      merged.workType = old.workType;
      merged.timeFrom = old.timeFrom;
      merged.timeTo = old.timeTo;
    }
    return merged;
  });
}

// 관리자가 실제 배치 장소를 별도로 지정/변경 (신청 장소와 다를 수 있음)
// 관리자가 근로자의 근무 일정(주간/야간)을 직접 수정
function adminUpdateShifts(key, shifts, adminPw) {
  requireAdmin_(adminPw);
  const sheet = getDataSheet_();
  const row = findRow_(sheet, 0, key);
  if (row === -1) return false;
  let oldShifts = [];
  try { oldShifts = JSON.parse(sheet.getRange(row, 6).getValue() || '[]'); } catch (e) { Logger.log('실패 원인: ' + e.message); }
  sheet.getRange(row, 6).setValue(JSON.stringify(mergeShiftExtras_(oldShifts, shifts)));
  return true;
}

// 이름/연락처/생년월일(핀)을 나중에 추가/수정. 이름이나 핀이 바뀌면 key가 바뀌므로 관련 시트를 모두 옮겨준다.
// 각 값은 undefined/null(이름은 빈 문자열 포함)이면 기존 값을 유지하므로, 일부 필드만 넘겨도 나머지가 지워지지 않는다.
function setContactInfo(oldKey, newName, phone, newPin, adminPw) {
  requireAdmin_(adminPw);
  const sheet = getDataSheet_();
  const row = findRow_(sheet, 0, oldKey);
  if (row === -1) return false;

  const currentName = sheet.getRange(row, 2).getValue();
  const finalName = (newName === undefined || newName === null || !String(newName).trim()) ? currentName : String(newName).trim();
  const currentPhone = sheet.getRange(row, 3).getValue() || '';
  const finalPhone = (phone === undefined || phone === null) ? currentPhone : phone;
  const currentPin = sheet.getRange(row, 4).getValue() || '';
  const finalPin = (newPin === undefined || newPin === null) ? currentPin : newPin;
  const newKey = makeKey_(finalName, finalPin || '');
  // 바꾼 뒤의 이름+생년월일이 다른 행에 이미 있으면 key가 같은 행이 2개가 되고, 이후 조회/저장은
  // 첫 행만 찾아 나머지 행이 갱신되지 않으므로 아무것도 쓰지 않고 거부한다.
  if (newKey !== oldKey && findRow_(sheet, 0, newKey) !== -1) {
    throw new Error('같은 이름·생년월일의 근무자가 이미 등록되어 있어 변경할 수 없습니다.');
  }

  sheet.getRange(row, 2).setValue(finalName);
  sheet.getRange(row, 3).setValue(toTextCell_(finalPhone || ''));
  sheet.getRange(row, 4).setValue(toTextCell_(finalPin || ''));

  if (newKey !== oldKey) {
    sheet.getRange(row, 1).setValue(newKey);
    reKeyRelatedSheets_(oldKey, newKey, finalName !== currentName ? finalName : null);
  }
  return true;
}

// newName을 넘기면(이름이 바뀐 경우) Assign 시트에 복제되어 있는 이름 표시값도 함께 갱신한다.
function reKeyRelatedSheets_(oldKey, newKey, newName) {
  const assignSheet = getAssignSheet_();
  const aData = assignSheet.getDataRange().getValues();
  for (let i = 1; i < aData.length; i++) {
    if (aData[i][3] === oldKey) {
      const newAssignKey = makeAssignKey_(aData[i][1], aData[i][2], newKey);
      assignSheet.getRange(i + 1, 1).setValue(newAssignKey);
      assignSheet.getRange(i + 1, 4).setValue(newKey);
      if (newName) assignSheet.getRange(i + 1, 5).setValue(newName);
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
  return true;
}

// 관리자가 배치판 날짜 칸에서 그 날짜만의 근무지를 지정/해제한다.
// 기본 근무지와 같은 값을 고르면 예외를 해제(location 삭제)하는 것으로 본다.
function setShiftLocation(key, date, location, adminPw) {
  requireAdmin_(adminPw);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let effective = '';
  try {
    const sheet = getDataSheet_();
    const row = findRow_(sheet, 0, key);
    if (row === -1) return false;

    let shifts = [];
    try { shifts = JSON.parse(sheet.getRange(row, 6).getValue() || '[]'); } catch (e) { Logger.log('실패 원인: ' + e.message); }
    const target = shifts.filter(function (s) { return s.date === date; })[0];
    // 근무지를 바꾸는 사이 근무자가 그 날짜 신청을 취소했을 수 있다. 없는 날짜는 만들지 않는다.
    if (!target) return false;

    let locations = [];
    try { locations = JSON.parse(sheet.getRange(row, 7).getValue() || '[]'); } catch (e) { Logger.log('실패 원인: ' + e.message); }
    const baseLocation = sheet.getRange(row, 8).getValue() || locations[0] || '';

    if (!location || location === baseLocation) delete target.location;
    else target.location = location;

    sheet.getRange(row, 6).setValue(JSON.stringify(shifts));
    effective = target.location || baseLocation;
  } finally {
    lock.releaseLock();
  }
  updateAssignLocation_(key, date, effective);
  return true;
}

// 이미 배치된 날짜의 근무지를 관리자가 바꿨으면 Assign 시트 K열도 맞춰준다.
// 같은 날 주간/야간이 둘 다 배치돼 있으면 두 행 모두 갱신해야 근무지가 어긋나지 않는다.
function updateAssignLocation_(key, date, location) {
  const sheet = getAssignSheet_();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][3] === key && toDateStr_(data[i][1]) === date) {
      sheet.getRange(i + 1, 11).setValue(location);
    }
  }
}

// 여러 (사람, 날짜)의 근무지를 한 곳으로 한 번에 옮긴다(관리자 화면의 '근무지 수정' 모드).
// list: [{ key, date }]. 날짜마다 적용되는 규칙은 setShiftLocation과 같다.
function batchSetShiftLocations(list, location, adminPw) {
  requireAdmin_(adminPw);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  const moved = {}; // 'key|date' → 옮긴 뒤 실효 근무지
  let skipped = 0;
  try {
    const sheet = getDataSheet_();
    const data = sheet.getDataRange().getValues();
    const keyToIndex = {};
    for (let i = 1; i < data.length; i++) keyToIndex[data[i][0]] = i;
    const datesByKey = {};
    list.forEach(function (item) { (datesByKey[item.key] = datesByKey[item.key] || []).push(item.date); });

    Object.keys(datesByKey).forEach(function (key) {
      const i = keyToIndex[key];
      if (i === undefined) { skipped += datesByKey[key].length; return; }
      let shifts = [];
      let locations = [];
      try { shifts = JSON.parse(data[i][5] || '[]'); } catch (e) { Logger.log('실패 원인: ' + e.message); }
      try { locations = JSON.parse(data[i][6] || '[]'); } catch (e) { Logger.log('실패 원인: ' + e.message); }
      const baseLocation = data[i][7] || locations[0] || '';
      let changed = false;
      datesByKey[key].forEach(function (date) {
        const target = shifts.filter(function (s) { return s.date === date; })[0];
        // 화면을 띄워둔 사이 근무자가 그 날짜 신청을 취소했을 수 있다. 없는 날짜는 만들지 않는다.
        if (!target) { skipped++; return; }
        if (!location || location === baseLocation) delete target.location;
        else target.location = location;
        moved[key + '|' + date] = target.location || baseLocation;
        changed = true;
      });
      if (changed) sheet.getRange(i + 1, 6).setValue(JSON.stringify(shifts));
    });
  } finally {
    lock.releaseLock();
  }

  // 이미 배치된 날짜는 Assign K열도 맞춘다(updateAssignLocation_과 같은 일을 시트 한 번 읽기로).
  const assignSheet = getAssignSheet_();
  const assignData = assignSheet.getDataRange().getValues();
  for (let i = 1; i < assignData.length; i++) {
    const k = assignData[i][3] + '|' + toDateStr_(assignData[i][1]);
    if (Object.prototype.hasOwnProperty.call(moved, k)) assignSheet.getRange(i + 1, 11).setValue(moved[k]);
  }
  return { saved: Object.keys(moved).length, skipped: skipped };
}

function deleteRecord(name, pin) {
  const key = makeKey_(name, pin);
  // 취소 시점에 신청되어 있던 (날짜,시프트)의 배치만 Assign/History에서 제거하되,
  // 이미 지난 날짜(오늘 이전)의 배치/이력은 saveRecord와 동일하게 그대로 보존한다.
  const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  let oldShifts = [];
  let pastOldShifts = [];
  // "Data에 없음"을 확인한 뒤 신규데이터 행을 지우기 전에 관리자의 승인이 끼어들면, 신청이 Data로
  // 옮겨진 채 남아 취소했다고 안내받은 근무자가 그대로 배치 대상이 된다. 찾기~쓰기를 잠가 막는다.
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getDataSheet_();
    const row = findRow_(sheet, 0, key);
    if (row > -1) {
      oldShifts = JSON.parse(sheet.getRange(row, 6).getValue() || '[]');
      pastOldShifts = oldShifts.filter(s => s.date < todayStr);
      // Data 행을 지우면 같은 key의 Roster/PastMonthly/History 행이 전체신청자 목록에 나오지 않는
      // 고아로 남으므로, 사람(행)은 남기고 오늘 이후 신청만 비운다.
      sheet.getRange(row, 5, 1, 2).setValues([[new Date().toISOString(), JSON.stringify(pastOldShifts)]]);
    } else {
      // 승인 전인 신규 신청은 다른 시트에 딸린 행이 없으므로 행째 지운다.
      deletePendingRow_(key);
    }
  } finally {
    lock.releaseLock();
  }
  removeCanceledAssignments_(key, oldShifts, pastOldShifts);
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

// ---- 배치 관련 ----
// 그 날짜에 실제로 적용되는 근무지. shifts에 location이 지정된 날은 그 값이 우선하고,
// 없으면 기본 근무지(관리자 지정 → 근무자가 고른 첫 신청 장소)로 떨어진다.
function effectiveLocationOf_(shifts, adminLocation, locations, dateStr) {
  const found = (shifts || []).filter(function (s) { return s.date === dateStr; })[0];
  return (found && found.location) || adminLocation || (locations && locations[0]) || '';
}

// Data 시트를 한 번만 읽어두고 (key, 날짜) → 실효 근무지를 돌려주는 함수를 만든다.
// 배치 건마다 시트를 다시 읽지 않기 위해 조회 함수 형태로 반환한다.
function makeLocationLookup_() {
  const sheet = getDataSheet_();
  const data = sheet.getDataRange().getValues();
  const byKey = {};
  for (let i = 1; i < data.length; i++) {
    let shifts = [];
    let locations = [];
    try { shifts = JSON.parse(data[i][5] || '[]'); } catch (e) { Logger.log('실패 원인: ' + e.message); }
    try { locations = JSON.parse(data[i][6] || '[]'); } catch (e) { Logger.log('실패 원인: ' + e.message); }
    byKey[data[i][0]] = { shifts: shifts, adminLocation: data[i][7] || '', locations: locations };
  }
  return function (key, dateStr) {
    const rec = byKey[key];
    if (!rec) return '';
    return effectiveLocationOf_(rec.shifts, rec.adminLocation, rec.locations, dateStr);
  };
}

// Data 시트를 한 번만 읽어두고 (key, 날짜, 시프트) → 그 사람이 실제로 그 근무를 신청했는지를
// 돌려주는 함수를 만든다. 배치 저장이 삭제된 배치를 되살리는 것을 막는 데만 쓴다.
function makeAppliedLookup_() {
  const sheet = getDataSheet_();
  const data = sheet.getDataRange().getValues();
  const byKey = {};
  for (let i = 1; i < data.length; i++) {
    let shifts = [];
    try { shifts = JSON.parse(data[i][5] || '[]'); } catch (e) { Logger.log('실패 원인: ' + e.message); }
    const applied = {};
    shifts.forEach(function (s) {
      if (s.day) applied[s.date + '_day'] = true;
      if (s.night) applied[s.date + '_night'] = true;
    });
    byKey[data[i][0]] = applied;
  }
  return function (key, dateStr, shift) {
    return !!(byKey[key] && byKey[key][dateStr + '_' + shift]);
  };
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
      location: data[i][10] || '',
      transport: data[i][11] || ''
    });
  }
  return list;
}

function saveAssignment(date, shift, key, name, gender, floor, isEducation, isNew, isWomenWage, transport, adminPw) {
  requireAdmin_(adminPw);
  // 더블클릭 등으로 요청이 거의 동시에 두 번 들어오면 둘 다 findRow_에서 "없음"으로 보고
  // 각각 appendRow 하여 중복 행이 생길 수 있어(saveRecord와 동일한 문제), 찾기~쓰기 구간을 잠근다.
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getAssignSheet_();
    const assignKey = makeAssignKey_(date, shift, key);
    const row = findRow_(sheet, 0, assignKey);
    // 관리자 화면이 열려 있는 동안 근무자가 그 날짜 신청을 취소하면 배치 행은 이미 지워졌는데
    // 화면에는 그대로 남아 있어, 그 칸을 저장하면 배치가 되살아난다. 새 행을 만드는 경우에만
    // Data의 신청 내역을 확인해 막는다(기존 행 수정은 지난 근무 기록 수정이라 그대로 허용).
    if (row === -1 && !makeAppliedLookup_()(key, date, shift)) return false;
    const location = makeLocationLookup_()(key, date) || '';
    const assignGender = isWomenWage ? '여' : gender;
    const rowData = [assignKey, date, shift, key, name, assignGender, floor, !!isEducation, !!isNew, !!isWomenWage, location, transport || ''];
    if (row === -1) sheet.appendRow(rowData);
    else sheet.getRange(row, 1, 1, 12).setValues([rowData]);
    logHistory_(key, date);
  } finally {
    lock.releaseLock();
  }
  return true;
}

// 여러 명을 한 번에 배치 (서버 왕복을 1번으로 줄여서 빠르게 처리)
function batchSaveAssignments(list, adminPw) {
  requireAdmin_(adminPw);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getAssignSheet_();
    const data = sheet.getDataRange().getValues();
    const keyToRow = {};
    for (let i = 1; i < data.length; i++) keyToRow[data[i][0]] = i + 1;
    const locationAt = makeLocationLookup_();
    const appliedAt = makeAppliedLookup_();
    const savedItems = [];
    let skipped = 0;

    list.forEach(item => {
      const assignKey = makeAssignKey_(item.date, item.shift, item.key);
      const row = keyToRow[assignKey];
      // saveAssignment과 같은 이유로, 신청이 없는 (날짜,시프트)에 배치를 새로 만드는 것만 건너뛴다.
      if (!row && !appliedAt(item.key, item.date, item.shift)) {
        skipped++;
        return;
      }
      const assignGender = item.isWomenWage ? '여' : item.gender;
      const rowData = [assignKey, item.date, item.shift, item.key, item.name, assignGender, item.floor, !!item.isEducation, !!item.isNew, !!item.isWomenWage, locationAt(item.key, item.date) || '', item.transport || ''];
      if (!row) {
        sheet.appendRow(rowData);
        keyToRow[assignKey] = sheet.getLastRow();
      } else {
        sheet.getRange(row, 1, 1, 12).setValues([rowData]);
      }
      savedItems.push(item);
    });

    // logHistory_를 item마다 호출하면 매번 History 시트를 통째로 재조회하므로 배치 버전으로 한 번에 처리
    batchLogHistory_(savedItems.map(item => ({ key: item.key, date: item.date })));
    return { saved: savedItems.length, skipped: skipped };
  } finally {
    lock.releaseLock();
  }
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

  // 같은 날짜에 다른 시프트로 남아있는 배치가 없을 때만 이력에서도 제거.
  // findRow_(=시트 전체 재조회)를 item마다 부르는 대신, 이미 위에서 읽어둔 keyToRow/rowsToDelete로 판단한다.
  const deletedRows = new Set(rowsToDelete);
  const historyRemovals = [];
  list.forEach(item => {
    const otherShift = item.shift === 'day' ? 'night' : 'day';
    const otherAssignKey = makeAssignKey_(item.date, otherShift, item.key);
    const otherRow = keyToRow[otherAssignKey];
    const stillHas = !!otherRow && !deletedRows.has(otherRow);
    if (!stillHas) historyRemovals.push({ key: item.key, date: item.date });
  });
  batchRemoveHistory_(historyRemovals);
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
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getTargetSheet_();
    const targetKey = makeTargetKey_(date, shift);
    const row = findRow_(sheet, 0, targetKey);
    const rowData = [targetKey, date, shift, Number(maleTarget) || 0, Number(femaleTarget) || 0];
    if (row === -1) sheet.appendRow(rowData);
    else sheet.getRange(row, 1, 1, 5).setValues([rowData]);
  } finally {
    lock.releaseLock();
  }
  return true;
}
