// quiz-taker.js — sequential quiz player for quiz.html
import { firebaseConfig } from "./firebase-config.js?v=2025-11-14-a";
import {
  initializeApp,
  getApps,
  getApp,
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);

const state = {
  quiz: null,
  questions: [],
  index: 0,
  correct: 0,
};

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function updateProgress(currentIndex, total) {
  const fill = $("progress-fill");
  if (!fill) return;
  const pct = total ? Math.round((currentIndex / total) * 100) : 0;
  fill.style.width = `${pct}%`;
  fill.setAttribute("aria-valuenow", String(pct));
}

function formatQuizTitle(rawTitle) {
  if (!rawTitle) return "Quiz";
  const trimmed = rawTitle.trim();
  const withoutPrefix = trimmed.replace(/^\d+-/, "");
  return withoutPrefix || trimmed || "Quiz";
}

function renderQuestion() {
  const container = $("quiz-content-area");
  if (!container) return;

  const questions = state.questions;
  const index = state.index;
  const total = questions.length;
  const question = questions[index];

  updateProgress(index, total);

  container.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.className = "flex flex-col gap-6 animate-fade-in";

  let isAnswered = false;

  wrapper.innerHTML = `
    <div class="mb-2">
      <span class="text-purple-400 text-xs font-bold tracking-wider uppercase">Question ${
        index + 1
      } of ${total}</span>
      <h2 class="text-2xl md:text-3xl font-bold text-white mt-3 leading-tight">
        ${escapeHtml(question.question)}
      </h2>
    </div>

    <div class="choices flex flex-col gap-3" role="radiogroup"></div>

    <div class="mt-4 flex justify-end">
      <button id="main-btn" class="px-8 py-3 bg-white text-black font-bold rounded-lg hover:bg-gray-200 hover:scale-105 active:scale-95 transition-all flex items-center gap-2 shadow-[0_0_20px_rgba(255,255,255,0.1)]">
        Check Answer
      </button>
    </div>
  `;

  const choiceGroup = wrapper.querySelector(".choices");
  const actionBtn = wrapper.querySelector("#main-btn");
  const choices = question.choices || question.options || [];

  // Render Options
  choices.forEach((choice) => {
    const optionEl = document.createElement("label");

    // Default Style
    optionEl.className =
      "group flex items-center gap-4 p-5 rounded-xl border border-gray-800 bg-[#11121E] hover:border-purple-500/50 hover:bg-purple-500/5 cursor-pointer transition-all duration-200 select-none relative overflow-hidden";
    optionEl.tabIndex = 0;

    optionEl.innerHTML = `
      <input type="radio" name="quiz-choice" value="${escapeHtml(
        choice
      )}" class="hidden">
      
      <div class="radio-circle w-6 h-6 rounded-full border-2 border-gray-600 group-hover:border-purple-500 flex items-center justify-center shrink-0 transition-colors">
        <div class="radio-dot w-3 h-3 rounded-full bg-purple-500 opacity-0 transition-opacity"></div>
      </div>
      
      <span class="text-gray-300 font-medium group-hover:text-white transition-colors text-base leading-relaxed">${escapeHtml(
        choice
      )}</span>
    `;

    // Click Logic
    optionEl.addEventListener("change", () => {
      if (isAnswered) return; // Block changes after submission

      choiceGroup.querySelectorAll("label").forEach((el) => {
        el.classList.remove("choice-selected");
      });
      optionEl.classList.add("choice-selected");
    });

    // Keyboard Logic
    optionEl.addEventListener("keydown", (e) => {
      if (isAnswered) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        optionEl.click();
      }
    });

    choiceGroup.appendChild(optionEl);
  });

  // BUTTON LOGIC: Handles both "Check" and "Next"
  actionBtn.addEventListener("click", () => {
    // --- PHASE 1: CHECK ANSWER ---
    if (!isAnswered) {
      const selectedInput = choiceGroup.querySelector(
        'input[name="quiz-choice"]:checked'
      );
      if (!selectedInput) {
        alert("Please select an answer.");
        return;
      }

      isAnswered = true;
      const selectedValue = selectedInput.value;
      const correctAnswer = question.answer;

      if (selectedValue === correctAnswer) {
        state.correct += 1;
      }

      // Loop through all options to apply Red/Green styling
      choiceGroup.querySelectorAll("label").forEach((label) => {
        const input = label.querySelector("input");
        const val = input.value;

        // Disable interaction
        label.style.pointerEvents = "none";

        label.classList.remove("choice-selected");

        // 1. Highlight Correct Answer (Green)
        if (val === correctAnswer) {
          label.classList.remove("border-gray-800", "bg-[#11121E]");
          label.classList.add("border-emerald-500", "bg-emerald-500/10");

          // Force the radio dot to look green
          const dot = label.querySelector(".radio-dot");
          dot.classList.remove("bg-purple-500", "opacity-0");
          dot.classList.add("bg-emerald-500", "opacity-100");

          // Force circle border green
          label
            .querySelector(".radio-circle")
            .classList.remove(
              "border-gray-600",
              "group-hover:border-purple-500"
            );
          label
            .querySelector(".radio-circle")
            .classList.add("border-emerald-500");
        }
        // 2. Highlight Wrong Selection (Red)
        else if (val === selectedValue && val !== correctAnswer) {
          label.classList.remove("border-gray-800", "bg-[#11121E]");
          label.classList.add("border-red-500", "bg-red-500/10");

          const dot = label.querySelector(".radio-dot");
          dot.classList.remove("bg-purple-500", "opacity-0");
          dot.classList.add("bg-red-500", "opacity-100");

          label
            .querySelector(".radio-circle")
            .classList.remove("border-gray-600");
          label.querySelector(".radio-circle").classList.add("border-red-500");
        }
        // 3. Dim others
        else {
          label.classList.add("opacity-40");
        }
      });

      // Change Button to "Next"
      actionBtn.innerHTML =
        index + 1 === total
          ? `Finish Quiz <ion-icon name="checkmark-done"></ion-icon>`
          : `Next Question <ion-icon name="arrow-forward"></ion-icon>`;
      actionBtn.classList.remove("bg-white", "text-black", "hover:bg-gray-200");
      actionBtn.classList.add(
        "bg-purple-600",
        "text-white",
        "hover:bg-purple-700"
      );

      return;
    }

    // --- PHASE 2: GO TO NEXT ---
    if (isAnswered) {
      state.index += 1;
      if (state.index >= state.questions.length) {
        renderResult();
      } else {
        renderQuestion();
      }
    }
  });

  container.appendChild(wrapper);
}

function handleAnswer(selectedValue) {
  const currentQuestion = state.questions[state.index];
  const correctAnswer =
    currentQuestion.answer || currentQuestion.correctAnswer || "";

  if (String(selectedValue).trim() === String(correctAnswer).trim()) {
    state.correct += 1;
  }

  state.index += 1;

  if (state.index >= state.questions.length) {
    renderResult();
  } else {
    renderQuestion();
  }
}

function renderResult() {
  const container = $("quiz-content-area");
  if (!container) return;

  // Max out progress bar
  const progressFill = $("progress-fill");
  if (progressFill) progressFill.style.width = "100%";

  const percent = state.questions.length
    ? Math.round((state.correct / state.questions.length) * 100)
    : 0;

  // Determine Message & Color
  let message = "";
  let colorClass = "text-gray-400";
  let iconName = "trophy";

  if (percent >= 80) {
    message = "Outstanding!";
    colorClass = "text-emerald-400"; // Green
  } else if (percent >= 60) {
    message = "Good job!";
    colorClass = "text-purple-400"; // Purple
  } else {
    message = "Keep practicing.";
    colorClass = "text-orange-400"; // Orange
    iconName = "barbell";
  }

  container.innerHTML = `
    <div class="bg-[#11121E] border border-gray-800 rounded-2xl p-8 md:p-12 text-center animate-fade-in shadow-2xl relative overflow-hidden">
      
      <div class="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-32 bg-purple-500/20 blur-[60px] rounded-full pointer-events-none"></div>

      <div class="relative w-24 h-24 mx-auto bg-[#0B0C15] rounded-full border border-gray-800 flex items-center justify-center mb-6 shadow-lg">
        <ion-icon name="${iconName}" class="text-5xl text-yellow-500"></ion-icon>
      </div>

      <h2 class="text-3xl font-bold text-white mb-2">${message}</h2>
      <p class="text-gray-400 mb-8">You completed the quiz successfully.</p>

      <div class="grid grid-cols-2 gap-4 mb-8 max-w-xs mx-auto">
        <div class="p-4 bg-[#0B0C15] rounded-xl border border-gray-800">
          <p class="text-xs text-gray-500 uppercase tracking-wide font-bold mb-1">Score</p>
          <p class="text-3xl font-bold ${colorClass}">${percent}%</p>
        </div>
        <div class="p-4 bg-[#0B0C15] rounded-xl border border-gray-800">
          <p class="text-xs text-gray-500 uppercase tracking-wide font-bold mb-1">Correct</p>
          <p class="text-3xl font-bold text-white">${state.correct}/${state.questions.length}</p>
        </div>
      </div>

      <a href="dashboard.html" class="inline-flex items-center justify-center px-8 py-3 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition-all w-full md:w-auto shadow-lg shadow-purple-900/20">
        Back to Dashboard
      </a>
    </div>
  `;
}

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function loadQuiz(quizId) {
  const ref = doc(db, "quizzes", quizId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error("Quiz not found");
  }

  const quiz = snap.data();
  state.quiz = quiz;
  state.questions = quiz.questions || [];
  state.index = 0;
  state.correct = 0;

  $("quiz-title").textContent = formatQuizTitle(quiz.title);
  const meta = $("quiz-meta");
  if (meta && typeof quiz.created_at?.toDate === "function") {
    meta.textContent = `Generated ${quiz.created_at.toDate().toLocaleString()}`;
  }

  if (!state.questions.length) {
    $("quiz-content-area").innerHTML = "<p>This quiz has no questions yet.</p>";
    return;
  }

  renderQuestion();
}

document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.replace("index.html");
      return;
    }

    const quizId = getQueryParam("id");
    if (!quizId) {
      $("quiz-content-area").innerHTML = "<p>Missing quiz id in the URL.</p>";
      return;
    }

    loadQuiz(quizId).catch((err) => {
      console.error("Failed to load quiz", err);
      $("quiz-content-area").innerHTML =
        "<p>Unable to load this quiz. Please try again later.</p>";
    });
  });
});
