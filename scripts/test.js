/**
 * SPAM group-meeting cookie reminder.
 *
 * Friday job: look up next Tuesday's 🎂 cell and report the first name(s)
 * from that cell in #group-meeting. Slack should resolve those names to
 * users. This script does not call users.list or mention Slack user ids.
 *
 * If the cell is empty, it reports no first name (no Daniel fallback here).
 *
 * Setup
 * 1. In the organisation spreadsheet: Extensions > Apps Script, replace the
 *    stub with this file.
 * 2. Project Settings > Script properties:
 *      SLACK_BOT_TOKEN = xoxb-...   (chat:write; bot must be in #group-meeting)
 * 3. In #group-meeting, run /invite @YourBot  (not_in_channel means this is missing)
 * 4. Triggers > Add trigger:
 *      Function: sendCookieReminder
 *      Event: Time-driven, Week timer, Friday, 8am-9am
 *      Timezone: Europe/Brussels
 * 5. Use Cookie reminder > Preview next ping to see the first name without posting.
 */

var COOKIE_HEADER = '🎂';
var DATE_HEADER = 'Date';
var CHANNEL_ID = 'C01AMNHQ8EL';
var SHEET_ID = '1FOjEjX98ChrvnJA_f4oI8cce1NjN0sk_yNIQqwY74eo';
var DATE_RE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/;
var NAME_RE = /[A-Za-zÀ-ž]+/;
var SKIP_TOKENS = {
  '': true,
  '/': true,
  '-': true,
  no: true,
  none: true,
  n: true,
  na: true,
  tbd: true,
  cancelled: true,
  canceled: true,
  holiday: true
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Cookie reminder')
    .addItem('Preview next ping', 'previewCookieReminder')
    .addItem('Send next ping now', 'sendCookieReminder')
    .addToUi();
}

function sendCookieReminder() {
  postCookiePlan_(buildCookiePlan_(new Date()), false);
}

function previewCookieReminder() {
  var plan = buildCookiePlan_(new Date());
  log_(JSON.stringify(plan, null, 2));
  if (typeof SpreadsheetApp !== 'undefined') {
    SpreadsheetApp.getUi().alert(previewText_(plan));
  }
  return plan;
}

function buildCookiePlan_(runDate, optContext) {
  var context = optContext || {};
  var sheetName = academicYearSheetName_(runDate);
  var meetingDate = nextTuesday_(runDate);
  var rows = context.rows || loadSheetRows_(sheetName);
  var meeting = findMeetingRow_(rows, meetingDate);
  var cookieRaw = meeting ? String(meeting.cookie || '').trim() : '';
  var firstNames = looksLikePerson_(cookieRaw) ? extractFirstNames_(cookieRaw) : [];
  var status = !meeting ? 'no_meeting_row' : (firstNames.length ? 'assigned' : 'empty_cookie_cell');

  return {
    runDate: formatIsoDate_(runDate),
    sheetName: sheetName,
    meetingDate: formatIsoDate_(meetingDate),
    cookieRaw: cookieRaw,
    firstNames: firstNames,
    status: status,
    channel: CHANNEL_ID,
    text: cookieDutyMessage_(firstNames, meetingDate, status)
  };
}

function academicYearSheetName_(day) {
  var year = day.getFullYear();
  var startYear = day.getMonth() >= 7 ? year : year - 1;
  return 'Academic year ' + startYear + '-' + (startYear + 1);
}

function nextTuesday_(runDate) {
  var date = startOfDay_(runDate);
  var daysSinceMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - daysSinceMonday + 8);
  return date;
}

function startOfDay_(value) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function formatIsoDate_(value) {
  var month = String(value.getMonth() + 1).padStart(2, '0');
  var day = String(value.getDate()).padStart(2, '0');
  return value.getFullYear() + '-' + month + '-' + day;
}

function formatMeetingDay_(value) {
  var months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  var weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return weekdays[value.getDay()] + ' ' + value.getDate() + ' ' + months[value.getMonth()] + ' ' + value.getFullYear();
}

function parseSheetDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return startOfDay_(value);
  }
  if (typeof value === 'number' && isFinite(value)) {
    var serial = new Date(Math.round((value - 25569) * 86400 * 1000));
    return startOfDay_(serial);
  }
  var text = String(value || '').trim();
  var match = DATE_RE.exec(text);
  if (!match) {
    return null;
  }
  var day = parseInt(match[1], 10);
  var month = parseInt(match[2], 10);
  var year = parseInt(match[3], 10);
  var parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    return null;
  }
  return parsed;
}

function looksLikePerson_(raw) {
  var token = String(raw || '').trim();
  var lowered = token.toLowerCase();
  if (!token || SKIP_TOKENS[lowered] || lowered.indexOf('no group meeting') !== -1) {
    return false;
  }
  if (/^[\u{1F300}-\u{1FAFF}]/u.test(token)) {
    return false;
  }
  return NAME_RE.test(token);
}

function extractFirstNames_(raw) {
  var cleaned = String(raw || '').split(/[(\[]/, 2)[0];
  var parts = cleaned.split(/\s*(?:,|&|\+|and)\s*/i);
  var names = [];
  for (var i = 0; i < parts.length; i++) {
    var match = parts[i].match(NAME_RE);
    if (match) {
      names.push(match[0]);
    }
  }
  return names;
}

function sameCalendarDay_(left, right) {
  return left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
}

function findHeader_(values) {
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var dateCol = indexOfHeader_(row, DATE_HEADER);
    var cookieCol = indexOfHeader_(row, COOKIE_HEADER);
    if (dateCol !== -1 && cookieCol !== -1) {
      return { row: r, dateCol: dateCol, cookieCol: cookieCol };
    }
  }
  throw new Error('Could not find the Date / 🎂 header row.');
}

function indexOfHeader_(row, label) {
  for (var i = 0; i < row.length; i++) {
    if (String(row[i] || '').trim() === label) {
      return i;
    }
  }
  return -1;
}

function findMeetingRow_(rows, meetingDate) {
  var matches = [];
  for (var i = 0; i < rows.length; i++) {
    if (sameCalendarDay_(rows[i].date, meetingDate)) {
      matches.push(rows[i]);
    }
  }
  return matches.length ? matches[0] : null;
}

function cookieDutyMessage_(firstNames, meetingDate, status) {
  var when = formatMeetingDay_(meetingDate);
  if (status === 'no_meeting_row') {
    return 'Cookie duty first name: (none)\nMeeting: ' + when + '\nNo group-meeting row for that date.';
  }
  if (!firstNames.length) {
    return 'Cookie duty first name: (none)\nMeeting: ' + when + '\nThe 🎂 cell is empty.';
  }
  return 'Cookie duty first name: ' + firstNames.join(', ') + '\nMeeting: ' + when;
}

function previewText_(plan) {
  var names = plan.firstNames && plan.firstNames.length ? plan.firstNames.join(', ') : '(none)';
  return 'First name from 🎂: ' + names + '\n' +
    'Meeting: ' + plan.meetingDate + '\n' +
    'Status: ' + plan.status + '\n' +
    'Sheet cell: ' + (plan.cookieRaw || 'empty') + '\n\n' +
    plan.text;
}

function loadSheetRows_(sheetName) {
  if (typeof SpreadsheetApp === 'undefined') {
    throw new Error('SpreadsheetApp is not available.');
  }
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    spreadsheet = SpreadsheetApp.openById(SHEET_ID);
  }
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('Missing tab "' + sheetName + '".');
  }
  var values = sheet.getDataRange().getValues();
  var header = findHeader_(values);
  var rows = [];
  for (var r = header.row + 1; r < values.length; r++) {
    var parsed = parseSheetDate_(values[r][header.dateCol]);
    if (!parsed) {
      continue;
    }
    rows.push({
      date: parsed,
      cookie: values[r][header.cookieCol]
    });
  }
  return rows;
}

function slackToken_() {
  var token = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  if (!token) {
    throw new Error('Set script property SLACK_BOT_TOKEN to a Slack bot token with chat:write.');
  }
  return token;
}

function slackFetch_(method, payload) {
  var url = 'https://slack.com/api/' + method;
  var options = {
    method: payload ? 'post' : 'get',
    headers: { Authorization: 'Bearer ' + slackToken_() },
    muteHttpExceptions: true
  };
  if (payload) {
    options.contentType = 'application/json; charset=utf-8';
    options.payload = JSON.stringify(payload);
  }
  var response = UrlFetchApp.fetch(url, options);
  var data = JSON.parse(response.getContentText());
  if (!data.ok) {
    throw new Error('Slack ' + method + ' failed: ' + (data.error || response.getContentText()));
  }
  return data;
}

function postCookiePlan_(plan, dryRun) {
  log_('First name from 🎂: ' + (plan.firstNames.length ? plan.firstNames.join(', ') : '(none)'));
  log_(plan.text);
  if (dryRun) {
    return plan;
  }
  slackFetch_('chat.postMessage', {
    channel: plan.channel,
    text: plan.text,
    unfurl_links: false,
    unfurl_media: false
  });
  return plan;
}

function log_(message) {
  if (typeof Logger !== 'undefined') {
    Logger.log(message);
  } else if (typeof console !== 'undefined') {
    console.log(message);
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    COOKIE_HEADER: COOKIE_HEADER,
    CHANNEL_ID: CHANNEL_ID,
    academicYearSheetName_: academicYearSheetName_,
    nextTuesday_: nextTuesday_,
    parseSheetDate_: parseSheetDate_,
    looksLikePerson_: looksLikePerson_,
    extractFirstNames_: extractFirstNames_,
    findHeader_: findHeader_,
    findMeetingRow_: findMeetingRow_,
    cookieDutyMessage_: cookieDutyMessage_,
    formatMeetingDay_: formatMeetingDay_,
    buildCookiePlan_: buildCookiePlan_
  };
}
