// Firebase configuration placeholder
// Copy the config snippet from Firebase Console → Project settings → "Your apps".
// Paste each value into the matching field below before deploying to Hosting.
export const firebaseConfig = {
  apiKey: "AIzaSyBNXnu2Y0Cfj7TO9wPreRHYIFdgJAHqV6w",
  authDomain: "smartquiz-ae2ba.firebaseapp.com",
  projectId: "smartquiz-ae2ba",
  storageBucket: "smartquiz-ae2ba.appspot.com",
  messagingSenderId: "1053354645556",
  appId: "1:1053354645556:web:0f7decc1d5f9dcedc29261",
  measurementId: "G-X11BQMSF83"
};

// Note: This file only exports the config object. The app and auth
// instances are initialized inside `js/auth.js` to keep responsibilities
// separate and make `auth.js` a single entrypoint for auth logic.

// Helpful dev-time message
console.log("firebase-config.js loaded");
