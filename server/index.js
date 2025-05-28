import express from 'express';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { stringify } from 'csv-stringify/sync';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const ADMIN_PASSWORD = 'admin';

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

let db;

async function initDb() {
  db = await open({
    filename: path.join(__dirname, 'quiz.db'),
    driver: sqlite3.Database
  });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      start_time DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      a TEXT NOT NULL,
      b TEXT NOT NULL,
      c TEXT NOT NULL,
      d TEXT NOT NULL,
      correct TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER,
      question_id INTEGER,
      answer TEXT,
      correct INTEGER,
      FOREIGN KEY(candidate_id) REFERENCES candidates(id),
      FOREIGN KEY(question_id) REFERENCES questions(id)
    );
  `);

  const count = await db.get('SELECT COUNT(*) as cnt FROM questions');
  if (count.cnt === 0) {
    const questions = [
      {
        text: 'Qual número completa a sequência: 2, 4, 8, 16, ?',
        a: '18', b: '24', c: '32', d: '34', correct: 'c'
      },
      {
        text: 'Se todos os bloops são razzies e todos os razzies são lazzies, todos os bloops são lazzies?',
        a: 'Sim', b: 'Não', c: 'Talvez', d: 'Apenas às vezes', correct: 'a'
      },
      {
        text: 'Quantos lados tem um dodecágono?',
        a: '10', b: '12', c: '14', d: '8', correct: 'b'
      }
    ];
    for (const q of questions) {
      await db.run('INSERT INTO questions (text,a,b,c,d,correct) VALUES (?,?,?,?,?,?)',
        q.text, q.a, q.b, q.c, q.d, q.correct);
    }
  }
}

app.post('/api/start', async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Dados inválidos' });
  const result = await db.run('INSERT INTO candidates (name,email) VALUES (?,?)', name, email);
  res.json({ candidateId: result.lastID });
});

app.get('/api/questions/:index', async (req, res) => {
  const idx = parseInt(req.params.index, 10);
  const q = await db.get('SELECT * FROM questions LIMIT 1 OFFSET ?', idx);
  if (!q) return res.json({ done: true });
  const { id, text, a, b, c, d } = q;
  res.json({ id, text, options: { a, b, c, d } });
});

app.post('/api/answer', async (req, res) => {
  const { candidateId, questionId, answer } = req.body;
  const q = await db.get('SELECT correct FROM questions WHERE id=?', questionId);
  const correct = q && q.correct === answer ? 1 : 0;
  await db.run(
    'INSERT INTO answers (candidate_id, question_id, answer, correct) VALUES (?,?,?,?)',
    candidateId, questionId, answer, correct
  );
  res.json({ correct });
});

app.get('/api/result/:candidateId', async (req, res) => {
  const { candidateId } = req.params;
  const stats = await db.get(
    'SELECT COUNT(*) as total, SUM(correct) as score FROM answers WHERE candidate_id=?',
    candidateId
  );
  res.json({ score: stats.score || 0, total: stats.total || 0 });
});

function adminAuth(req, res, next) {
  const pass = req.query.password;
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.get('/api/admin/candidates', adminAuth, async (req, res) => {
  const rows = await db.all(`
    SELECT c.id, c.name, c.email, c.start_time,
           SUM(a.correct) as score, COUNT(a.id) as total
    FROM candidates c
    LEFT JOIN answers a ON a.candidate_id = c.id
    GROUP BY c.id
    ORDER BY c.start_time DESC
  `);
  res.json(rows);
});

app.get('/api/admin/csv', adminAuth, async (req, res) => {
  const rows = await db.all(`
    SELECT c.name, c.email, c.start_time, SUM(a.correct) as score, COUNT(a.id) as total
    FROM candidates c
    LEFT JOIN answers a ON a.candidate_id = c.id
    GROUP BY c.id
    ORDER BY c.start_time DESC
  `);
  const csv = stringify(rows, { header: true });
  res.header('Content-Type', 'text/csv');
  res.attachment('candidates.csv');
  res.send(csv);
});

initDb().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});

