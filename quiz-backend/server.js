const express = require("express");
const cors = require("cors");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const app = express();
const corsOptions = {
  origin: "http://localhost", // Allow the frontend (Teacher.html) to access the API on localhost
  methods: "GET, POST",
  allowedHeaders: "Content-Type",
};
app.use(cors(corsOptions)); // Use this instead of just cors()
app.use(express.json());

const DATA_DIR = path.join(__dirname, "data");

// Function to read data from JSON files
function readJSON(filename) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), "utf8"));
  } catch {
    return {};
  }
}

// Function to write data to JSON files
function writeJSON(filename, data) {
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}

// --- Routes ---

// Serve frontend static files if any (optional)
app.use(express.static(path.join(__dirname, "public")));

// Sign-in route for user login
app.post("/signin", (req, res) => {
  const { firstName, lastName } = req.body;
  if (!firstName || !lastName) return res.status(400).json({ error: "First name and last name are required" });

  const teachersData = readJSON("teachers.json");
  const teachers = teachersData.teachers || [];

  const isTeacher = teachers.some(
    (t) => t.firstName.toLowerCase() === firstName.toLowerCase() && t.lastName.toLowerCase() === lastName.toLowerCase()
  );

  const usersData = readJSON("users.json");
  if (!usersData.users) usersData.users = [];

  let user = usersData.users.find(
    (u) => u.firstName.toLowerCase() === firstName.toLowerCase() && u.lastName.toLowerCase() === lastName.toLowerCase()
  );

  if (!user) {
    user = { id: uuidv4(), firstName, lastName, role: isTeacher ? "teacher" : "student" };
    usersData.users.push(user);
    writeJSON("users.json", usersData);
  }

  res.json({ token: user.id, role: user.role });
});

// Teacher starts the quiz session
app.post("/session/start", (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "Token required" });

  const usersData = readJSON("users.json");
  const users = usersData.users || [];
  const teacher = users.find(u => u.id === token && u.role === "teacher");

  if (!teacher) return res.status(403).json({ error: "Only teacher can start quiz" });

  const sessionsData = readJSON("sessions.json");
  if (!sessionsData.sessions) sessionsData.sessions = [];

  // Start now and end in 1 hour
  const startTime = Date.now();
  const endTime = startTime + 60 * 60 * 1000;

  sessionsData.sessions.push({ startTime, endTime });
  writeJSON("sessions.json", sessionsData);

  res.json({ message: "Quiz started", startTime, endTime });
});

// Get quiz session status for students
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

// Serve quiz questions
app.get("/questions", (req, res) => {
  const sessionsData = readJSON("sessions.json");
  if (!sessionsData.sessions || sessionsData.sessions.length === 0) return res.status(403).json({ error: "Quiz has not started yet" });

  const latestSession = sessionsData.sessions[sessionsData.sessions.length - 1];
  const now = Date.now();

  if (now > latestSession.endTime) return res.status(403).json({ error: "Quiz ended" });
  if (now < latestSession.startTime) return res.status(403).json({ error: "Quiz has not started yet" });

  const questionsData = readJSON("questions.json");
  const questions = questionsData.questions || [];

  // Remove correctAnswer before sending
  const questionsToSend = questions.map(q => {
    const { correctAnswer, ...rest } = q;
    return rest;
  });

  res.json({ remainingTimeMs: latestSession.endTime - now, questions: questionsToSend });
});

// --- Start server ---
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
