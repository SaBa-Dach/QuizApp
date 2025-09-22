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
  } catch (error) {
    console.error(`Error reading ${filename}:`, error);
    return {};
  }
}

function writeJSON(filename, data) {
  try {
    fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Error writing ${filename}:`, error);
  }
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
  const { token, endTime } = req.body;
  if (!token) return res.status(400).json({ error: "Token required" });
  if (!endTime) return res.status(400).json({ error: "End time required" });

  const usersData = readJSON("users.json");
  const teacher = usersData.users.find((u) => u.id === token && u.role === "teacher");

  if (!teacher) return res.status(403).json({ error: "Only teacher can start quiz" });

  const sessionsData = readJSON("sessions.json");
  if (!sessionsData.sessions) sessionsData.sessions = [];

  const startTime = Date.now();

  sessionsData.sessions.push({ startTime, endTime: parseInt(endTime) });
  writeJSON("sessions.json", sessionsData);

  res.json({ message: "Quiz started", startTime, endTime: parseInt(endTime) });
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

  // Check if the student has already submitted answers
  const alreadySubmitted = submissionsData.submissions.find((sub) => sub.token === token);
  if (alreadySubmitted) return res.status(400).json({ error: "You have already submitted your answers." });

  const questionsData = readJSON("questions.json");
  const questions = questionsData.questions || [];

  let score = 0;
  let totalMCQs = 0;

  // Prepare open-ended answers separately
  const openEndedAnswers = {};

  questions.forEach((q) => {
    if (q.type === "multiple-choice") {
      totalMCQs++;
      if (answers[q.id] && answers[q.id].toLowerCase() === q.correctAnswer.toLowerCase()) {
        score++;
      }
    } else if (q.type === "open-ended") {
      openEndedAnswers[q.id] = answers[q.id] || "No answer";  // Store open-ended answers
    }
  });

  submissionsData.submissions.push({
    token,
    studentName: `${user.firstName} ${user.lastName}`,
    answers,
    openEndedAnswers,  // Add open-ended answers to the submission data
    openAnswerGrades: {}, // Initialize empty grading object
    score,
    totalMCQs,
    submittedAt: new Date().toISOString(),
  });

  writeJSON("submissions.json", submissionsData);
  res.json({ message: "Answers submitted successfully!", score, totalMCQs });
});

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
  try {
    const token = req.query.token;
    if (!token) {
      return res.status(400).json({ error: "Teacher token required" });
    }

    const usersData = readJSON("users.json");
    const teacher = usersData.users?.find((u) => u.id === token && u.role === "teacher");
    if (!teacher) {
      return res.status(403).json({ error: "Invalid teacher token." });
    }

    const submissionsData = readJSON("submissions.json");
    const questionsData = readJSON("questions.json");

    // Ensure questions are loaded and filter only open-ended questions
    const openQuestions = questionsData.questions?.filter((q) => q.type === "open-ended") || [];

    if (openQuestions.length === 0) {
      return res.status(404).json({ error: "No open-ended questions found." });
    }

    // Prepare the result for each student with open-ended answers
    const response = submissionsData.submissions?.map((sub) => {
      const answers = {};
      openQuestions.forEach((q) => {
        // Use openEndedAnswers and q.id for consistency
        const studentAnswer = sub.openEndedAnswers?.[q.id] || "No answer provided";
        answers[q.text] = studentAnswer;
      });
      return { studentName: sub.studentName, answers };
    }) || [];

    res.json({ openQuestions: response });
  } catch (error) {
    console.error("Error in /teacher/open-questions:", error);
    res.status(500).json({ error: "Internal server error while fetching open questions." });
  }
});

// --- MARK OPEN QUESTION ANSWER AS RIGHT OR WRONG ---
app.post("/teacher/mark-open-question", (req, res) => {
  const { token, studentName, questionText, isCorrect } = req.body;
  if (!token || !studentName || !questionText || isCorrect === undefined) {
    return res.status(400).json({ error: "Token, student name, question text, and correctness status are required" });
  }

  const usersData = readJSON("users.json");
  const teacher = usersData.users?.find((u) => u.id === token && u.role === "teacher");
  if (!teacher) return res.status(403).json({ error: "Invalid teacher token." });

  const submissionsData = readJSON("submissions.json");
  const submission = submissionsData.submissions?.find((sub) => sub.studentName === studentName);
  if (!submission) return res.status(404).json({ error: "No submission found for this student." });

  const questionsData = readJSON("questions.json");
  const openQuestions = questionsData.questions?.filter((q) => q.type === "open-ended") || [];

  const question = openQuestions.find(q => q.text === questionText);
  if (!question) return res.status(404).json({ error: "Question not found." });

  // Initialize openAnswerGrades if it doesn't exist
  if (!submission.openAnswerGrades) submission.openAnswerGrades = {};

  // Get the current grade status for this question
  const currentGrade = submission.openAnswerGrades[questionText];
  const newGrade = isCorrect;

  // Calculate score change based on previous and new grade
  let scoreChange = 0;
  
  if (currentGrade === undefined) {
    // First time grading this question
    scoreChange = newGrade ? 1 : 0;
  } else if (currentGrade === true && newGrade === false) {
    // Was correct, now incorrect: -1
    scoreChange = -1;
  } else if (currentGrade === false && newGrade === true) {
    // Was incorrect, now correct: +1
    scoreChange = 1;
  }
  // If currentGrade === newGrade, no change needed (scoreChange = 0)

  // Update the grade and score
  submission.openAnswerGrades[questionText] = newGrade;
  submission.score += scoreChange;

  // Make sure score doesn't go below 0
  if (submission.score < 0) submission.score = 0;

  writeJSON("submissions.json", submissionsData);

  res.json({ 
    message: "Open question marked successfully.", 
    updatedScore: submission.score,
    previousGrade: currentGrade,
    newGrade: newGrade,
    scoreChange: scoreChange
  });
});

// --- START SERVER ---
const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on port http://localhost:3000`));