# SmartQuiz - AI-Powered Quiz Generator

## Overview

SmartQuiz is a cloud-native application that turns user-uploaded PDFs into interactive quizzes. It combines Firebase (BaaS) and AWS (IaaS) with an AI question-generation service to deliver an end-to-end automated assessment platform.

### Capabilities

- Accept digitally-native and scanned PDFs.
- Extract text via dual-path processing (PyPDF2 + Textract OCR).
- Generate structured quiz JSON with a GenAI endpoint.
- Persist results to Firestore for realtime delivery to the frontend.

### Architecture Snapshot

- **Frontend**: Vanilla HTML/CSS/JS hosted on Firebase Hosting.
- **Backend**: AWS Lambda (Python) triggered by S3 uploads.
- **Storage**: AWS S3 for PDFs, Firestore for quizzes.
- **AI Layer**: External GenAI endpoint (e.g., Google Gemini or Bedrock) invoked by Lambda.

For a more detailed diagram and sequence, see `docs/architecture.md`.

## Repository Layout

```text
.
├── backend/
│   ├── lambda_function.py      # Serverless pipeline orchestrator
│   ├── main.py                 # Local runner for the Lambda pipeline
│   ├── dev_server.py           # Flask API that mimics AWS pipeline for the frontend
│   └── requirements.txt        # Python dependencies bundled with Lambda
├── docs/
│   └── architecture.md         # Detailed dataflow and backlog
├── frontend/
│   ├── css/
│   │   └── style.css           # Dashboard styling
│   ├── js/
│   │   ├── app.js              # UI state management & placeholders
│   │   └── firebase-config.js  # Firebase credentials (replace placeholders)
│   └── index.html              # Dashboard layout
├── .gitignore
└── README.md
```

## Quick Start

### 1. Frontend preview

- Update `frontend/js/firebase-config.js` with your Firebase project settings.
- Use the Live Server extension or any static server:

```powershell
cd frontend
npx serve .
```

- Sign in, upload a PDF (mock flow), and observe the dashboard logging.

### 2. Backend development

- Install dependencies locally:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

- Configure environment variables before running the handler locally (see `.env.example` section in `docs/architecture.md`).
- Package the Lambda (e.g., via AWS SAM or Zip) and deploy with IAM permissions for S3, Textract, and Firestore (via service account JSON secret).
- To smoke-test the pipeline without AWS resources, run:

```powershell
python backend/main.py --file docs/sample-notes.txt --title "Local Test"
```

Pass `--write-json quiz.json` to store the generated quiz payload.

### 3. Frontend + dev API loop

1. Start the Flask dev server (provides `/api/quizzes` endpoints that proxy to the Lambda helpers):

```powershell
cd backend
python dev_server.py
```

The server listens on `http://localhost:8000` and keeps quizzes in memory.

1. In a separate terminal, serve the frontend (any static server works):

```powershell
cd frontend
python -m http.server 5500
```

1. Visit `http://localhost:5500`, click **Sign in with Google** (mock), upload a PDF/text file, and the UI will call the dev API, display pipeline logs, and render the generated quiz.

## Data Flow Summary

1. User uploads PDF → stored in S3 bucket (`smartquiz-input-*`).
2. S3 event triggers Lambda → downloads file to `/tmp`.
3. Lambda extracts text (digital + OCR) → sends aggregated text to GenAI endpoint.
4. AI response (quiz JSON) persisted to Firestore under `quizzes/{quizId}`.
5. Frontend listens to Firestore and renders new quiz instantly.

## Current Milestones

- [x] Frontend dashboard scaffolding with mock data.
- [x] Backend Lambda skeleton with modular helpers.
- [x] Documentation outlining architecture & setup.
- [ ] Wire Firebase auth + Firestore listeners.
- [ ] Integrate real S3 upload + signed URLs.
- [ ] Call production GenAI endpoint and store results.

## Next Steps

1. Connect Firebase Auth/Firestore in the frontend (`app.js`).
2. Implement secure upload (pre-signed URL or Firebase Storage proxy) and show pipeline status from Firestore documents.
3. Replace placeholders in `lambda_function.py` with concrete Textract + GenAI logic; ensure Firestore writes succeed via service account credentials.
4. Add automated tests (unit for Lambda, integration for Firestore listener) and CI checks.
