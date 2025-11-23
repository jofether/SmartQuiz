// dashboard.js — realtime quiz list for the authenticated user
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
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const state = {
  unsubscribe: null,
};

const quizContainer = $("quiz-list");
const statusEl = $("quiz-status");

function setStatus(message, variant = "info") {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = `status-pill status-${variant}`;
}

function formatQuizTitle(rawTitle) {
  if (!rawTitle) return "Untitled Quiz";
  const trimmed = rawTitle.trim();
  const stripped = trimmed.replace(/^\d+-/, "");
  return stripped || trimmed || "Untitled Quiz";
}

const colorThemes = [
  {
    text: "text-purple-400",
    bg: "bg-purple-400/10",
    border: "border-purple-400/20",
  },
  { text: "text-blue-400", bg: "bg-blue-400/10", border: "border-blue-400/20" },
  {
    text: "text-emerald-400",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/20",
  },
  { text: "text-pink-400", bg: "bg-pink-400/10", border: "border-pink-400/20" },
  {
    text: "text-orange-400",
    bg: "bg-orange-400/10",
    border: "border-orange-400/20",
  },
];

function renderQuizList(docs) {
  if (!quizContainer) return;
  quizContainer.innerHTML = "";

  if (!docs.length) {
    quizContainer.innerHTML = `
      <div class="py-12 border-2 border-dashed border-gray-800 rounded-xl text-center">
        <ion-icon name="file-tray-outline" class="text-4xl text-gray-700 mb-3"></ion-icon>
        <p class="text-gray-500 text-sm">No quizzes yet. Upload a PDF to generate one.</p>
      </div>`;
    return;
  }

  const list = document.createElement("div");
  list.className = "flex flex-col gap-3";

  docs.forEach((docSnap) => {
    const quiz = docSnap.data();
    const title = formatQuizTitle(quiz.title);
    const questionCount = (quiz.questions || []).length;

    // Pick a random theme
    const theme = colorThemes[Math.floor(Math.random() * colorThemes.length)];

    const item = document.createElement("div");

    item.innerHTML = `
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-xl bg-[#0B0C15] border border-gray-800 hover:border-gray-700 transition group">
      
      <div class="flex items-start gap-4">
        <div class="w-10 h-10 rounded-lg ${theme.bg} ${theme.text} ${
      theme.border
    } border grid place-items-center shrink-0">
           <ion-icon name="document-text" class="text-xl"></ion-icon>
        </div>
        
        <div>
          <h3 class="text-white font-medium text-base leading-tight group-hover:${
            theme.text
          } transition">
            ${escapeHtml(title)}
          </h3>
          <div class="flex items-center gap-3 mt-1.5">
            <span class="text-xs text-gray-400 font-medium flex items-center gap-1">
              <ion-icon name="list-outline"></ion-icon> ${questionCount} Questions
            </span>
          </div>
        </div>
      </div>

      <a href="quiz.html?id=${encodeURIComponent(docSnap.id)}" 
         class="w-full md:w-auto px-5 py-2 rounded-lg bg-gray-800 hover:bg-white hover:text-black text-white text-sm font-medium transition-all flex items-center justify-center gap-2 no-underline">
        Take Quiz
        <ion-icon name="arrow-forward"></ion-icon>
      </a>

    </div>
    `;

    list.appendChild(item);
  });

  quizContainer.appendChild(list);
}

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      setStatus("Redirecting…", "muted");
      window.location.replace("index.html");
      return;
    }

    const statusCopy = user.isAnonymous
      ? { message: "Guest mode active — quizzes are stored in Firestore for this session", variant: "info" }
      : { message: "Live updates enabled", variant: "success" };

    setStatus(statusCopy.message, statusCopy.variant);

    if (state.unsubscribe) {
      state.unsubscribe();
      state.unsubscribe = null;
    }

    const quizzesQuery = query(
      collection(db, "quizzes"),
      where("ownerId", "==", user.uid),
      orderBy("created_at", "desc")
    );

    state.unsubscribe = onSnapshot(
      quizzesQuery,
      (snapshot) => {
        renderQuizList(snapshot.docs);
      },
      (error) => {
        console.error("Failed to stream quizzes", error);
        setStatus("Listener error", "error");
        if (quizContainer) {
          quizContainer.innerHTML =
            "<p>Unable to load quizzes. Check console.</p>";
        }
      }
    );
  });
});
