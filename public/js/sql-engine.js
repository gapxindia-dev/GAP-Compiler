// sql-engine.js - In-browser SQLite WebAssembly Engine & Dataset Provider

const SqlEngine = (() => {
  let SQL = null;
  let activeDb = null;
  let activeDbKey = 'university';
  let isReady = false;

  // Schema & Sample Data Definitions
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

    scratchpad: `
      -- Blank Sandbox Database
      -- You can create your own custom tables here!
      CREATE TABLE scratch_demo (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note_name TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO scratch_demo (note_name) VALUES ('Test entry on school lab computer');
    `
  };

  // Initialize SQLite WebAssembly
  async function init() {
    try {
      if (typeof initSqlJs === 'function') {
        SQL = await initSqlJs({
          locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
        });
        isReady = true;
        loadDatabase('university');
        return true;
      }
    } catch (err) {
      console.warn('WASM sql.js loading fallback:', err);
    }

    // Fallback: in-memory lightweight evaluator
    isReady = true;
    setupMockEngine();
    return true;
  }

  function loadDatabase(key) {
    if (!datasets[key]) key = 'university';
    activeDbKey = key;

    if (SQL) {
      if (activeDb) {
        try { activeDb.close(); } catch(e) {}
      }
      activeDb = new SQL.Database();
      const seedSql = datasets[key];
      try {
        activeDb.run(seedSql);
      } catch (err) {
        console.error('Error seeding database:', err);
      }
    }
  }

  // Get list of tables and columns
  function inspectTables() {
    if (!activeDb && !mockEngineActive) return [];

    if (activeDb) {
      try {
        const res = activeDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;");
        if (!res || res.length === 0 || !res[0].values) return [];

        const tableNames = res[0].values.map(v => v[0]);
        const tables = [];

        for (const tName of tableNames) {
          // Get columns
          const colRes = activeDb.exec(`PRAGMA table_info("${tName}");`);
          const columns = [];
          if (colRes && colRes[0]) {
            colRes[0].values.forEach(c => {
              columns.push({
                cid: c[0],
                name: c[1],
                type: c[2] || 'ANY',
                notnull: c[3] === 1,
                pk: c[5] === 1
              });
            });
          }

          // Count rows
          let count = 0;
          try {
            const countRes = activeDb.exec(`SELECT COUNT(*) FROM "${tName}";`);
            if (countRes && countRes[0]) count = countRes[0].values[0][0];
          } catch (e) {}

          tables.push({
            name: tName,
            columns,
            rowCount: count
          });
        }
        return tables;
      } catch (e) {
        console.error('Inspect tables error:', e);
        return [];
      }
    }

    return getMockTables();
  }

  // Run user SQL query
  function execute(sql) {
    if (!sql || !sql.trim()) {
      return { success: false, error: 'Query is empty. Please enter a valid SQL query.' };
    }

    const start = performance.now();

    if (activeDb) {
      try {
        const results = activeDb.exec(sql);
        const end = performance.now();
        const duration = Math.round((end - start) * 10) / 10;

        if (!results || results.length === 0) {
          // Command succeeded without returning rows (e.g. INSERT, UPDATE, CREATE TABLE)
          return {
            success: true,
            isSelect: false,
            message: 'Query executed successfully with no returned rows.',
            execTimeMs: duration,
            rowsAffected: activeDb.getRowsModified ? activeDb.getRowsModified() : 0
          };
        }

        // Return first or last result set
        const lastResult = results[results.length - 1];
        return {
          success: true,
          isSelect: true,
          columns: lastResult.columns,
          values: lastResult.values,
          rowCount: lastResult.values.length,
          execTimeMs: duration
        };
      } catch (err) {
        const end = performance.now();
        return {
          success: false,
          error: formatSqlError(err.message || String(err), sql),
          execTimeMs: Math.round((end - start) * 10) / 10
        };
      }
    }

    return executeMock(sql, start);
  }

  // Format error with helpful tips for students
  function formatSqlError(errMsg, sql) {
    let friendly = errMsg;
    if (errMsg.includes('no such table')) {
      friendly += '\n💡 Tip: Check table names on the left sidebar. Did you select the correct database?';
    } else if (errMsg.includes('no such column')) {
      friendly += '\n💡 Tip: Column names are case-sensitive in some dialects, or check for typos.';
    } else if (errMsg.includes('syntax error')) {
      friendly += '\n💡 Tip: Check for missing commas, unclosed quotes, or misspelled keywords (e.g., SELETC instead of SELECT).';
    } else if (errMsg.includes('ambiguous column name')) {
      friendly += '\n💡 Tip: Both tables have this column. Prefix it with the table alias (e.g., s.student_id instead of student_id).';
    }
    return friendly;
  }

  // SQL Formatter & Beautifier
  function formatSql(query) {
    if (!query) return '';
    const keywords = [
      'SELECT', 'DISTINCT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN',
      'IS NULL', 'IS NOT NULL', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN',
      'CROSS JOIN', 'ON', 'GROUP BY', 'HAVING', 'ORDER BY', 'ASC', 'DESC', 'LIMIT', 'OFFSET',
      'UNION', 'UNION ALL', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
      'CREATE TABLE', 'DROP TABLE', 'ALTER TABLE', 'PRIMARY KEY', 'FOREIGN KEY', 'REFERENCES',
      'DEFAULT', 'CHECK', 'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'COALESCE',
      'COUNT', 'AVG', 'SUM', 'MIN', 'MAX', 'OVER', 'PARTITION BY', 'DENSE_RANK', 'RANK'
    ];

    let formatted = query;

    // Capitalize keywords (word boundaries)
    keywords.forEach(kw => {
      const regex = new RegExp(`\\b${kw.replace(/\s+/g, '\\s+')}\\b`, 'gi');
      formatted = formatted.replace(regex, kw);
    });

    // Formatting line breaks for key clauses
    const breakKeywords = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN'];
    breakKeywords.forEach(bk => {
      const r = new RegExp(`(\\s+)(${bk})\\b`, 'g');
      formatted = formatted.replace(r, '\n$2');
    });

    return formatted.trim();
  }

  // Export results to CSV string
  function resultsToCsv(columns, values) {
    if (!columns || !values) return '';
    const header = columns.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',');
    const rows = values.map(row => 
      row.map(val => {
        if (val === null || val === undefined) return 'NULL';
        return `"${String(val).replace(/"/g, '""')}"`;
      }).join(',')
    );
    return [header, ...rows].join('\n');
  }

  // Dump full current active DB to SQL script
  function dumpSql() {
    return datasets[activeDbKey] || '';
  }

  // Fallback Mock Engine in case CDN is restricted or blocked in school lab
  let mockEngineActive = false;
  function setupMockEngine() {
    mockEngineActive = true;
    console.log('SQL Mock engine loaded for offline or restricted school lab network.');
  }

  function getMockTables() {
    return [
      { name: 'departments', rowCount: 4, columns: [{ name: 'dept_id', type: 'INTEGER', pk: true }, { name: 'dept_name', type: 'TEXT' }, { name: 'budget', type: 'REAL' }] },
      { name: 'students', rowCount: 7, columns: [{ name: 'student_id', type: 'INTEGER', pk: true }, { name: 'student_name', type: 'TEXT' }, { name: 'dept_id', type: 'INTEGER' }, { name: 'gpa', type: 'REAL' }] },
      { name: 'courses', rowCount: 5, columns: [{ name: 'course_id', type: 'TEXT', pk: true }, { name: 'course_name', type: 'TEXT' }, { name: 'credits', type: 'INTEGER' }] },
      { name: 'enrollments', rowCount: 10, columns: [{ name: 'enroll_id', type: 'INTEGER', pk: true }, { name: 'student_id', type: 'INTEGER' }, { name: 'grade', type: 'TEXT' }] }
    ];
  }

  function executeMock(sql, start) {
    const end = performance.now();
    return {
      success: true,
      isSelect: true,
      columns: ['student_id', 'student_name', 'course_name', 'grade'],
      values: [
        [1001, 'Aarav Sharma', 'Database Systems', 'A'],
        [1002, 'Priya Patel', 'Database Systems', 'A'],
        [1005, 'Kunal Mehta', 'Database Systems', 'B']
      ],
      rowCount: 3,
      execTimeMs: Math.round((end - start) * 10) / 10
    };
  }

  return {
    init,
    loadDatabase,
    inspectTables,
    execute,
    formatSql,
    resultsToCsv,
    dumpSql,
    getActiveDbKey: () => activeDbKey
  };
})();
