# SmartQuiz Architecture & Runbook

## Systems Overview

1. **Client (Firebase Hosting)**
   - Authenticates users via Google Sign-In.
   - Uploads PDFs directly to AWS S3 (via pre-signed URL) or through a Firebase Callable Function.
   - Listens to Firestore `quizzes` collection for live updates.
2. **AWS S3**
   - Bucket `smartquiz-input-{env}` stores raw uploads.
   - Object creation triggers the Lambda pipeline.
3. **AWS Lambda (backend/lambda_function.py)**
   - Downloads the PDF to `/tmp`.
   - Runs dual extraction (PyPDF2 + Textract OCR).
   - Calls a GenAI endpoint to build quiz JSON.
   - Persists quiz metadata + questions into Firestore.
4. **Firestore**
   - Collections: `quizzes`, `attempts`, `uploads` (optional for audit).
   - Security rules ensure only owners read/write their resources.

```text
Client → (Upload) → S3 → (Event) → Lambda → (Textract + GenAI) → Firestore → Client (Realtime)
```

## Environment Variables

| Name | Location | Purpose |
| ---- | -------- | ------- |
| `QUIZ_GENERATION_ENDPOINT` | Lambda | HTTPS endpoint for the GenAI service |
| `QUIZ_GENERATION_API_KEY` | Lambda (AWS Secrets Manager recommended) | Auth token for GenAI |
| `FIRESTORE_PROJECT_ID` | Lambda + frontend | Target Firebase project |
| `GOOGLE_APPLICATION_CREDENTIALS` | Lambda | Path to service-account JSON (bundled / pulled from Secrets Manager) |
| `S3_UPLOAD_BUCKET` | Frontend env + Lambda | Ensures both sides refer to same storage |

Create an `.env.example` locally mirroring these variables for SAM/LocalStack testing.

## Data Contracts

### Quiz Document (Firestore `quizzes/{quizId}`)

```json
{
  "owner": "uid-string",
  "title": "Operating Systems Midterm",
  "source": "s3://smartquiz-input-dev/os.pdf",
  "status": "ready", // processing | ready | failed
  "questions": [
    {
      "question": "Which AWS service stores objects?",
      "options": ["Lambda", "S3", "EC2", "CloudFront"],
      "answer": "S3"
    }
  ],
  "createdAt": 1700000000
}
```

### Upload Document (optional `uploads/{id}`)

```json
{
  "owner": "uid-string",
  "fileName": "chapter1.pdf",
  "s3Key": "uploads/uid/chapter1.pdf",
  "processingState": "textract",
  "log": ["2025-11-14T10:15Z Uploaded", "2025-11-14T10:15Z Lambda triggered"]
}
```

## Testing Strategy

- **Unit Tests**: Mock boto3 + Textract, assert `lambda_handler` builds payloads.
- **Integration**: Use LocalStack for S3/Lambda; Firestore Emulator for persistence.
- **Frontend**: Cypress smoke test covering login mock + upload UI.

## Backlog Snapshot

| Track | Item | Status |
| ----- | ---- | ------ |
| Frontend | Firebase Auth integration | 🟡 In Progress |
| Frontend | Firestore listeners for quizzes | ⏳ Pending |
| Backend | Textract OCR implementation | ⏳ Pending |
| Backend | GenAI HTTP client + retries | ⏳ Pending |
| DevOps | Terraform/CDK deployment pipeline | ⚪ Not Started |

Document owner: **SmartQuiz Team**. Update this file whenever the architecture or environment variables change.
