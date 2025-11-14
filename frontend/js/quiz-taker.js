// quiz-taker.js — fetches a quiz by id and implements a one-question-at-a-time player
import { firebaseConfig } from './firebase-config.js?v=2025-11-14-a';
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';

const $ = (id) => document.getElementById(id);

function ensureApp() {
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function renderQuestion(container, qObj, index, total, onAnswer) {
  // container is the content area inside quiz-container
  container.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'quiz-question';

  const title = document.createElement('h3');
  title.textContent = `Q${index + 1} of ${total}`;
  wrapper.appendChild(title);

  const prompt = document.createElement('p');
  prompt.innerHTML = `<strong>${escapeHtml(qObj.question || qObj.prompt || '')}</strong>`;
  wrapper.appendChild(prompt);

  // Update progress bar (completed = index)
  const progressFill = document.getElementById('progress-fill');
  if (progressFill) {
    const pct = Math.round((index / Math.max(1, total)) * 100);
    progressFill.style.width = `${pct}%`;
    progressFill.setAttribute('aria-valuenow', String(pct));
    progressFill.setAttribute('aria-valuemin', '0');
    progressFill.setAttribute('aria-valuemax', '100');
  }

  const choices = qObj.choices || qObj.options || [];
  const list = document.createElement('div');
  list.className = 'choices';
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', `Question ${index + 1} choices`);

  choices.forEach((c, i) => {
    const id = `choice-${i}`;
    const label = document.createElement('label');
    label.htmlFor = id;
    label.className = 'choice-label';
    label.setAttribute('role', 'radio');
    label.setAttribute('tabindex', '0');
    label.setAttribute('aria-checked', 'false');

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'quiz-choice';
    input.id = id;
    input.value = c;
    input.tabIndex = -1; // keep focus on label for easier keyboard UX

    const span = document.createElement('span');
    span.textContent = c;

    // Click / change handling
    label.addEventListener('click', () => {
      // select this input
      input.checked = true;
      // update selection visuals
      Array.from(list.querySelectorAll('.choice-label')).forEach((el) => el.classList.remove('selected'));
      label.classList.add('selected');
      label.setAttribute('aria-checked', 'true');
      // keep label focused for keyboard users
      label.focus();
    });

    // keyboard support on the label
    label.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        label.click();
      }
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') {
        ev.preventDefault();
        const next = label.nextElementSibling;
        if (next) next.focus();
      }
      if (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') {
        ev.preventDefault();
        const prev = label.previousElementSibling;
        if (prev) prev.focus();
      }
      // number shortcuts: 1..9
      if (/^[1-9]$/.test(ev.key)) {
        const n = Number(ev.key) - 1;
        const target = list.querySelectorAll('.choice-label')[n];
        if (target) {
          target.click();
        }
      }
    });

    label.appendChild(input);
    label.appendChild(span);
    list.appendChild(label);
  });
  wrapper.appendChild(list);

  const actions = document.createElement('div');
  actions.className = 'quiz-actions';
  const btn = document.createElement('button');
  btn.textContent = index + 1 === total ? 'Finish' : 'Next';
  btn.className = 'primary';
  btn.addEventListener('click', () => {
    const selected = list.querySelector('input[name="quiz-choice"]:checked');
    if (!selected) {
      alert('Please select an answer');
      return;
    }
    onAnswer(selected.value);
  });
  actions.appendChild(btn);
  wrapper.appendChild(actions);

  container.appendChild(wrapper);

  // focus the first choice for keyboard users
  const firstLabel = list.querySelector('.choice-label');
  if (firstLabel) firstLabel.focus();

  // If user presses Enter without focusing a specific choice, allow Enter to trigger Next
  container.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      const active = document.activeElement;
      if (active && active.classList && active.classList.contains('choice-label')) {
        // if a choice is focused, simulate click
        active.click();
      } else {
        // otherwise, trigger next
        btn.click();
      }
    }
  });
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', async () => {
  const app = ensureApp();
  const auth = getAuth(app);
  const db = getFirestore(app);

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.replace('index.html');
      return;
    }

    const quizId = getQueryParam('id');
    if (!quizId) {
      $('quiz-content-area').innerHTML = '<p>No quiz id provided in URL.</p>';
      return;
    }

    try {
      const ref = doc(db, 'quizzes', quizId);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        $('quiz-content-area').innerHTML = '<p>Quiz not found.</p>';
        return;
      }

      const quiz = snap.data();
      const questions = quiz.questions || [];
      $('quiz-title').textContent = quiz.title || 'Quiz';

      let index = 0;
      let correct = 0;

  const container = $('quiz-content-area');

      function handleAnswer(selectedValue) {
        const q = questions[index];
        const correctAnswer = q.answer || q.correctAnswer || '';
        if (String(selectedValue).trim() === String(correctAnswer).trim()) {
          correct += 1;
        }
        index += 1;
        if (index >= questions.length) {
          // Show score
          const progressFill = document.getElementById('progress-fill');
          if (progressFill) progressFill.style.width = '100%';
          container.innerHTML = `\n            <div class="quiz-result">\n              <h3>Finished</h3>\n              <p>Your score: <strong>${correct} / ${questions.length}</strong></p>\n              <p><a href=\"dashboard.html\" class=\"button\">Back to dashboard</a></p>\n            </div>`;
        } else {
          renderQuestion(container, questions[index], index, questions.length, handleAnswer);
        }
      }

      if (!questions.length) {
        container.innerHTML = '<p>This quiz has no questions yet.</p>';
        return;
      }

      // Render first question
      renderQuestion(container, questions[index], index, questions.length, handleAnswer);

    } catch (err) {
      console.error(err);
      $('quiz-container').innerHTML = '<p>Failed to load quiz. Check console for details.</p>';
    }
  });
});
