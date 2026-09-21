/**
 * SPAM group-meeting cookie reminder.
 *
 * Friday job: look up next Tuesday's 🎂 cell, match that first name to a Slack
 * user, and ping them in #group-meeting. If the cell is empty, ping Daniel.
 *
 * This is a cleaned rewrite of a colleague's Google Apps Script. The original
 * posted "No group meeting this week" when it saw that phrase in the sheet;
 * our roster does not use that text, so that path is gone. Cookie people are
 * matched by first name only (unique in this workspace), so the map does not
 * need a full-name update every time someone joins or leaves.
 *
 * Setup
 * 1. In the organisation spreadsheet: Extensions > Apps Script, replace the
 *    stub with this file (or import scripts/google_script.json).
 * 2. Project Settings > Script properties:
 *      SLACK_BOT_TOKEN = xoxb-...   (chat:write and users:read; bot in #group-meeting)
 * 3. Triggers > Add trigger:
 *      Function: sendCookieReminder
 *      Event: Time-driven, Week timer, Friday, 8am-9am
 *      Timezone: Europe/Brussels
 * 4. Use the spreadsheet menu Cookie reminder > Preview next ping to dry-run.
 */

var COOKIE_HEADER = '🎂';
var DATE_HEADER = 'Date';
var CHANNEL_ID = 'C01AMNHQ8EL';
var SHEET_ID = '1FOjEjX98ChrvnJA_f4oI8cce1NjN0sk_yNIQqwY74eo';
var DANIEL_SLACK_ID = 'U07PZ8YUCA3';
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
  var people = resolveCookiePeople_(cookieRaw, context.humans);
  var assigned = people.length > 0;
  var reason = meeting ? 'empty_cookie_cell' : 'no_meeting_row';
  var message = assigned
    ? cookieDutyMessage_(people, meetingDate)
    : danielFallbackMessage_(meetingDate, cookieRaw, reason);

  return {
    runDate: formatIsoDate_(runDate),
    sheetName: sheetName,
    meetingDate: formatIsoDate_(meetingDate),
    cookieRaw: cookieRaw,
    status: assigned ? 'assigned' : reason,
    people: people,
    channel: CHANNEL_ID,
    text: message
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
      names.push(match[0].toLowerCase());
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

function mentionFor_(person) {
  return person.slackId ? '<@' + person.slackId + '>' : person.fullName;
}

function cookieDutyMessage_(people, meetingDate) {
  var mentions = people.map(mentionFor_).join(' and ');
  return 'Hi ' + mentions + ", this is a reminder that you are on cookie duty for next week's group meeting on " +
    formatMeetingDay_(meetingDate) + '. Thank you!';
}

function danielFallbackMessage_(meetingDate, cookieRaw, reason) {
  var mention = '<@' + DANIEL_SLACK_ID + '>';
  if (reason === 'no_meeting_row') {
    return 'Hi ' + mention + ', there is no group-meeting row for ' + formatMeetingDay_(meetingDate) +
      ' in the 🎂 column. Could you add a date or find someone to bring cookies?';
  }
  if (looksLikePerson_(cookieRaw)) {
    return 'Hi ' + mention + ", next week's group meeting on " + formatMeetingDay_(meetingDate) +
      ' lists "' + cookieRaw + '" for cookies, but that first name is not a unique Slack user. Could you assign someone?';
  }
  return 'Hi ' + mention + ", next week's group meeting on " + formatMeetingDay_(meetingDate) +
    ' does not have anyone in the cookie column yet. Could you find someone to bring cookies?';
}

function previewText_(plan) {
  return plan.status + ' for ' + plan.meetingDate + ' (' + (plan.cookieRaw || 'empty') + ')\n\n' + plan.text;
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
    throw new Error('Set script property SLACK_BOT_TOKEN to a Slack bot token with chat:write and users:read.');
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

function listSlackHumans_() {
  var members = [];
  var cursor = '';
  do {
    var url = 'https://slack.com/api/users.list?limit=200';
    if (cursor) {
      url += '&cursor=' + encodeURIComponent(cursor);
    }
    var options = {
      method: 'get',
      headers: { Authorization: 'Bearer ' + slackToken_() },
      muteHttpExceptions: true
    };
    var response = UrlFetchApp.fetch(url, options);
    var data = JSON.parse(response.getContentText());
    if (!data.ok) {
      throw new Error('Slack users.list failed: ' + (data.error || response.getContentText()));
    }
    members = members.concat(data.members || []);
    cursor = data.response_metadata && data.response_metadata.next_cursor;
  } while (cursor);
  var humans = [];
  for (var i = 0; i < members.length; i++) {
    var member = members[i];
    if (!member || member.deleted || member.is_bot || member.id === 'USLACKBOT') {
      continue;
    }
    humans.push({
      id: member.id,
      fullName: (member.profile && (member.profile.real_name || member.profile.display_name)) || member.name || member.id,
      firstNames: slackFirstNames_(member)
    });
  }
  return humans;
}

function slackFirstNames_(member) {
  var profile = member.profile || {};
  var fields = [profile.display_name, profile.real_name, profile.first_name, member.real_name, member.name];
  var names = {};
  for (var i = 0; i < fields.length; i++) {
    var extracted = extractFirstNames_(fields[i] || '');
    for (var j = 0; j < extracted.length; j++) {
      names[extracted[j]] = true;
    }
  }
  return Object.keys(names);
}

function matchFirstName_(first, humans) {
  var matches = [];
  for (var i = 0; i < humans.length; i++) {
    if (humans[i].firstNames.indexOf(first) !== -1) {
      matches.push(humans[i]);
    }
  }
  if (matches.length === 1) {
    return {
      first: first,
      fullName: matches[0].fullName,
      slackId: matches[0].id
    };
  }
  return null;
}

function resolveCookiePeople_(raw, optHumans) {
  if (!looksLikePerson_(raw)) {
    return [];
  }
  var firsts = extractFirstNames_(raw);
  if (!firsts.length) {
    return [];
  }
  var humans = optHumans || listSlackHumans_();
  var people = [];
  for (var i = 0; i < firsts.length; i++) {
    var match = matchFirstName_(firsts[i], humans);
    if (!match) {
      return [];
    }
    people.push(match);
  }
  return people;
}

function postCookiePlan_(plan, dryRun) {
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
    DANIEL_SLACK_ID: DANIEL_SLACK_ID,
    academicYearSheetName_: academicYearSheetName_,
    nextTuesday_: nextTuesday_,
    parseSheetDate_: parseSheetDate_,
    looksLikePerson_: looksLikePerson_,
    extractFirstNames_: extractFirstNames_,
    findHeader_: findHeader_,
    findMeetingRow_: findMeetingRow_,
    matchFirstName_: matchFirstName_,
    cookieDutyMessage_: cookieDutyMessage_,
    danielFallbackMessage_: danielFallbackMessage_,
    formatMeetingDay_: formatMeetingDay_,
    buildCookiePlan_: buildCookiePlan_,
    resolveCookiePeople_: resolveCookiePeople_
  };
}
