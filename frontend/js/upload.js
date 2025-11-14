// frontend/scripts/upload.js
// Handles direct-to-S3 uploads using AWS Cognito Identity Pools + Firebase Auth
// Requirements:
//  - AWS SDK for JavaScript v2 loaded globally (see dashboard.html)
//  - Firebase app already initialized by auth.js
//  - Identity Pool configured for unauthenticated identities with S3 PutObject permissions

import { getApp, getApps } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';

const meta = (name) => document.querySelector(`meta[name="smartquiz:${name}"]`);
const metaValue = (name) => meta(name)?.getAttribute('content')?.trim();
const runtimeConfig = {
  region:
    (window.SMARTQUIZ_UPLOAD_CONFIG?.region || '').trim() ||
    (document.body?.dataset.awsRegion || '').trim() ||
    metaValue('aws-region') ||
    '',
  bucket:
    (window.SMARTQUIZ_UPLOAD_CONFIG?.bucket || '').trim() ||
    (document.body?.dataset.s3Bucket || '').trim() ||
    metaValue('s3-bucket') ||
    '',
  identityPoolId:
    (window.SMARTQUIZ_UPLOAD_CONFIG?.identityPoolId || '').trim() ||
    (document.body?.dataset.cognitoIdentityPool || '').trim() ||
    metaValue('cognito-identity-pool') ||
    ''
};

const AWS_REGION = runtimeConfig.region;
const S3_UPLOAD_BUCKET = runtimeConfig.bucket;
const COGNITO_IDENTITY_POOL_ID = runtimeConfig.identityPoolId;

const configWarnings = [];
if (!AWS_REGION) {
  configWarnings.push('Missing AWS region (set window.SMARTQUIZ_UPLOAD_CONFIG.region or <meta name="smartquiz:aws-region">)');
}
if (!S3_UPLOAD_BUCKET) {
  configWarnings.push('Missing S3 bucket name (set window.SMARTQUIZ_UPLOAD_CONFIG.bucket or <meta name="smartquiz:s3-bucket">)');
}
if (!COGNITO_IDENTITY_POOL_ID) {
  configWarnings.push('Missing Cognito Identity Pool ID (set window.SMARTQUIZ_UPLOAD_CONFIG.identityPoolId or <meta name="smartquiz:cognito-identity-pool">)');
}

const awsSdkLoaded = typeof globalThis !== 'undefined' && typeof globalThis.AWS !== 'undefined';
if (!awsSdkLoaded) {
  configWarnings.push('AWS SDK not loaded. Check the <script> tag for https://sdk.amazonaws.com/js/aws-sdk-2.x.x.min.js');
}

const fileInput = document.getElementById('pdf-upload');
const uploadBtn = document.getElementById('s3-upload-btn');
const statusEl = document.getElementById('upload-status');

if (!fileInput || !uploadBtn) {
  console.warn('Upload UI elements not found on this page.');
}

const app = getApps().length ? getApp() : null;
const auth = getAuth(app);
let currentUser = null;

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (user) {
    setStatus(`Signed in as ${user.email || user.uid}. Ready to upload.`);
  } else {
    setStatus('Please stay signed in to upload files.');
  }
});

if (configWarnings.length) {
  uploadBtn?.setAttribute('disabled', 'disabled');
  setStatus(`Upload disabled: ${configWarnings.join(' ')}. See docs/upload-config.md.`, true);
}

function setStatus(message, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.style.color = isError ? 'var(--error, #b3261e)' : 'var(--muted, #5c6b81)';
}

function describeFile(file) {
  if (!file) return 'Awaiting file selection…';
  const sizeMb = file.size ? (file.size / 1024 / 1024).toFixed(2) : null;
  return sizeMb ? `Ready: ${file.name} (${sizeMb} MB)` : `Ready: ${file.name}`;
}

function withAwsCredentials() {
  return new Promise((resolve, reject) => {
    AWS.config.region = AWS_REGION;
    AWS.config.credentials = new AWS.CognitoIdentityCredentials({
      IdentityPoolId: COGNITO_IDENTITY_POOL_ID
    });
    AWS.config.credentials.refresh((err) => {
      if (err) {
        return reject(err);
      }
      resolve();
    });
  });
}

async function uploadToS3(file) {
  if (!currentUser) {
    throw new Error('You must be signed in first.');
  }

  await withAwsCredentials();

  const sanitizedName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const key = `uploads/${currentUser.uid}/${Date.now()}-${sanitizedName}`;

  const upload = new AWS.S3.ManagedUpload({
    params: {
      Bucket: S3_UPLOAD_BUCKET,
      Key: key,
      Body: file,
      ContentType: file.type || 'application/pdf'
    }
  });

  upload.on('httpUploadProgress', (evt) => {
    if (!evt.total) return;
    const pct = Math.round((evt.loaded / evt.total) * 100);
    setStatus(`Uploading… ${pct}%`);
  });

  const result = await upload.promise();
  return result.Key;
}

async function handleUploadClick() {
  if (configWarnings.length) {
    alert(configWarnings.join('\n'));
    return;
  }
  try {
    if (!fileInput?.files?.length) {
      alert('Select a PDF before uploading.');
      return;
    }
    const file = fileInput.files[0];
    if (file.type !== 'application/pdf') {
      const shouldContinue = confirm('The selected file is not flagged as PDF. Continue?');
      if (!shouldContinue) return;
    }

    uploadBtn.disabled = true;
    setStatus('Requesting AWS credentials…');

    const objectKey = await uploadToS3(file);
    setStatus(`Upload complete! Stored at s3://${S3_UPLOAD_BUCKET}/${objectKey}`);
    fileInput.value = '';
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Upload failed. Check console for details.', true);
    alert('Upload failed. See console for details.');
  } finally {
    uploadBtn.disabled = false;
  }
}

if (uploadBtn) {
  uploadBtn.addEventListener('click', handleUploadClick);
}

fileInput?.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  setStatus(describeFile(file));
});
