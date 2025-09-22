const express = require("express");
const cors = require("cors");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const app = express();
const corsOptions = {
  origin: "http://localhost",
  allowedHeaders: "Content-Type",
};
app.use(cors(corsOptions));
app.use(express.json());

const DATA_DIR = path.join(__dirname, "data");

function readJSON(filename) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), "utf8"));
  } catch {
    return {};
  }
}

function writeJSON(filename, data) {
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}

app.use(express.static(path.join(__dirname, "public")));

// --- SIGN IN ---
app.post("/signin", (req, res) => {
  const { firstName, lastName } = req.body;
  if (!firstName || !lastName)
    return res.status(400).json({ error: "First name and last name are required" });

  const teachersData = readJSON("teachers.json");
  const teachers = teachersData.teachers || [];

  const isTeacher = teachers.some(
    (t) =>
      t.firstName.toLowerCase() === firstName.toLowerCase() &&
      t.lastName.toLowerCase() === lastName.toLowerCase()
  );

  const usersData = readJSON("users.json");
  if (!usersData.users) usersData.users = [];

  let user = usersData.users.find(
    (u) =>
      u.firstName.toLowerCase() === firstName.toLowerCase() &&
      u.lastName.toLowerCase() === lastName.toLowerCase()
  );

  if (!user) {
    user = { id: uuidv4(), firstName, lastName, role: isTeacher ? "teacher" : "student" };
    usersData.users.push(user);
    writeJSON("users.json", usersData);
  }

  res.json({ token: user.id, role: user.role });
});

// --- START SESSION ---
app.post("/session/start", (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "Token required" });

  const usersData = readJSON("users.json");
  const teacher = usersData.users.find((u) => u.id === token && u.role === "teacher");

  if (!teacher) return res.status(403).json({ error: "Only teacher can start quiz" });

  const sessionsData = readJSON("sessions.json");
  if (!sessionsData.sessions) sessionsData.sessions = [];

  const startTime = Date.now();
  const endTime = startTime + 60 * 60 * 1000; // 1 hour

  sessionsData.sessions.push({ startTime, endTime });
  writeJSON("sessions.json", sessionsData);

  res.json({ message: "Quiz started", startTime, endTime });
});

// --- CHECK SESSION STATUS ---
app.get("/session/status", (req, res) => {
  const sessionsData = readJSON("sessions.json");
  if (!sessionsData.sessions || sessionsData.sessions.length === 0) {
    return res.json({ testStarted: false, remainingTimeMs: 0 });
  }

  const latestSession = sessionsData.sessions[sessionsData.sessions.length - 1];
  const now = Date.now();

  if (now >= latestSession.startTime && now <= latestSession.endTime) {
    return res.json({ testStarted: true, remainingTimeMs: latestSession.endTime - now });
  }

  return res.json({ testStarted: false, remainingTimeMs: 0 });
});

// --- GET QUESTIONS ---
app.get("/questions", (req, res) => {
  const sessionsData = readJSON("sessions.json");
  if (!sessionsData.sessions || sessionsData.sessions.length === 0)
    return res.status(403).json({ error: "Quiz has not started yet" });

  const latestSession = sessionsData.sessions[sessionsData.sessions.length - 1];
  const now = Date.now();

  if (now > latestSession.endTime) return res.status(403).json({ error: "Quiz ended" });
  if (now < latestSession.startTime) return res.status(403).json({ error: "Quiz has not started yet" });

  const questionsData = readJSON("questions.json");
  const questions = questionsData["questions"] || [];

  const questionsToSend = questions.map(({ correctAnswer, ...rest }) => rest);
  res.json({ remainingTimeMs: latestSession.endTime - now, questions: questionsToSend });
});

// --- SUBMIT ANSWERS ---
app.post("/submit", (req, res) => {
  const { token, answers } = req.body;
  if (!token || !answers) return res.status(400).json({ error: "Token and answers required" });

  const usersData = readJSON("users.json");
  const user = usersData.users?.find((u) => u.id === token && u.role === "student");
  if (!user) return res.status(403).json({ error: "Invalid student token." });

  const submissionsData = readJSON("submissions.json");
  if (!submissionsData.submissions) submissionsData.submissions = [];

  const alreadySubmitted = submissionsData.submissions.find((sub) => sub.token === token);
  if (alreadySubmitted) return res.status(400).json({ error: "You have already submitted your answers." });

  const questionsData = readJSON("questions.json");
  const questions = questionsData.questions || [];

  let score = 0;
  let totalMCQs = 0;

  questions.forEach((q) => {
    if (q.type === "multiple-choice") {
      totalMCQs++;
      if (answers[q.id] && answers[q.id].toLowerCase() === q.correctAnswer.toLowerCase()) {
        score++;
      }
    }
  });

  submissionsData.submissions.push({
    token,
    studentName: `${user.firstName} ${user.lastName}`,
    answers,
    score,
    totalMCQs,
    submittedAt: new Date().toISOString(),
  });

  writeJSON("submissions.json", submissionsData);
  res.json({ message: "Answers submitted successfully!", score, totalMCQs });
});

// --- GET STUDENT RESULTS ---
app.get("/results", (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: "Token required" });

  const usersData = readJSON("users.json");
  const user = usersData.users?.find((u) => u.id === token && u.role === "student");
  if (!user) return res.status(403).json({ error: "Invalid student token." });

  const submissionsData = readJSON("submissions.json");
  const submission = submissionsData.submissions?.find((sub) => sub.token === token);
  if (!submission) return res.status(404).json({ error: "No submission found for this student." });

  const questionsData = readJSON("questions.json");
  const questions = questionsData.questions || [];

  const detailedResults = questions.map((q) => ({
    id: q.id,
    text: q.text,
    choices: q.choices || null,
    correctAnswer: q.correctAnswer || null,
    studentAnswer: submission.answers[q.id] || null,
    type: q.type || "multiple-choice",
  }));

  res.json({
    studentName: submission.studentName,
    submittedAt: submission.submittedAt,
    score: submission.score,
    totalMCQs: submission.totalMCQs,
    results: detailedResults,
  });
});

// --- CHECK IF STUDENT ALREADY SUBMITTED ---
app.get("/submission/check", (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: "Token required" });

  const submissionsData = readJSON("submissions.json");
  const submission = submissionsData.submissions?.find((sub) => sub.token === token);

  res.json({ submitted: !!submission });
});

// --- TEACHER RESULTS ---
app.get("/teacher/results", (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: "Teacher token required" });

  const usersData = readJSON("users.json");
  const teacher = usersData.users?.find((u) => u.id === token && u.role === "teacher");
  if (!teacher) return res.status(403).json({ error: "Invalid teacher token." });

  const submissionsData = readJSON("submissions.json");
  const results = submissionsData.submissions?.map((sub) => ({
    studentName: sub.studentName,
    correctCount: sub.score,
    totalQuestions: sub.totalMCQs,
  })) || [];

  res.json({ results });
});

// --- TEACHER OPEN QUESTIONS ---
app.get("/teacher/open-questions", (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: "Teacher token required" });

  const usersData = readJSON("users.json");
  const teacher = usersData.users?.find((u) => u.id === token && u.role === "teacher");
  if (!teacher) return res.status(403).json({ error: "Invalid teacher token." });

  const submissionsData = readJSON("submissions.json");
  const questionsData = readJSON("questions.json");
  const openQuestions = questionsData.questions?.filter((q) => q.type === "open-ended") || [];

  const response = submissionsData.submissions?.map((sub) => {
    const answers = {};
    openQuestions.forEach((q) => {
      answers[q.text] = sub.answers[q.id] || "No answer";
    });
    return { studentName: sub.studentName, answers };
  }) || [];

  res.json({ openQuestions: response });
});

// --- START SERVER ---
const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on port http://localhost:3000`));