// viva.js - Lab viva questions (the only part of the old "Cheat Sheet & Viva" page that stays)
// Answers are static, trusted HTML written by the maintainers.
window.GAP = window.GAP || {};
GAP.vivaQuestions = [
  {
    q: 'What is the difference between WHERE and HAVING?',
    a: '<strong>WHERE</strong> filters rows <em>before</em> grouping and cannot contain aggregate functions such as SUM() or AVG().<br><strong>HAVING</strong> filters groups <em>after</em> GROUP BY and can use aggregates, for example <code>HAVING COUNT(*) &gt; 5</code>.'
  },
  {
    q: 'What is the difference between PRIMARY KEY and UNIQUE?',
    a: 'A <strong>PRIMARY KEY</strong> identifies each row, cannot be NULL, and a table has only one.<br>A <strong>UNIQUE</strong> constraint also prevents duplicates, but allows NULL values (how many depends on the database), and a table can have several.'
  },
  {
    q: 'What is the difference between DELETE, TRUNCATE and DROP?',
    a: '<strong>DELETE</strong> is DML: it removes the rows you choose with WHERE, fires triggers and can be rolled back.<br><strong>TRUNCATE</strong> is DDL: it removes all rows quickly, resets identity counters and takes no WHERE clause.<br><strong>DROP</strong> removes the whole table: its rows, structure and constraints. (SQLite has no TRUNCATE; use <code>DELETE FROM table</code>.)'
  },
  {
    q: 'What is a foreign key, and what is referential integrity?',
    a: 'A <strong>foreign key</strong> is a column that references the primary key of another table. <strong>Referential integrity</strong> keeps those links valid so no row points at a missing parent. Options such as <code>ON DELETE CASCADE</code> and <code>ON DELETE RESTRICT</code> decide what happens when a parent row is deleted.'
  },
  {
    q: 'What are window functions?',
    a: 'Window functions calculate across rows related to the current row <em>without</em> collapsing them the way GROUP BY does.<br>Examples: <code>ROW_NUMBER()</code>, <code>RANK()</code>, <code>DENSE_RANK()</code>, <code>LEAD()</code>, <code>LAG()</code>, used with <code>OVER (PARTITION BY dept_id ORDER BY salary DESC)</code>.'
  },
  {
    q: 'What are the normal forms (1NF, 2NF, 3NF, BCNF)?',
    a: '<strong>1NF</strong>: every column holds atomic values; no repeating groups.<br><strong>2NF</strong>: in 1NF, and every non-key column depends on the whole primary key (no partial dependency).<br><strong>3NF</strong>: in 2NF, and no non-key column depends on another non-key column (no transitive dependency).<br><strong>BCNF</strong>: for every functional dependency X &rarr; Y, X is a superkey.'
  },
  {
    q: 'What are the ACID properties?',
    a: '<strong>Atomicity</strong>: a transaction happens completely or not at all.<br><strong>Consistency</strong>: a transaction moves the database from one valid state to another.<br><strong>Isolation</strong>: concurrent transactions do not interfere with each other.<br><strong>Durability</strong>: once committed, changes survive crashes.'
  },
  {
    q: 'How does NULL behave in comparisons?',
    a: 'NULL means unknown or missing. It is not equal to 0, to an empty string, or even to another NULL, so <code>col = NULL</code> is never true. Use <code>IS NULL</code> or <code>IS NOT NULL</code>.'
  },
  {
    q: 'What is the difference between UNION and UNION ALL?',
    a: '<strong>UNION</strong> combines two result sets and removes duplicate rows, which costs extra work.<br><strong>UNION ALL</strong> keeps every row including duplicates, so it is faster when duplicates are fine.'
  },
  {
    q: 'What is an index, and when should you avoid one?',
    a: 'An <strong>index</strong> (usually a B-tree) speeds up lookups and sorting. It slows INSERT, UPDATE and DELETE because the index must be updated too, and it uses extra storage, so avoid indexing columns that are rarely searched or that change constantly.'
  }
];
