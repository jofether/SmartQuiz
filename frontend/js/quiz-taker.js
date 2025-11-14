// quiz-taker.js — sequential quiz player for quiz.html
import { firebaseConfig } from './firebase-config.js?v=2025-11-14-a';
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);

const state = {
  quiz: null,
  questions: [],
  index: 0,
  correct: 0
};

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function updateProgress(currentIndex, total) {
  const fill = $('progress-fill');
  if (!fill) return;
  const pct = total ? Math.round((currentIndex / total) * 100) : 0;
  fill.style.width = `${pct}%`;
  fill.setAttribute('aria-valuenow', String(pct));
}

function renderQuestion() {
  const container = $('quiz-content-area');
  if (!container) return;

  const questions = state.questions;
  const index = state.index;
  const total = questions.length;
  const question = questions[index];

  updateProgress(index, total);

  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'quiz-question';
  wrapper.innerHTML = `
    <header class="quiz-question__header">
      <p class="eyebrow">Question ${index + 1} of ${total}</p>
      <h3>${escapeHtml(question.question || question.prompt || '')}</h3>
    </header>
    <div class="choices" role="radiogroup" aria-label="Choices"></div>
    <div class="quiz-actions"><button class="primary">${index + 1 === total ? 'Finish' : 'Next'}</button></div>
  `;

  const choiceGroup = wrapper.querySelector('.choices');
  const actionBtn = wrapper.querySelector('button');

  const choices = question.choices || question.options || [];
  choices.forEach((choice) => {
    const label = document.createElement('label');
    label.className = 'choice-label';
    label.tabIndex = 0;

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'quiz-choice';
    input.value = choice;
    input.tabIndex = -1;

    const text = document.createElement('span');
    text.textContent = choice;

    label.appendChild(input);
    label.appendChild(text);

    label.addEventListener('click', () => {
      input.checked = true;
      choiceGroup.querySelectorAll('.choice-label').forEach((el) => el.classList.remove('selected'));
      label.classList.add('selected');
      label.focus();
    });

    label.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        label.click();
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        const next = label.nextElementSibling;
        if (next) next.focus();
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const prev = label.previousElementSibling;
        if (prev) prev.focus();
      }
    });

    choiceGroup.appendChild(label);
  });

  actionBtn.addEventListener('click', () => {
    const selected = choiceGroup.querySelector('input[name="quiz-choice"]:checked');
    if (!selected) {
      alert('Please select an answer');
      return;
    }
    handleAnswer(selected.value);
  });

  container.appendChild(wrapper);

  const firstChoice = choiceGroup.querySelector('.choice-label');
  if (firstChoice) firstChoice.focus();
}

function handleAnswer(selectedValue) {
  const currentQuestion = state.questions[state.index];
  const correctAnswer = currentQuestion.answer || currentQuestion.correctAnswer || '';

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
  const container = $('quiz-content-area');
  if (!container) return;

  updateProgress(state.questions.length, state.questions.length);

  const percent = state.questions.length
    ? Math.round((state.correct / state.questions.length) * 100)
    : 0;

  container.innerHTML = `
    <div class="quiz-result">
      <h3>Quiz complete!</h3>
      <p>You answered <strong>${state.correct}</strong> / <strong>${state.questions.length}</strong> correctly.</p>
      <p>Total score: <strong>${percent}%</strong></p>
      <p><a class="button" href="dashboard.html">Back to dashboard</a></p>
    </div>
  `;
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function loadQuiz(quizId) {
  const ref = doc(db, 'quizzes', quizId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error('Quiz not found');
  }

  const quiz = snap.data();
  state.quiz = quiz;
  state.questions = quiz.questions || [];
  state.index = 0;
  state.correct = 0;

  $('quiz-title').textContent = quiz.title || 'Quiz';
  const meta = $('quiz-meta');
  if (meta && typeof quiz.created_at?.toDate === 'function') {
    meta.textContent = `Generated ${quiz.created_at.toDate().toLocaleString()}`;
  }

  if (!state.questions.length) {
    $('quiz-content-area').innerHTML = '<p>This quiz has no questions yet.</p>';
    return;
  }

  renderQuestion();
}

document.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.replace('index.html');
      return;
    }

    const quizId = getQueryParam('id');
    if (!quizId) {
      $('quiz-content-area').innerHTML = '<p>Missing quiz id in the URL.</p>';
      return;
    }

    loadQuiz(quizId).catch((err) => {
      console.error('Failed to load quiz', err);
      $('quiz-content-area').innerHTML = '<p>Unable to load this quiz. Please try again later.</p>';
    });
  });
});
