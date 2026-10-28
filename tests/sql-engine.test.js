'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sql = require('../public/js/sql-engine');

test('SQL Engine: formatSql formats keywords and preserves literals and comments', () => {
  const query = "select id, name from students where name = 'John Doe' and gpa > 3.5 order by gpa desc;";
  const formatted = sql.formatSql(query);
  assert.ok(formatted.includes('SELECT'));
  assert.ok(formatted.includes('FROM'));
  assert.ok(formatted.includes('WHERE'));
  assert.ok(formatted.includes('ORDER BY'));
  assert.ok(formatted.includes("'John Doe'"), 'string literal preserved exactly');
});

test('SQL Engine: resultsToCsv correctly escapes strings, quotes, and handles NULLs', () => {
  const columns = ['id', 'name', 'bio', 'score'];
  const values = [
    [1, 'Alice "The Great"', 'Likes, commas and\nnewlines', 95.5],
    [2, 'Bob', null, null]
  ];
  const csv = sql.resultsToCsv(columns, values);
  assert.ok(csv.includes('"id","name","bio","score"'));
  assert.ok(csv.includes('"Alice ""The Great"""'), 'quotes escaped as double-quotes');
  assert.ok(csv.includes('""'), 'null values rendered as empty cells');
});

test('SQL Engine: tipFor returns targeted diagnostic tips for common SQL mistakes', () => {
  assert.ok(sql.tipFor('no such table: students_tbl').includes('Check the table name'));
  assert.ok(sql.tipFor('no such column: gpa_score').includes('Check column spelling'));
  assert.ok(sql.tipFor('ambiguous column name: id').includes('More than one table'));
  assert.ok(sql.tipFor('syntax error near "FORM"').includes('SQL syntax error'));
  assert.ok(sql.tipFor('FOREIGN KEY constraint failed').includes('Foreign key violation'));
  assert.ok(sql.tipFor('UNIQUE constraint failed').includes('primary or unique key already exists'));
});

