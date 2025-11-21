// Frontend authentication module (ES module)
// - Initializes Firebase (modular SDK)
// - Handles email/password signup & login
// - Handles Google Sign-In
// - Protects `dashboard.html` and redirects to `index.html` when not authenticated

import { firebaseConfig } from './firebase-config.js?v=2025-11-14-a';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';

// Initialize Firebase app + auth
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Utility: simple selector
const $ = (id) => document.getElementById(id);

async function handleGoogleSignIn() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    console.log('Google sign-in:', result.user);
  } catch (err) {
    console.error(err);
    alert(err.message || 'Google sign-in failed');
  }
}

function toggleHeroButtons(user) {
  const loginBtn = $('login-btn');
  const logoutBtn = $('logout-btn');
  if (user) {
    if (loginBtn) loginBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';
  } else {
    if (loginBtn) loginBtn.style.display = 'inline-flex';
    if (logoutBtn) logoutBtn.style.display = 'none';
  }
}

// Wire up index.html UI (if present)
function setupIndexAuthUI() {
  const signupForm = $('signup-form');
  const loginForm = $('login-form');
  const googleBtn = $('google-signin-btn');
  const heroLoginBtn = $('login-btn');
  const heroLogoutBtn = $('logout-btn');
  const landingCtaBtn = $('landing-signin-btn');

  if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('signup-email').value.trim();
      const password = $('signup-password').value;
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        console.log('Signup successful', cred.user);
      } catch (err) {
        console.error(err);
        alert(err.message || 'Signup failed');
      }
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('login-email').value.trim();
      const password = $('login-password').value;
      try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        console.log('Login successful', cred.user);
      } catch (err) {
        console.error(err);
        alert(err.message || 'Login failed');
      }
    });
  }

  if (googleBtn) {
    googleBtn.addEventListener('click', handleGoogleSignIn);
  }

  if (heroLoginBtn) {
    heroLoginBtn.addEventListener('click', handleGoogleSignIn);
  }

  if (landingCtaBtn) {
    landingCtaBtn.addEventListener('click', handleGoogleSignIn);
  }

  if (heroLogoutBtn) {
    heroLogoutBtn.addEventListener('click', async () => {
      await signOut(auth);
    });
  }
}

// Protect dashboard page: redirect to index if not authenticated
export function protectPage() {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.replace('index.html');
      return;
    }
    const welcome = $('user-welcome');
    const signoutBtn = $('signout-btn');
    if (welcome) {
      welcome.textContent = user.displayName || user.email;
    }
    if (signoutBtn) {
      signoutBtn.style.display = 'inline-flex';
      signoutBtn.onclick = async () => {
        await signOut(auth);
      };
    }
  });
}

// When loaded on index.html, redirect to dashboard if already signed in
function initRedirects() {
  onAuthStateChanged(auth, (user) => {
    const onIndex = /index\.html?$/.test(window.location.pathname) || /\/$/.test(window.location.pathname);
    toggleHeroButtons(user);
    if (user && onIndex) {
      window.location.replace('dashboard.html');
    }
  });
}

// Auto-run appropriate wiring depending on the current page
document.addEventListener('DOMContentLoaded', () => {
  try {
    setupIndexAuthUI();
    initRedirects();

    if (/dashboard\.html$/.test(window.location.pathname)) {
      protectPage();
    }
  } catch (err) {
    console.error('Auth initialization failed', err);
  }
});

// Default export (not required) for potential future imports
export default {
  auth,
  protectPage
};
