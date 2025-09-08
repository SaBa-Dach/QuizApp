const express = require("express");
const cors = require("cors");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from "public" folder
app.use(express.static(path.join(__dirname, "public")));

const DATA_DIR = path.join(__dirname, "data");

function readJSON(filename) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), "utf8"));
}

function writeJSON(filename, data) {
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}

// --- Routes ---

// Default route for "/"
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Sign-in
app.post("/signin", (req, res) => {
  const { firstName, lastName } = req.body;
  if (!firstName || !lastName) return res.status(400).json({ error: "First name and last name are required" });

  const teachers = readJSON("teachers.json").teachers;
  const isTeacher = teachers.some(
    t => t.firstName.toLowerCase() === firstName.toLowerCase() &&
         t.lastName.toLowerCase() === lastName.toLowerCase()
  );

  const users = readJSON("users.json").users;
  let user = users.find(
    u => u.firstName.toLowerCase() === firstName.toLowerCase() &&
         u.lastName.toLowerCase() === lastName.toLowerCase()
  );

  if (!user) {
    user = { id: uuidv4(), firstName, lastName, role: isTeacher ? "teacher" : "student" };
    users.push(user);
    writeJSON("users.json", { users });
  }

  res.json({ token: user.id, role: user.role });
});

// Start quiz
app.post("/session/start", (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "Token required" });

  const users = readJSON("users.json").users;
  const teacher = users.find(u => u.id === token && u.role === "teacher");
  if (!teacher) return res.status(403).json({ error: "Only teacher can start quiz" });

  const sessions = readJSON("sessions.json").sessions;
  const startTime = Date.now();
  const endTime = startTime + 60 * 60 * 1000; // 1 hour

  sessions.push({ startTime, endTime });
  writeJSON("sessions.json", { sessions });

  res.json({ message: "Quiz started", startTime, endTime });
});

// Get questions
app.get("/questions", (req, res) => {
  const sessions = readJSON("sessions.json").sessions;
  if (sessions.length === 0) return res.status(403).json({ error: "Quiz has not started yet" });

  const latestSession = sessions[sessions.length - 1];
  const now = Date.now();
  if (now > latestSession.endTime) return res.status(403).json({ error: "Quiz ended" });

  const questions = readJSON("questions.json").questions.map(q => {
    const { correctAnswer, ...rest } = q;
    return rest;
  });

  res.json({ remainingTimeMs: latestSession.endTime - now, questions });
});

// Submit answers
app.post("/submit", (req, res) => {
  const { token, answers } = req.body;
  if (!token || !answers) return res.status(400).json({ error: "Token and answers required" });

  const users = readJSON("users.json").users;
  const user = users.find(u => u.id === token && u.role === "student");
  if (!user) return res.status(403).json({ error: "Only students can submit" });

  const sessions = readJSON("sessions.json").sessions;
  if (sessions.length === 0) return res.status(403).json({ error: "Quiz not started" });

  const latestSession = sessions[sessions.length - 1];
  const now = Date.now();
  if (now > latestSession.endTime) return res.status(403).json({ error: "Quiz ended" });

  const submissions = readJSON("submissions.json").submissions;
  submissions.push({ userId: user.id, answers, submittedAt: now });
  writeJSON("submissions.json", { submissions });

  res.json({ message: "Answers submitted" });
});

// Get results
app.get("/results", (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Token required" });

  const users = readJSON("users.json").users;
  const teacher = users.find(u => u.id === token && u.role === "teacher");
  if (!teacher) return res.status(403).json({ error: "Only teacher can view results" });

  const questions = readJSON("questions.json").questions;
  const submissions = readJSON("submissions.json").submissions;

  const results = submissions.map(sub => {
    const user = users.find(u => u.id === sub.userId);
    let score = 0;
    questions.forEach(q => {
      if (sub.answers[q.id] === q.correctAnswer) score++;
    });
    return { name: `${user.firstName} ${user.lastName}`, score, total: questions.length, answers: sub.answers };
  });

  res.json(results);
});

// Get stats
app.get("/stats", (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Token required" });

  const users = readJSON("users.json").users;
  const teacher = users.find(u => u.id === token && u.role === "teacher");
  if (!teacher) return res.status(403).json({ error: "Only teacher can view stats" });

  const questions = readJSON("questions.json").questions;
  const submissions = readJSON("submissions.json").submissions;

  const stats = questions.map(q => {
    const answerCounts = { a: 0, b: 0, c: 0, d: 0 };
    submissions.forEach(sub => {
      const ans = sub.answers[q.id];
      if (ans && answerCounts.hasOwnProperty(ans)) answerCounts[ans]++;
    });
    return { question: q.text, answers: answerCounts };
  });

  res.json(stats);
});

// --- Start server ---
const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
app.get('/', (req, res) => {
    res.send('Server is running!');
});