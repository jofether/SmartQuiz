// frontend/scripts/upload.js
// Handles direct-to-S3 uploads using AWS Cognito Identity Pools + Firebase Auth
// Requirements:
//  - AWS SDK for JavaScript v2 loaded globally (see dashboard.html)
//  - Firebase app already initialized by auth.js
//  - Identity Pool configured for unauthenticated identities with S3 PutObject permissions

import { getApp, getApps } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';

// TODO: Replace the placeholders below with your AWS project values
const AWS_REGION = 'Asia Pacific (Sydney) ap-southeast-2'; // e.g., 'ap-southeast-1'
const S3_UPLOAD_BUCKET = 'smartquiz-project-bucket'; // e.g., 'smartquiz-ingest-prod'
const COGNITO_IDENTITY_POOL_ID = 'ap-southeast-2:958eea35-fa60-4753-89e4-5ceda33e9206';

const configWarnings = [];
if (!AWS_REGION || AWS_REGION.toLowerCase().includes('region') || !AWS_REGION.includes('-')) {
  configWarnings.push('Asia Pacific (Sydney) ap-southeast-2');
}
if (!S3_UPLOAD_BUCKET || S3_UPLOAD_BUCKET.includes('smartquiz-project-bucket')) {
  configWarnings.push('smartquiz-project-bucket');
}
if (!COGNITO_IDENTITY_POOL_ID || /X{4}/.test(COGNITO_IDENTITY_POOL_ID)) {
  configWarnings.push('ap-southeast-2:958eea35-fa60-4753-89e4-5ceda33e9206');
}

const awsSdkLoaded = typeof AWS !== 'undefined';
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
  setStatus(`Upload disabled: ${configWarnings.join(' ')}`, true);
}

function setStatus(message, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.style.color = isError ? 'var(--error, #b3261e)' : 'var(--muted, #5c6b81)';
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
