# SmartQuiz

AI-assisted quiz generation platform that converts uploaded PDFs into interactive exams. SmartQuiz blends a Firebase-hosted frontend, AWS S3 + Lambda processing pipeline, and Google Gemini question generation to deliver quizzes in real time.

## Architecture Overview

| Layer | Responsibility | Key Tech |
| --- | --- | --- |
| Frontend | Dashboard, auth, uploads, quiz player | Vanilla HTML/CSS/JS, Firebase Hosting, Firebase Auth, Firestore client |
| Storage | Raw documents and quiz records | AWS S3 (PDF uploads), Firestore (`quizzes` collection) |
| Compute | Ingest PDFs, extract text, call AI, persist quizzes | AWS Lambda (`backend/lambda_function.py`) |
| AI Layer | Generate structured questions | Google Gemini (via `google-generativeai`) |

See `docs/architecture.md` for diagrams and sequence details.

## Repository Layout

```text
SmartQuiz/
├── backend/
│   ├── lambda_function.py      # Lambda entrypoint (S3 -> AI -> Firestore)
│   ├── main.py                 # Local runner for AI pipeline
│   ├── dev_server.py           # Lightweight Flask proxy for local frontend testing
│   ├── requirements.txt        # Frozen Lambda dependencies
│   └── layer/                  # Vendored site-packages for deployment layers
├── docs/
│   ├── architecture.md         # System design + backlog
│   ├── upload-config.md        # Cognito/S3 configuration guide
│   └── sample-quiz.json        # Reference quiz payload
├── frontend/
│   ├── dashboard.html          # Authenticated dashboard + upload UI
│   ├── quiz.html               # Quiz player experience
│   ├── css/style.css           # Global styling for dashboard + quiz
│   └── js/
│       ├── auth.js             # Firebase Auth wiring + guard rails
│       ├── dashboard.js        # Firestore listener + quiz list rendering
│       ├── upload.js           # Direct-to-S3 upload logic
│       ├── quiz-taker.js       # Sequential quiz flow on quiz.html
│       └── firebase-config.js  # firebaseConfig stub (replace with real values)
├── firestore.indexes.json      # Composite index required by dashboard query
├── firebase.json               # Hosting configuration
├── package.json                # Frontend tooling helpers
└── README.md
```

## Prerequisites

- Firebase project with Authentication (Google) + Firestore enabled.
- AWS account with:
  - S3 bucket for uploads.
  - Cognito Identity Pool granting `s3:PutObject` to the bucket.
  - Lambda function wired to the S3 bucket via ObjectCreated event.
- Google Gemini API key (`google-generativeai >= 0.8`).
- Node.js 18+ (for local tooling) and Python 3.11+ (for Lambda code).

## Frontend Setup

1. Populate Firebase config:

	 ```javascript
	 // frontend/js/firebase-config.js
	 export const firebaseConfig = {
		apiKey: '...'
		// etc
	 };
	 ```

2. Provide AWS upload metadata in `frontend/dashboard.html` (or via `window.SMARTQUIZ_UPLOAD_CONFIG`):

	```html
	<meta name="smartquiz:aws-region" content="ap-southeast-2">
	<meta name="smartquiz:s3-bucket" content="smartquiz-project-bucket">
	<meta name="smartquiz:cognito-identity-pool" content="region:uuid">
	```

3. Install Firebase CLI and log in:

	```powershell
	npm install -g firebase-tools
	firebase login
	```

4. Serve locally (any static server works):

	```powershell
	cd frontend
	npx serve .
	# or: firebase emulators:start --only hosting
	```

5. Sign in on `dashboard.html`, pick a PDF, and the UI will push directly to S3 using Cognito credentials while listening to Firestore for quiz updates.

## Backend Setup

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Environment variables expected by `lambda_function.py` / `main.py`:

| Variable | Description |
| --- | --- |
| `AWS_REGION` | Region for S3 + Lambda |
| `GEMINI_API_KEY` | Google Generative AI key |
| `GEMINI_MODEL` | (Optional) defaults to `gemini-2.0-flash-001` |
| `QUIZ_QUESTION_COUNT` | (Optional) default 30 |
| `FIREBASE_SERVICE_ACCOUNT` | JSON string/base64 for Firestore access |

### Local pipeline test

```powershell
python main.py --file docs/sample-notes.txt --title "Local Test"
```

Use `--write-json quiz.json` to export the generated payload.

### Flask dev server (optional)

```powershell
python dev_server.py
```

Pairs with a locally served frontend so you can iterate without deploying to AWS.

## Direct S3 Upload Configuration

The dashboard uses `frontend/js/upload.js` to perform browser-based S3 uploads:

1. Configure Cognito Identity Pool with unauthenticated role granting `s3:PutObject` to your bucket path (e.g., `uploads/${identityId}/*`).
2. Add region/bucket/pool ID to the dashboard via meta tags or `window.SMARTQUIZ_UPLOAD_CONFIG`.
3. (Optional) Override at runtime by injecting `window.SMARTQUIZ_UPLOAD_CONFIG` before loading `upload.js`.

Detailed guidance lives in `docs/upload-config.md`.

## Firestore Index Deployment

The dashboard queries `quizzes` with `where('ownerId', '==', uid)` + `orderBy('created_at', 'desc')`. Deploy the provided composite index before testing:

```powershell
firebase deploy --only firestore:indexes
```

Wait for the index to finish building in the Firebase console before refreshing the dashboard.

## Deployment

### Frontend (Firebase Hosting)

```powershell
firebase deploy --only hosting
```

Ensure `firebase.json` maps to the `frontend/` build output (currently static assets checked into repo).

### Backend (AWS Lambda)

1. Package dependencies (if not using the prebuilt `backend/layer` contents).
2. Zip `lambda_function.py` plus any vendored libraries.
3. Update the Lambda function code and confirm the S3 trigger is enabled.
4. Set environment variables (Gemini key, Firestore service account, question count, etc.).

## Useful Docs & Scripts

- `docs/architecture.md` – high-level design, backlog, and deployment notes.
- `docs/upload-config.md` – Cognito + S3 wiring steps.
- `docs/sample-quiz.json` – output contract reference.
- `backend/dev_server.py` – mock API surface for rapid UI iteration.

## Project Status & Next Steps

- ✅ Redesigned dashboard + quiz player with real Firebase Auth + Firestore listeners.
- ✅ Direct-to-S3 uploads with progress + confirmation states.
- ✅ Lambda pipeline extracts text, calls Gemini, persists quizzes.
- 🔜 Harden Lambda error handling, add integration tests, and automate deployments via CI/CD.

Contributions via pull requests are welcome. Please include screenshots or console logs for UI-facing changes.
