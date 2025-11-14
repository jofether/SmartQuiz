// dashboard.js — listens for quizzes for the current user and renders them
import { firebaseConfig } from './firebase-config.js?v=2025-11-14-a';
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  getDoc
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';

const $ = (id) => document.getElementById(id);

function ensureApp() {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return app;
}

function renderQuizList(docs) {
  const container = $('quiz-list');
  container.innerHTML = '';
  if (!docs.length) {
    container.innerHTML = '<p>No quizzes yet. Upload a PDF to generate one.</p>';
    return;
  }

  const list = document.createElement('div');
  list.className = 'quiz-list-items';

  docs.forEach((d) => {
    const item = document.createElement('div');
    item.className = 'quiz-item';
    const title = d.data().title || 'Untitled Quiz';
    const id = d.id;
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(title)}</strong>
        <p>${(d.data().questions || []).length} questions</p>
      </div>
      <div>
        <a class="button" href="quiz.html?id=${encodeURIComponent(id)}" aria-label="Take quiz ${escapeHtml(title)}">Take quiz</a>
      </div>
    `;
    // Make the whole item keyboard-focusable and support Enter/Space to open the link
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

  container.appendChild(list);
}

// Basic HTML-escape helper
function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', () => {
  const app = ensureApp();
  const auth = getAuth(app);
  const db = getFirestore(app);

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      // protectPage in auth.js will redirect, but be safe here.
      window.location.replace('index.html');
      return;
    }

    // Query quizzes where ownerId == current user uid
    const q = query(
      collection(db, 'quizzes'),
      where('ownerId', '==', user.uid),
      orderBy('created_at', 'desc')
    );

    // Real-time listener
    onSnapshot(q, (snapshot) => {
      renderQuizList(snapshot.docs);
    }, (err) => {
      console.error('Failed to listen to quizzes:', err);
      const container = $('quiz-list');
      container.innerHTML = '<p>Unable to load quizzes (check console).</p>';
    });
  });
});
