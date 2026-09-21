#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');
const wrapped = new Function('module', 'exports', code + '\nreturn module.exports;');
const lib = wrapped({ exports: {} }, {});

const HUMANS = [
  { id: 'U07PZ8YUCA3', fullName: 'Daniel Pauli', firstNames: ['daniel'] },
  { id: 'U05PQC0QWL9', fullName: 'Kunal Deshmukh', firstNames: ['kunal'] },
  { id: 'U07H72Y5TR9', fullName: 'Jasmine Vrancken', firstNames: ['jasmine'] },
  { id: 'U09J3E53BHN', fullName: 'Ema Šipková', firstNames: ['ema'] },
  { id: 'U05Q1ED5NAU', fullName: 'Reinhold Willcox', firstNames: ['reinhold'] },
  { id: 'U0896RW0J1L', fullName: 'Bethany Ludwig', firstNames: ['bethany'] },
  { id: 'UV7D9218B', fullName: 'Hugues Sana', firstNames: ['hugues'] },
  { id: 'UEMA2', fullName: 'Emma Example', firstNames: ['emma'] }
];

const ROWS = [
  { date: new Date(2026, 7, 25), cookie: 'Daniel' },
  { date: new Date(2026, 8, 1), cookie: 'Kunal' },
  { date: new Date(2026, 8, 3), cookie: '' },
  { date: new Date(2026, 8, 8), cookie: 'Jasmine' },
  { date: new Date(2026, 8, 15), cookie: 'Ema' },
  { date: new Date(2026, 8, 22), cookie: 'Reinhold' },
  { date: new Date(2026, 8, 29), cookie: 'Bethany' },
  { date: new Date(2026, 9, 6), cookie: '' },
  { date: new Date(2026, 9, 13), cookie: '' },
  { date: new Date(2026, 9, 20), cookie: 'Hugues' },
  { date: new Date(2026, 10, 3), cookie: 'Kunal + Jasmine' }
];

function planOn(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return lib.buildCookiePlan_(new Date(year, month - 1, day), { rows: ROWS, humans: HUMANS });
}

assert.strictEqual(lib.academicYearSheetName_(new Date(2026, 8, 18)), 'Academic year 2026-2027');
assert.strictEqual(lib.academicYearSheetName_(new Date(2027, 0, 8)), 'Academic year 2026-2027');
assert.deepStrictEqual(lib.nextTuesday_(new Date(2026, 8, 18)), new Date(2026, 8, 22));
assert.deepStrictEqual(lib.extractFirstNames_('Kunal + Jasmine'), ['kunal', 'jasmine']);
assert.deepStrictEqual(lib.extractFirstNames_('Tinne (Annachiara forgot :( )'), ['tinne']);
assert.deepStrictEqual(lib.extractFirstNames_('Gabriele & Emma'), ['gabriele', 'emma']);
assert.ok(!lib.looksLikePerson_(''));
assert.ok(!lib.looksLikePerson_('none'));
assert.ok(!lib.looksLikePerson_('No group meeting this week'));

const header = lib.findHeader_([
  ['', 'Date', 'Time', 'Place', 'Topic', '🎂', 'Speaker'],
  ['', '22.09.2026', '15:00', '05.32', 'Plots?', 'Reinhold', '']
]);
assert.strictEqual(header.dateCol, 1);
assert.strictEqual(header.cookieCol, 5);

const parsed = lib.parseSheetDate_('22.09.2026');
assert.strictEqual(parsed.getFullYear(), 2026);
assert.strictEqual(parsed.getMonth(), 8);
assert.strictEqual(parsed.getDate(), 22);

const reinhold = planOn('2026-09-18');
assert.strictEqual(reinhold.status, 'assigned');
assert.strictEqual(reinhold.cookieRaw, 'Reinhold');
assert.strictEqual(reinhold.meetingDate, '2026-09-22');
assert.strictEqual(reinhold.people[0].slackId, 'U05Q1ED5NAU');
assert.ok(reinhold.text.indexOf('<@U05Q1ED5NAU>') !== -1);
assert.ok(reinhold.text.toLowerCase().indexOf('no group meeting this week') === -1);

const ema = planOn('2026-09-11');
assert.strictEqual(ema.cookieRaw, 'Ema');
assert.strictEqual(ema.people[0].slackId, 'U09J3E53BHN');
assert.ok(ema.text.indexOf('<@UEMA2>') === -1);

const empty = planOn('2026-10-02');
assert.strictEqual(empty.status, 'empty_cookie_cell');
assert.strictEqual(empty.meetingDate, '2026-10-06');
assert.ok(empty.text.indexOf('<@U07PZ8YUCA3>') !== -1);
assert.ok(empty.text.toLowerCase().indexOf('no group meeting this week') === -1);

const cancelledPhrase = lib.buildCookiePlan_(new Date(2026, 8, 18), {
  rows: [{ date: new Date(2026, 8, 22), cookie: 'No group meeting this week' }],
  humans: HUMANS
});
assert.strictEqual(cancelledPhrase.status, 'empty_cookie_cell');
assert.ok(cancelledPhrase.text.indexOf('<@U07PZ8YUCA3>') !== -1);
assert.ok(cancelledPhrase.text.indexOf('No group meeting this week') === -1);

const both = lib.buildCookiePlan_(new Date(2026, 9, 30), { rows: ROWS, humans: HUMANS });
assert.strictEqual(both.status, 'assigned');
assert.ok(both.text.indexOf('<@U05PQC0QWL9>') !== -1);
assert.ok(both.text.indexOf('<@U07H72Y5TR9>') !== -1);

const duplicate = lib.matchFirstName_('dan', [
  { id: 'U1', fullName: 'Dan A', firstNames: ['dan'] },
  { id: 'U2', fullName: 'Dan B', firstNames: ['dan'] }
]);
assert.strictEqual(duplicate, null);

const missingRow = lib.buildCookiePlan_(new Date(2027, 6, 2), { rows: ROWS, humans: HUMANS });
assert.strictEqual(missingRow.status, 'no_meeting_row');
assert.ok(missingRow.text.indexOf('<@U07PZ8YUCA3>') !== -1);
assert.ok(missingRow.text.toLowerCase().indexOf('no group meeting this week') === -1);

const project = JSON.parse(fs.readFileSync(path.join(__dirname, 'google_script.json'), 'utf8'));
const codeFile = project.files.find((file) => file.name === 'Code');
assert.ok(codeFile, 'google_script.json should include Code');
assert.strictEqual(codeFile.source, fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8'));

console.log('ok');
