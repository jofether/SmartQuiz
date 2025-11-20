// dashboard.js — realtime quiz list for the authenticated user
import { firebaseConfig } from './firebase-config.js?v=2025-11-14-a';
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';

const $ = (id) => document.getElementById(id);

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const state = {
  unsubscribe: null
};

const quizContainer = $('quiz-list');
const statusEl = $('quiz-status');

function setStatus(message, variant = 'info') {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = `status-pill status-${variant}`;
}

function formatQuizTitle(rawTitle) {
  if (!rawTitle) return 'Untitled Quiz';
  const trimmed = rawTitle.trim();
  const stripped = trimmed.replace(/^\d+-/, '');
  return stripped || trimmed || 'Untitled Quiz';
}

function renderQuizList(docs) {
  if (!quizContainer) return;
  quizContainer.innerHTML = '';

  if (!docs.length) {
    quizContainer.innerHTML = '<p>No quizzes yet. Upload a PDF to generate one.</p>';
    return;
  }

  const list = document.createElement('div');
  list.className = 'quiz-list-items';

  docs.forEach((docSnap) => {
    const quiz = docSnap.data();
    const title = formatQuizTitle(quiz.title);
    const questionCount = (quiz.questions || []).length;

    const item = document.createElement('article');
    item.className = 'quiz-item';
    item.innerHTML = `
      <div class="quiz-item-summary">
        <strong>${escapeHtml(title)}</strong>
        <p>${questionCount} ${questionCount === 1 ? 'question' : 'questions'}</p>
      </div>
      <div class="quiz-item-actions">
        <a class="button" href="quiz.html?id=${encodeURIComponent(docSnap.id)}" aria-label="Take quiz ${escapeHtml(title)}">Take quiz</a>
      </div>
    `;

    item.tabIndex = 0;
    item.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        const link = item.querySelector('a.button');
        if (link) link.click();
      }
    });

    list.appendChild(item);
  });

  quizContainer.appendChild(list);
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      setStatus('Redirecting…', 'muted');
      window.location.replace('index.html');
      return;
    }

    setStatus('Live updates enabled', 'success');

    if (state.unsubscribe) {
      state.unsubscribe();
      state.unsubscribe = null;
    }

    const quizzesQuery = query(
      collection(db, 'quizzes'),
      where('ownerId', '==', user.uid),
      orderBy('created_at', 'desc')
    );

    state.unsubscribe = onSnapshot(
      quizzesQuery,
      (snapshot) => {
        renderQuizList(snapshot.docs);
      },
      (error) => {
        console.error('Failed to stream quizzes', error);
        setStatus('Listener error', 'error');
        if (quizContainer) {
          quizContainer.innerHTML = '<p>Unable to load quizzes. Check console.</p>';
        }
      }
    );
  });
});
