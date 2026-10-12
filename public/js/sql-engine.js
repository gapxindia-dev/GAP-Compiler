// sql-engine.js - SQLite (sql.js, WebAssembly) running entirely in the browser.
// Nothing typed in the playground is sent to the server.

window.GAP = window.GAP || {};

GAP.sql = (() => {
  const MAX_SQL_LENGTH = 50000;
  let SQL = null;
  let activeDb = null;
  let activeDbKey = 'university';

  // Sample databases. Each is rebuilt from this seed whenever it is loaded or reset.
  const datasets = {
    university: `
      CREATE TABLE departments (
        dept_id INTEGER PRIMARY KEY,
        dept_name TEXT NOT NULL,
        building TEXT,
        budget REAL
      );

      INSERT INTO departments VALUES 
      (1, 'Computer Science', 'Turing Hall', 1200000),
      (2, 'Information Tech', 'Babbage Wing', 950000),
      (3, 'Data Science', 'Lovelace Center', 850000),
      (4, 'Electrical Engg', 'Tesla Lab', 1100000);

      CREATE TABLE instructors (
        instructor_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        dept_id INTEGER REFERENCES departments(dept_id),
        salary REAL
      );

      INSERT INTO instructors VALUES
      (10, 'Dr. Alan Turing', 1, 95000),
      (11, 'Dr. Grace Hopper', 1, 98000),
      (12, 'Prof. Claude Shannon', 2, 92000),
      (13, 'Dr. Ada Lovelace', 3, 99000);

      CREATE TABLE courses (
        course_id TEXT PRIMARY KEY,
        course_name TEXT NOT NULL,
        credits INTEGER DEFAULT 3,
        dept_id INTEGER REFERENCES departments(dept_id)
      );

      INSERT INTO courses VALUES
      ('CS101', 'Intro to Programming', 4, 1),
      ('CS204', 'Database Management Systems', 4, 1),
      ('CS305', 'Data Structures & Algorithms', 4, 1),
      ('IT201', 'Web & Cloud Systems', 3, 2),
      ('DS302', 'Machine Learning Foundations', 3, 3);

      CREATE TABLE students (
        student_id INTEGER PRIMARY KEY,
        student_name TEXT NOT NULL,
        dept_id INTEGER REFERENCES departments(dept_id),
        email TEXT UNIQUE,
        gpa REAL,
        year INTEGER
      );

      INSERT INTO students VALUES
      (1001, 'Aarav Sharma', 1, 'aarav@univ.edu', 3.85, 3),
      (1002, 'Priya Patel', 1, 'priya@univ.edu', 3.92, 4),
      (1003, 'Rohan Verma', 2, 'rohan@univ.edu', 3.45, 2),
      (1004, 'Ananya Das', 3, 'ananya@univ.edu', 3.78, 3),
      (1005, 'Kunal Mehta', 1, 'kunal@univ.edu', 3.65, 3),
      (1006, 'Sneha Roy', 2, 'sneha@univ.edu', 2.95, 1),
      (1007, 'Vikram Singh', 4, 'vikram@univ.edu', 3.50, 4);

      CREATE TABLE enrollments (
        enroll_id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER REFERENCES students(student_id),
        course_id TEXT REFERENCES courses(course_id),
        semester TEXT,
        grade TEXT
      );

      INSERT INTO enrollments (student_id, course_id, semester, grade) VALUES
      (1001, 'CS204', 'Fall 2026', 'A'),
      (1001, 'CS305', 'Fall 2026', 'A'),
      (1002, 'CS204', 'Fall 2026', 'A'),
      (1002, 'DS302', 'Fall 2026', 'A'),
      (1003, 'IT201', 'Fall 2026', 'B'),
      (1004, 'DS302', 'Fall 2026', 'A'),
      (1005, 'CS204', 'Fall 2026', 'B'),
      (1005, 'CS305', 'Fall 2026', 'A'),
      (1006, 'CS101', 'Fall 2026', 'C'),
      (1007, 'CS101', 'Fall 2026', 'B');
    `,

    company: `
      CREATE TABLE departments (
        dept_id INTEGER PRIMARY KEY,
        dept_name TEXT NOT NULL,
        location TEXT
      );

      INSERT INTO departments VALUES
      (101, 'Engineering', 'San Francisco'),
      (102, 'Product & Design', 'New York'),
      (103, 'Data Analytics', 'Seattle'),
      (104, 'Marketing & Sales', 'Austin');

      CREATE TABLE employees (
        emp_id INTEGER PRIMARY KEY,
        emp_name TEXT NOT NULL,
        dept_id INTEGER REFERENCES departments(dept_id),
        manager_id INTEGER,
        salary REAL,
        hire_date TEXT
      );

      INSERT INTO employees VALUES
      (1, 'Satya Nadella', 101, NULL, 280000, '2014-02-04'),
      (2, 'Sarah Jenkins', 101, 1, 150000, '2019-06-15'),
      (3, 'Michael Chang', 101, 2, 115000, '2021-03-01'),
      (4, 'Anita Desai', 102, 1, 140000, '2020-01-10'),
      (5, 'David Kim', 103, 1, 135000, '2020-08-20'),
      (6, 'Elena Rostova', 103, 5, 98000, '2022-04-12'),
      (7, 'Lucas Silva', 104, 1, 90000, '2023-01-15');

      CREATE TABLE projects (
        project_id TEXT PRIMARY KEY,
        project_name TEXT NOT NULL,
        dept_id INTEGER REFERENCES departments(dept_id),
        budget REAL
      );

      INSERT INTO projects VALUES
      ('PRJ-A', 'Cloud Data Lake Migration', 101, 500000),
      ('PRJ-B', 'Mobile App Redesign', 102, 250000),
      ('PRJ-C', 'AI Recommendation Engine', 103, 400000);

      CREATE TABLE project_assignments (
        emp_id INTEGER REFERENCES employees(emp_id),
        project_id TEXT REFERENCES projects(project_id),
        role TEXT,
        hours_per_week INTEGER,
        PRIMARY KEY (emp_id, project_id)
      );

      INSERT INTO project_assignments VALUES
      (2, 'PRJ-A', 'Lead Architect', 30),
      (3, 'PRJ-A', 'Backend Engineer', 40),
      (4, 'PRJ-B', 'UI/UX Lead', 35),
      (5, 'PRJ-C', 'ML Scientist', 40),
      (6, 'PRJ-C', 'Data Engineer', 35);
    `,

    library: `
      CREATE TABLE authors (
        author_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        country TEXT
      );

      INSERT INTO authors VALUES
      (1, 'J.K. Rowling', 'UK'),
      (2, 'George R.R. Martin', 'USA'),
      (3, 'J.R.R. Tolkien', 'UK'),
      (4, 'Yuval Noah Harari', 'Israel');

      CREATE TABLE books (
        book_id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        author_id INTEGER REFERENCES authors(author_id),
        genre TEXT,
        published_year INTEGER,
        available_copies INTEGER
      );

      INSERT INTO books VALUES
      (101, 'Harry Potter and the Sorcerer Stone', 1, 'Fantasy', 1997, 4),
      (102, 'A Game of Thrones', 2, 'Fantasy', 1996, 2),
      (103, 'The Fellowship of the Ring', 3, 'Fantasy', 1954, 5),
      (104, 'Sapiens: A Brief History of Humankind', 4, 'Non-Fiction', 2011, 3);

      CREATE TABLE members (
        member_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE,
        join_date TEXT
      );

      INSERT INTO members VALUES
      (201, 'Alex Rivera', 'alex@email.com', '2025-01-15'),
      (202, 'Maya Lin', 'maya@email.com', '2025-03-22'),
      (203, 'Carlos Gomez', 'carlos@email.com', '2025-05-10');

      CREATE TABLE loans (
        loan_id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER REFERENCES books(book_id),
        member_id INTEGER REFERENCES members(member_id),
        borrow_date TEXT,
        return_date TEXT,
        fine_amount REAL DEFAULT 0.0
      );

      INSERT INTO loans (book_id, member_id, borrow_date, return_date, fine_amount) VALUES
      (101, 201, '2026-09-01', '2026-09-14', 0.0),
      (102, 202, '2026-09-05', NULL, 5.0),
      (104, 203, '2026-09-10', '2026-09-20', 0.0);
    `,

    scratchpad: ``
  };

  // Starter queries for the active database. They only reference tables that exist in it.
  const templates = {
    university: [
      ['SELECT *', 'SELECT * FROM students LIMIT 10;'],
      ['GROUP BY', 'SELECT dept_id, COUNT(*) AS students FROM students GROUP BY dept_id;'],
      ['JOIN', 'SELECT s.student_name, c.course_name, e.grade\nFROM students s\nJOIN enrollments e ON s.student_id = e.student_id\nJOIN courses c ON e.course_id = c.course_id;'],
      ['Subquery', 'SELECT student_name, gpa FROM students\nWHERE gpa > (SELECT AVG(gpa) FROM students);']
    ],
    company: [
      ['SELECT *', 'SELECT * FROM employees LIMIT 10;'],
      ['GROUP BY', 'SELECT dept_id, COUNT(*) AS staff, AVG(salary) AS avg_salary\nFROM employees GROUP BY dept_id;'],
      ['Self join', 'SELECT e.emp_name, m.emp_name AS manager\nFROM employees e\nLEFT JOIN employees m ON e.manager_id = m.emp_id;'],
      ['JOIN', 'SELECT p.project_name, e.emp_name, a.role\nFROM project_assignments a\nJOIN projects p ON a.project_id = p.project_id\nJOIN employees e ON a.emp_id = e.emp_id;']
    ],
    library: [
      ['SELECT *', 'SELECT * FROM books;'],
      ['JOIN', 'SELECT b.title, a.name AS author\nFROM books b\nJOIN authors a ON b.author_id = a.author_id;'],
      ['LEFT JOIN', 'SELECT m.name, l.borrow_date, l.return_date\nFROM members m\nLEFT JOIN loans l ON m.member_id = l.member_id;'],
      ['Overdue', 'SELECT * FROM loans WHERE return_date IS NULL;']
    ],
    scratchpad: [
      ['CREATE TABLE', 'CREATE TABLE pets (\n  id INTEGER PRIMARY KEY,\n  name TEXT NOT NULL,\n  age INTEGER\n);'],
      ['INSERT', "INSERT INTO pets (name, age) VALUES ('Milo', 3), ('Luna', 5);"],
      ['SELECT', 'SELECT * FROM pets;']
    ]
  };

  const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

  async function init() {
    if (SQL) return { ok: true };
    if (typeof initSqlJs !== 'function') {
      return { ok: false, error: 'The SQL engine file could not be loaded.' };
    }
    try {
      SQL = await initSqlJs({ locateFile: (file) => `vendor/sql.js/${file}` });
      loadDatabase(activeDbKey);
      return { ok: true };
    } catch (err) {
      console.error('sql.js failed to start', err);
      return { ok: false, error: 'The SQL engine could not start in this browser.' };
    }
  }

  function loadDatabase(key) {
    if (!SQL) return;
    if (!datasets[key] && datasets[key] !== '') key = 'university';
    activeDbKey = key;
    if (activeDb) { try { activeDb.close(); } catch { /* already closed */ } }
    activeDb = new SQL.Database();
    if (datasets[key]) activeDb.run(datasets[key]);
  }

  function inspectTables() {
    if (!activeDb) return [];
    const res = activeDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;");
    if (!res.length) return [];
    return res[0].values.map(([name]) => {
      const cols = activeDb.exec(`PRAGMA table_info(${quoteIdent(name)});`);
      const columns = cols.length ? cols[0].values.map((c) => ({ name: c[1], type: c[2] || '', pk: c[5] > 0 })) : [];
      const count = activeDb.exec(`SELECT COUNT(*) FROM ${quoteIdent(name)};`);
      return { name, columns, rowCount: count.length ? count[0].values[0][0] : 0 };
    });
  }

  function previewRows(table, limit = 3) {
    if (!activeDb) return { columns: [], values: [] };
    const res = activeDb.exec(`SELECT * FROM ${quoteIdent(table)} LIMIT ${Number(limit) | 0};`);
    return res.length ? res[0] : { columns: [], values: [] };
  }

  function stripComments(sql) {
    return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').trim();
  }

  function lastStatement(sql) {
    const clean = stripComments(sql).replace(/;\s*$/, '');
    const i = clean.lastIndexOf(';');
    return (i >= 0 ? clean.slice(i + 1) : clean).trim();
  }

  function execute(sql) {
    if (!activeDb) return { success: false, error: 'The SQL engine is not ready yet.' };
    if (!sql || !sql.trim()) return { success: false, error: 'Write a query first.' };
    if (sql.length > MAX_SQL_LENGTH) {
      return { success: false, error: `That script is longer than ${MAX_SQL_LENGTH.toLocaleString()} characters.` };
    }

    const started = performance.now();
    try {
      const sets = activeDb.exec(sql);
      const execTimeMs = Math.round((performance.now() - started) * 10) / 10;
      const last = lastStatement(sql);

      if (sets.length) {
        const result = sets[sets.length - 1];
        return {
          success: true, kind: 'rows', columns: result.columns, values: result.values,
          rowCount: result.values.length, resultSets: sets.length, execTimeMs
        };
      }
      if (/^(select|with|pragma|values|explain)\b/i.test(last)) {
        return { success: true, kind: 'empty', message: 'The query ran and returned 0 rows.', execTimeMs };
      }
      // getRowsModified() reports the most recent INSERT/UPDATE/DELETE, so only quote it for those.
      const singleDml = /^(insert|update|delete|replace)\b/i.test(stripComments(sql)) && !/;\s*\S/.test(stripComments(sql));
      const message = singleDml
        ? `Done. ${activeDb.getRowsModified()} row${activeDb.getRowsModified() === 1 ? '' : 's'} changed.`
        : 'Done. The statement ran successfully.';
      return { success: true, kind: 'command', message, execTimeMs };
    } catch (err) {
      return {
        success: false,
        error: String(err.message || err),
        tip: tipFor(String(err.message || err)),
        execTimeMs: Math.round((performance.now() - started) * 10) / 10
      };
    }
  }

  function tipFor(message) {
    if (/no such table/i.test(message)) return 'Check the table name against the Tables list, and make sure the right database is selected.';
    if (/no such column/i.test(message)) return 'Check the column spelling. If the column is in a joined table, prefix it with the table alias, like s.gpa.';
    if (/ambiguous column/i.test(message)) return 'More than one table has this column. Prefix it with a table alias, like s.student_id.';
    if (/syntax error/i.test(message)) return 'Look near the quoted text for a missing comma, an unclosed quote or bracket, or a misspelled keyword.';
    if (/UNIQUE constraint|PRIMARY KEY/i.test(message)) return 'A row with that key already exists. Use a different value or update the existing row.';
    if (/FOREIGN KEY|NOT NULL constraint/i.test(message)) return 'The data breaks a table rule. Check required columns and referenced keys.';
    if (/already exists/i.test(message)) return 'Use a different name, or add IF NOT EXISTS.';
    return '';
  }

  // Uppercases keywords and starts main clauses on a new line. Text inside quotes
  // and comments is left exactly as written.
  function formatSql(query) {
    if (!query) return '';
    const keywords = ['SELECT', 'DISTINCT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN',
      'IS NULL', 'IS NOT NULL', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'ON',
      'GROUP BY', 'HAVING', 'ORDER BY', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'UNION ALL', 'UNION', 'INSERT INTO',
      'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'CREATE TABLE', 'DROP TABLE', 'ALTER TABLE', 'PRIMARY KEY',
      'FOREIGN KEY', 'REFERENCES', 'DEFAULT', 'CHECK', 'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'COALESCE',
      'COUNT', 'AVG', 'SUM', 'MIN', 'MAX', 'OVER', 'PARTITION BY', 'DENSE_RANK', 'RANK', 'EXISTS'];
    const breakBefore = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'INNER JOIN', 'LEFT JOIN',
      'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'UNION ALL', 'UNION'];
    const kwRe = new RegExp(`\\b(${keywords.map((k) => k.replace(/ /g, '\\s+')).join('|')})\\b`, 'gi');
    const brRe = new RegExp(`\\s+(${breakBefore.map((k) => k.replace(/ /g, '\\s+')).join('|')})\\b`, 'g');
    const parts = query.split(/('(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\/)/);
    const out = parts.map((part, i) => {
      if (i % 2 === 1) return part; // quoted text or comment
      return part
        .replace(kwRe, (m) => m.toUpperCase().replace(/\s+/g, ' '))
        .replace(brRe, '\n$1');
    }).join('');
    return out.trim();
  }

  function resultsToCsv(columns, values) {
    const cell = (v) => (v === null || v === undefined ? '' : `"${String(v).replace(/"/g, '""')}"`);
    const header = columns.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',');
    return [header, ...values.map((row) => row.map(cell).join(','))].join('\r\n');
  }

  return {
    init, loadDatabase, inspectTables, previewRows, execute, formatSql, resultsToCsv,
    templatesFor: (key) => templates[key] || [],
    getActiveDbKey: () => activeDbKey,
    MAX_SQL_LENGTH
  };
})();
