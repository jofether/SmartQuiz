// frontend/scripts/upload.js
// Handles direct-to-S3 uploads using AWS Cognito Identity Pools + Firebase Auth
// Requirements:
//  - AWS SDK for JavaScript v2 loaded globally (see dashboard.html)
//  - Firebase app already initialized by auth.js
//  - Identity Pool configured for unauthenticated identities with S3 PutObject permissions

import {
  getApp,
  getApps,
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

const meta = (name) => document.querySelector(`meta[name="smartquiz:${name}"]`);
const metaValue = (name) => meta(name)?.getAttribute("content")?.trim();
const runtimeConfig = {
  region:
    (window.SMARTQUIZ_UPLOAD_CONFIG?.region || "").trim() ||
    (document.body?.dataset.awsRegion || "").trim() ||
    metaValue("aws-region") ||
    "",
  bucket:
    (window.SMARTQUIZ_UPLOAD_CONFIG?.bucket || "").trim() ||
    (document.body?.dataset.s3Bucket || "").trim() ||
    metaValue("s3-bucket") ||
    "",
  identityPoolId:
    (window.SMARTQUIZ_UPLOAD_CONFIG?.identityPoolId || "").trim() ||
    (document.body?.dataset.cognitoIdentityPool || "").trim() ||
    metaValue("cognito-identity-pool") ||
    "",
};

const AWS_REGION = runtimeConfig.region;
const S3_UPLOAD_BUCKET = runtimeConfig.bucket;
const COGNITO_IDENTITY_POOL_ID = runtimeConfig.identityPoolId;

const configWarnings = [];
if (!AWS_REGION) {
  configWarnings.push(
    'Missing AWS region (set window.SMARTQUIZ_UPLOAD_CONFIG.region or <meta name="smartquiz:aws-region">)'
  );
}
if (!S3_UPLOAD_BUCKET) {
  configWarnings.push(
    'Missing S3 bucket name (set window.SMARTQUIZ_UPLOAD_CONFIG.bucket or <meta name="smartquiz:s3-bucket">)'
  );
}
if (!COGNITO_IDENTITY_POOL_ID) {
  configWarnings.push(
    'Missing Cognito Identity Pool ID (set window.SMARTQUIZ_UPLOAD_CONFIG.identityPoolId or <meta name="smartquiz:cognito-identity-pool">)'
  );
}

const awsSdkLoaded =
  typeof globalThis !== "undefined" && typeof globalThis.AWS !== "undefined";
if (!awsSdkLoaded) {
  configWarnings.push(
    "AWS SDK not loaded. Check the <script> tag for https://sdk.amazonaws.com/js/aws-sdk-2.x.x.min.js"
  );
}

const fileInput = document.getElementById("pdf-upload");
const uploadBtn = document.getElementById("s3-upload-btn");
const uploadStatusEl = document.getElementById("upload-status");
const fileNameEl = document.getElementById("file-name");
const fileSizeEl = document.getElementById("file-size");
const fileSelectionChip = document.getElementById("file-selection");
const fileRemoveBtn = document.getElementById("file-remove-btn");
const fileInputWrapper = document.querySelector(".file-input");
const uploadConfirmationEl = document.getElementById("upload-confirmation");

let confirmationTimeoutId = null;

if (!fileInput || !uploadBtn) {
  console.warn("Upload UI elements not found on this page.");
}

const app = getApps().length ? getApp() : null;
const auth = getAuth(app);
let currentUser = null;

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (user) {
    setStatus("");
  } else {
    setStatus("Please stay signed in to upload files.");
    clearFileSelection("", true);
  }
});

if (configWarnings.length) {
  uploadBtn?.setAttribute("disabled", "disabled");
  setStatus(
    `Upload disabled: ${configWarnings.join(" ")}. See docs/upload-config.md.`,
    true
  );
}

function setStatus(message = "", isError = false) {
  if (!uploadStatusEl) return;
  uploadStatusEl.textContent = message;
  uploadStatusEl.style.color = isError ? "#dc2626" : "#64748b";
  uploadStatusEl.classList.toggle("hidden", !message);
}

function setConfirmation(
  message = "",
  { tone = "success", autoHideMs = 0 } = {}
) {
  if (!uploadConfirmationEl) return;
  clearTimeout(confirmationTimeoutId);

  if (!message) {
    uploadConfirmationEl.textContent = "";
    uploadConfirmationEl.classList.remove("is-visible");
    uploadConfirmationEl.removeAttribute("data-variant");
    confirmationTimeoutId = null;
    return;
  }

  const toneColors = {
    success: "#16a34a",
    error: "#dc2626",
    info: "#64748b",
    progress: "#9333ea",
  };

  uploadConfirmationEl.textContent = message;
  uploadConfirmationEl.style.color = toneColors[tone] || toneColors.success;
  uploadConfirmationEl.dataset.variant = tone;
  uploadConfirmationEl.classList.add("is-visible");

  if (autoHideMs > 0) {
    confirmationTimeoutId = setTimeout(() => {
      confirmationTimeoutId = null;
      showConfirmationState(fileInput?.files?.length ? "selected" : "empty");
    }, autoHideMs);
  } else {
    confirmationTimeoutId = null;
  }
}

const confirmationStates = {
  empty: { message: "File Selection Empty", tone: "info" },
  selected: { message: "PDF Selected", tone: "success" },
  uploading: { message: "Quiz Being Generated", tone: "progress" },
};

function showConfirmationState(state = "empty") {
  const config = confirmationStates[state] || confirmationStates.empty;
  setConfirmation(config.message, { tone: config.tone });
}

function setUploadingState(isUploading) {
  if (!uploadBtn) return;
  uploadBtn.classList.toggle("is-uploading", isUploading);
  uploadBtn.setAttribute("aria-busy", String(isUploading));
  if (!configWarnings.length) {
    uploadBtn.disabled = isUploading;
  }
}

function setFileStatus(details = null) {
  if (details) {
    if (fileNameEl) fileNameEl.textContent = details.name;
    if (fileSizeEl)
      fileSizeEl.textContent = details.size ? `(${details.size})` : "";
    fileInputWrapper?.classList.add("has-selection");
    fileSelectionChip?.classList.remove("hidden");
    fileSelectionChip?.classList.add("flex");
    showConfirmationState("selected");
  } else {
    if (fileNameEl) fileNameEl.textContent = "";
    if (fileSizeEl) fileSizeEl.textContent = "";
    fileInputWrapper?.classList.remove("has-selection");
    fileSelectionChip?.classList.add("hidden");
    fileSelectionChip?.classList.remove("flex");
    showConfirmationState("empty");
  }
}

function clearFileSelection(message = "", preserveStatus = false) {
  if (fileInput) {
    fileInput.value = "";
  }
  setFileStatus();
  if (message) {
    setStatus(message);
  } else if (!preserveStatus) {
    setStatus("");
  }
}

function describeFile(file) {
  if (!file) return null;
  const sizeMb = file.size ? (file.size / 1024 / 1024).toFixed(2) : null;
  return {
    name: file.name,
    size: sizeMb ? `${sizeMb} MB` : "",
  };
}

function withAwsCredentials() {
  return new Promise((resolve, reject) => {
    AWS.config.region = AWS_REGION;
    AWS.config.credentials = new AWS.CognitoIdentityCredentials({
      IdentityPoolId: COGNITO_IDENTITY_POOL_ID,
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
    throw new Error("You must be signed in first.");
  }

  await withAwsCredentials();

  const sanitizedName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const prefix = currentUser.isAnonymous
    ? ["uploads", "guests", currentUser.uid]
    : ["uploads", "users", currentUser.uid];
  const key = [...prefix, `${Date.now()}-${sanitizedName}`].join("/");

  const upload = new AWS.S3.ManagedUpload({
    params: {
      Bucket: S3_UPLOAD_BUCKET,
      Key: key,
      Body: file,
      ContentType: file.type || "application/pdf",
    },
  });

  upload.on("httpUploadProgress", (evt) => {
    if (!evt.total) return;
    const pct = Math.round((evt.loaded / evt.total) * 100);
    console.debug("Upload progress", pct);
  });

  const result = await upload.promise();
  return result.Key;
}

async function handleUploadClick() {
  if (configWarnings.length) {
    alert(configWarnings.join("\n"));
    return;
  }
  if (!fileInput?.files?.length) {
    alert("Select a PDF before uploading.");
    setStatus("Select a PDF before uploading.", true);
    return;
  }

  const file = fileInput.files[0];
  if (file.type !== "application/pdf") {
    const shouldContinue = confirm(
      "The selected file is not flagged as PDF. Continue?"
    );
    if (!shouldContinue) return;
  }

  try {
    setUploadingState(true);
    showConfirmationState("uploading");

    const objectKey = await uploadToS3(file);
    console.info("Uploaded to", `s3://${S3_UPLOAD_BUCKET}/${objectKey}`);
    clearFileSelection("", true);
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Upload failed. Check console for details.", true);
    showConfirmationState(fileInput?.files?.length ? "selected" : "empty");
    alert("Upload failed. See console for details.");
  } finally {
    setUploadingState(false);
  }
}

if (uploadBtn) {
  uploadBtn.addEventListener("click", handleUploadClick);
}

fileInput?.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  const details = describeFile(file);
  if (details) {
    setFileStatus(details);
    setStatus("");
  } else {
    clearFileSelection("", true);
  }
});

fileRemoveBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  clearFileSelection("File selection cleared.");
});

showConfirmationState(fileInput?.files?.length ? "selected" : "empty");
