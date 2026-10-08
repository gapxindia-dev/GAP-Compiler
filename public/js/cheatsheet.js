// cheatsheet.js - Interactive SQL Joins Visualizer, Cheatsheets, and Lab Viva Questions

const CheatsheetModule = (() => {
  const joinsData = [
    {
      type: 'INNER JOIN',
      title: 'INNER JOIN (Intersection)',
      desc: 'Returns only records that have matching values in both tables.',
      svg: `<svg viewBox="0 0 200 90" class="join-diagram-svg">
        <circle cx="75" cy="45" r="35" fill="rgba(99, 102, 241, 0.2)" stroke="#6366f1" stroke-width="2"/>
        <circle cx="125" cy="45" r="35" fill="rgba(6, 182, 212, 0.2)" stroke="#06b6d4" stroke-width="2"/>
        <clipPath id="innerClip">
          <circle cx="75" cy="45" r="35" />
        </clipPath>
        <circle cx="125" cy="45" r="35" fill="#10b981" clip-path="url(#innerClip)"/>
        <text x="60" y="49" fill="#fff" font-size="9" font-family="sans-serif">Table A</text>
        <text x="115" y="49" fill="#fff" font-size="9" font-family="sans-serif">Table B</text>
      </svg>`,
      sql: `SELECT s.student_name, c.course_name\nFROM students s\nINNER JOIN enrollments e ON s.student_id = e.student_id\nINNER JOIN courses c ON e.course_id = c.course_id;`
    },
    {
      type: 'LEFT JOIN',
      title: 'LEFT (OUTER) JOIN',
      desc: 'Returns all records from the left table, and matched records from the right table (NULL if no match).',
      svg: `<svg viewBox="0 0 200 90" class="join-diagram-svg">
        <circle cx="75" cy="45" r="35" fill="#10b981" stroke="#10b981" stroke-width="2"/>
        <circle cx="125" cy="45" r="35" fill="none" stroke="#06b6d4" stroke-width="2"/>
        <clipPath id="leftClip">
          <circle cx="125" cy="45" r="35" />
        </clipPath>
        <circle cx="125" cy="45" r="35" fill="#10b981" clip-path="url(#leftClip)"/>
        <text x="60" y="49" fill="#fff" font-size="9" font-family="sans-serif">Table A</text>
        <text x="115" y="49" fill="#9ca3af" font-size="9" font-family="sans-serif">Table B</text>
      </svg>`,
      sql: `-- List all students even if they haven't enrolled in any courses yet\nSELECT s.student_name, e.course_id\nFROM students s\nLEFT JOIN enrollments e ON s.student_id = e.student_id;`
    },
    {
      type: 'RIGHT JOIN',
      title: 'RIGHT (OUTER) JOIN',
      desc: 'Returns all records from the right table, and matched records from the left table (NULL if no match).',
      svg: `<svg viewBox="0 0 200 90" class="join-diagram-svg">
        <circle cx="75" cy="45" r="35" fill="none" stroke="#6366f1" stroke-width="2"/>
        <circle cx="125" cy="45" r="35" fill="#10b981" stroke="#10b981" stroke-width="2"/>
        <text x="50" y="49" fill="#9ca3af" font-size="9" font-family="sans-serif">Table A</text>
        <text x="115" y="49" fill="#fff" font-size="9" font-family="sans-serif">Table B</text>
      </svg>`,
      sql: `-- List all courses even if no student has registered for them\nSELECT c.course_name, s.student_name\nFROM enrollments e\nRIGHT JOIN courses c ON e.course_id = c.course_id\nLEFT JOIN students s ON e.student_id = s.student_id;`
    },
    {
      type: 'FULL JOIN',
      title: 'FULL OUTER JOIN',
      desc: 'Returns all records when there is a match in either left or right table records.',
      svg: `<svg viewBox="0 0 200 90" class="join-diagram-svg">
        <circle cx="75" cy="45" r="35" fill="#10b981" stroke="#10b981" stroke-width="2"/>
        <circle cx="125" cy="45" r="35" fill="#10b981" stroke="#10b981" stroke-width="2"/>
        <text x="60" y="49" fill="#fff" font-size="9" font-family="sans-serif">Table A</text>
        <text x="115" y="49" fill="#fff" font-size="9" font-family="sans-serif">Table B</text>
      </svg>`,
      sql: `-- Returns all departments and all students (combines LEFT and RIGHT JOIN)\nSELECT s.student_name, d.dept_name\nFROM students s\nFULL OUTER JOIN departments d ON s.dept_id = d.dept_id;`
    },
    {
      type: 'SELF JOIN',
      title: 'SELF JOIN (Hierarchies)',
      desc: 'A regular join in which a table is joined with itself (useful for Employee-Manager or Prerequisite courses).',
      svg: `<svg viewBox="0 0 200 90" class="join-diagram-svg">
        <rect x="50" y="20" width="100" height="50" rx="8" fill="rgba(99, 102, 241, 0.25)" stroke="#6366f1" stroke-width="2"/>
        <path d="M110 20 C140 -5, 170 30, 150 45" fill="none" stroke="#10b981" stroke-width="2" marker-end="url(#arrow)"/>
        <text x="75" y="49" fill="#fff" font-size="10" font-family="sans-serif">Same Table</text>
      </svg>`,
      sql: `-- Find Employee and their Manager's name from same table\nSELECT e.emp_name AS "Employee", m.emp_name AS "Manager"\nFROM employees e\nLEFT JOIN employees m ON e.manager_id = m.emp_id;`
    },
    {
      type: 'CROSS JOIN',
      title: 'CROSS JOIN (Cartesian Product)',
      desc: 'Returns Cartesian product of rows from tables (every row of Table A matched with every row of Table B).',
      svg: `<svg viewBox="0 0 200 90" class="join-diagram-svg">
        <rect x="40" y="25" width="40" height="40" rx="4" fill="#6366f1"/>
        <text x="88" y="50" fill="#fff" font-size="14">✕</text>
        <rect x="115" y="25" width="40" height="40" rx="4" fill="#06b6d4"/>
      </svg>`,
      sql: `-- Generate all possible combinations of sizes and colors\nSELECT s.size, c.color\nFROM sizes s\nCROSS JOIN colors c;`
    }
  ];

  const vivaQuestions = [
    {
      q: '1. What is the difference between WHERE and HAVING clause?',
      a: '<strong>WHERE</strong> filters rows <em>before</em> any grouping or aggregate calculation takes place and cannot contain aggregate functions like SUM() or AVG(). <br><strong>HAVING</strong> filters groups <em>after</em> the GROUP BY clause and can evaluate aggregate expressions (e.g. <code>HAVING COUNT(*) > 5</code>).'
    },
    {
      q: '2. What is the difference between PRIMARY KEY and UNIQUE KEY?',
      a: 'A <strong>PRIMARY KEY</strong> uniquely identifies each record, cannot accept NULL values, and a table can have only ONE primary key.<br>A <strong>UNIQUE KEY</strong> also prevents duplicates, but CAN accept NULL values (one or more depending on RDBMS), and a table can have multiple unique keys.'
    },
    {
      q: '3. What is the difference between TRUNCATE, DROP, and DELETE?',
      a: '• <strong>DELETE</strong> is a DML command; removes specific rows using WHERE; slower; fires triggers; can be rolled back.<br>• <strong>TRUNCATE</strong> is a DDL command; removes all rows instantly; resets identity counters; cannot use WHERE.<br>• <strong>DROP</strong> removes the entire table definition, structure, and data from the database schema.'
    },
    {
      q: '4. What is a Foreign Key and Referential Integrity?',
      a: 'A <strong>Foreign Key</strong> is a field in one table that references the Primary Key of another table. <strong>Referential Integrity</strong> ensures relationships between tables remain consistent, preventing orphan records using constraints like <code>ON DELETE CASCADE</code> or <code>ON DELETE RESTRICT</code>.'
    },
    {
      q: '5. What are Window Functions (OVER, PARTITION BY, RANK)?',
      a: 'Window functions perform calculations across a set of table rows that are related to the current row without collapsing rows like GROUP BY does. <br>Examples: <code>ROW_NUMBER()</code>, <code>RANK()</code>, <code>DENSE_RANK()</code>, and <code>LEAD()/LAG()</code> with <code>OVER (PARTITION BY dept_id ORDER BY salary DESC)</code>.'
    },
    {
      q: '6. What are the Database Normal Forms (1NF, 2NF, 3NF, BCNF)?',
      a: '• <strong>1NF</strong>: Atomic values in each column, no repeating groups.<br>• <strong>2NF</strong>: In 1NF and no partial dependency (all non-key attributes fully depend on composite primary key).<br>• <strong>3NF</strong>: In 2NF and no transitive dependency (non-key attribute depends on another non-key attribute).<br>• <strong>BCNF</strong>: For every functional dependency X → Y, X must be a super key.'
    },
    {
      q: '7. What are ACID properties in DBMS transactions?',
      a: '• <strong>Atomicity</strong>: All operations succeed or none do ("All or Nothing").<br>• <strong>Consistency</strong>: Database moves from one valid state to another satisfying all integrity rules.<br>• <strong>Isolation</strong>: Concurrent transactions execute independently without interfering.<br>• <strong>Durability</strong>: Once committed, updates persist even after system crashes.'
    },
    {
      q: '8. How does NULL work in SQL comparisons?',
      a: 'In SQL, NULL represents missing or unknown data. NULL is not equal to 0, empty string, or even another NULL! Therefore, expressions like <code>col = NULL</code> always evaluate to UNKNOWN/false. You must always use <code>IS NULL</code> or <code>IS NOT NULL</code>.'
    },
    {
      q: '9. What is the difference between UNION and UNION ALL?',
      a: '• <strong>UNION</strong> combines result sets of two queries and eliminates duplicate rows (incurs sorting overhead).<br>• <strong>UNION ALL</strong> combines result sets and keeps all duplicates, making it significantly faster when duplicates are acceptable.'
    },
    {
      q: '10. What is an Index and when should you avoid creating one?',
      a: 'An <strong>Index</strong> (like B-Tree) speeds up data retrieval (SELECT queries) by providing fast lookups. However, indexes slow down INSERT, UPDATE, and DELETE operations because the index must be updated each time, and they consume additional disk space.'
    }
  ];

  const clausesOrder = [
    { num: 1, clause: 'FROM & JOINs', desc: 'Determines the source tables and builds Cartesian products / joins.' },
    { num: 2, clause: 'WHERE', desc: 'Filters rows at the individual record level before grouping.' },
    { num: 3, clause: 'GROUP BY', desc: 'Collapses rows into summary groups based on common column values.' },
    { num: 4, clause: 'HAVING', desc: 'Filters aggregated groups based on summary conditions (e.g. COUNT > 2).' },
    { num: 5, clause: 'SELECT', desc: 'Evaluates expressions, computes column aliases, and picks output columns.' },
    { num: 6, clause: 'DISTINCT', desc: 'Removes duplicate rows from the computed select list.' },
    { num: 7, clause: 'ORDER BY', desc: 'Sorts the final rows in ascending (ASC) or descending (DESC) order.' },
    { num: 8, clause: 'LIMIT / OFFSET', desc: 'Restricts the number of rows returned to the client.' }
  ];

  function renderJoins() {
    return `<div class="joins-grid">
      ${joinsData.map(j => `
        <div class="join-card">
          ${j.svg}
          <h4 class="join-title">${j.title}</h4>
          <p class="join-desc">${j.desc}</p>
          <pre class="join-code"><code>${j.sql}</code></pre>
          <button class="btn btn-xs btn-outline mt-sm" onclick="App.loadSqlToRunner(\`${j.sql.replace(/`/g, '\\`')}\`)">⚡ Try in SQL Runner</button>
        </div>
      `).join('')}
    </div>`;
  }

  function renderSyntax() {
    return `
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:1.25rem;">
        <div class="join-card">
          <h4 class="join-title">DDL (Data Definition Language)</h4>
          <pre class="join-code"><code>-- Create Table with Constraints
CREATE TABLE students (
    student_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    gpa REAL CHECK(gpa >= 0.0 AND gpa <= 4.0),
    dept_id INTEGER REFERENCES departments(dept_id)
);

-- Alter Table Structure
ALTER TABLE students ADD COLUMN phone TEXT;
ALTER TABLE students DROP COLUMN phone;

-- Drop Table
DROP TABLE IF EXISTS students;</code></pre>
        </div>

        <div class="join-card">
          <h4 class="join-title">DML (Data Manipulation Language)</h4>
          <pre class="join-code"><code>-- Insert Data
INSERT INTO students (student_id, name, gpa, dept_id)
VALUES (101, 'Kunal', 3.85, 1);

-- Update Rows
UPDATE students
SET gpa = 3.92
WHERE student_id = 101;

-- Delete Rows
DELETE FROM students
WHERE gpa < 2.0;</code></pre>
        </div>

        <div class="join-card">
          <h4 class="join-title">Aggregate & Group Functions</h4>
          <pre class="join-code"><code>-- Standard Aggregations
SELECT 
    dept_id,
    COUNT(*) AS total_students,
    AVG(gpa) AS average_gpa,
    MAX(gpa) AS highest_gpa,
    MIN(gpa) AS lowest_gpa
FROM students
GROUP BY dept_id
HAVING COUNT(*) >= 2;</code></pre>
        </div>

        <div class="join-card">
          <h4 class="join-title">String & Date Helpers</h4>
          <pre class="join-code"><code>-- String functions
SELECT 
    UPPER(student_name) AS upper_name,
    LOWER(email) AS clean_email,
    LENGTH(student_name) AS name_len,
    SUBSTR(student_name, 1, 3) AS initials
FROM students;

-- Pattern matching
SELECT * FROM students WHERE email LIKE '%@univ.edu';</code></pre>
        </div>
      </div>
    `;
  }

  function renderClauses() {
    return `
      <div class="order-steps-list">
        <p class="text-sm text-secondary mb-md">Understanding SQL clause execution order is the #1 secret to debugging queries and knowing why column aliases cannot be used in WHERE clauses!</p>
        ${clausesOrder.map(c => `
          <div class="order-step-card">
            <div class="order-num">${c.num}</div>
            <div class="order-info">
              <h4>${c.clause}</h4>
              <p>${c.desc}</p>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderViva() {
    return `
      <div class="viva-accordion">
        <p class="text-sm text-secondary mb-md">Frequently asked questions by university professors and external lab examiners during DBMS practical examinations:</p>
        ${vivaQuestions.map((v, i) => `
          <div class="viva-item">
            <div class="viva-question" onclick="CheatsheetModule.toggleViva(${i})">
              <span>${v.q}</span>
              <span id="viva-icon-${i}">▼</span>
            </div>
            <div class="viva-answer" id="viva-ans-${i}" style="${i === 0 ? 'display:block;' : 'display:none;'}">
              ${v.a}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function toggleViva(index) {
    const el = document.getElementById(`viva-ans-${index}`);
    const icon = document.getElementById(`viva-icon-${index}`);
    if (el) {
      if (el.style.display === 'none') {
        el.style.display = 'block';
        if (icon) icon.textContent = '▲';
      } else {
        el.style.display = 'none';
        if (icon) icon.textContent = '▼';
      }
    }
  }

  function init(tabName = 'joins') {
    const content = document.getElementById('cheat-tab-content');
    if (!content) return;

    if (tabName === 'joins') content.innerHTML = renderJoins();
    else if (tabName === 'syntax') content.innerHTML = renderSyntax();
    else if (tabName === 'clauses') content.innerHTML = renderClauses();
    else if (tabName === 'viva') content.innerHTML = renderViva();
  }

  return {
    init,
    toggleViva
  };
})();
