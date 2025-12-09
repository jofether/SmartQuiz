"""SmartQuiz Lambda handler: convert uploaded PDFs into Firestore quizzes.

Pipeline per invocation:
1. Entry Point: Checks if trigger is S3 (file upload) or HTTP (Function URL).
2. Download/Save: Gets the PDF from S3 or decodes it from the HTTP body to /tmp.
3. Extract: Performs dual-path text extraction (PyPDF2 + Google Vision OCR).
4. Generate: Calls Google Gemini for structured questions.
5. Persist: Saves the quiz document to Firestore.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from google.oauth2 import service_account
import tempfile
import urllib.parse
from pathlib import Path
from typing import Iterable, List, Optional, Tuple

import boto3
from botocore.exceptions import NoRegionError

LOGGER = logging.getLogger("smartquiz.lambda")
LOGGER.setLevel(logging.INFO)

_BOTO_CLIENTS: dict[str, Optional[object]] = {}


def _get_boto_client(service_name: str):
    """Lazily create boto3 clients."""
    if service_name in _BOTO_CLIENTS:
        return _BOTO_CLIENTS[service_name]

    if service_name != "s3":
        _BOTO_CLIENTS[service_name] = None
        return None

    region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION")
    kwargs = {"region_name": region} if region else {}

    try:
        client = boto3.client(service_name, **kwargs)
    except NoRegionError as exc:
        if os.environ.get("AWS_EXECUTION_ENV"):
            raise RuntimeError(
                f"{service_name} client requires AWS_REGION or AWS_DEFAULT_REGION"
            ) from exc
        LOGGER.warning(
            "%s client disabled because AWS region is not configured.",
            service_name.upper(),
        )
        client = None

    _BOTO_CLIENTS[service_name] = client
    return client


# ---------------------------------------------------------------------------
# Lambda entrypoint
# ---------------------------------------------------------------------------


def lambda_handler(event, _context):
    """Entrypoint handling BOTH S3 Events and HTTP Function URL requests."""

    # 1. Setup paths and CORS headers
    pdf_path = Path(tempfile.gettempdir()) / "uploaded_file.pdf"
    cors_headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'https://smartquiz-ae2ba.web.app',
        'Access-Control-Allow-Methods': 'OPTIONS,POST',
        'Access-Control-Allow-Headers': 'Content-Type'
    }

    # 2. Handle CORS Preflight (OPTIONS method)
    if 'requestContext' in event and event['requestContext'].get('http', {}).get('method') == 'OPTIONS':
        return {'statusCode': 200, 'headers': cors_headers, 'body': ''}

    bucket = "direct-upload"
    key = f"uploads/guests/web-upload-{int(time.time())}.pdf"  # Fallback key for HTTP uploads

    try:
        # --- PATH A: Triggered by S3 Event (Original Pipeline) ---
        if 'Records' in event:
            LOGGER.info("Processing S3 Event Trigger")
            bucket, key = _extract_s3_coordinates(event)
            if not bucket or not key:
                return {"statusCode": 400, "body": json.dumps({"error": "invalid_s3_event"})}
            
            key = urllib.parse.unquote_plus(key)
            try:
                download_pdf_to_tmp(bucket, key, pdf_path)
            except Exception:
                LOGGER.exception("Unable to download s3://%s/%s", bucket, key)
                return {"statusCode": 500, "body": json.dumps({"error": "s3_download_failed"})}

        # --- PATH B: Triggered by Function URL (Website Upload) ---
        elif 'body' in event:
            LOGGER.info("Processing HTTP Function URL Trigger")
            try:
                file_content = event['body']
                if event.get('isBase64Encoded', False):
                    file_content = base64.b64decode(file_content)
                
                with open(pdf_path, 'wb') as f:
                    f.write(file_content)
            except Exception as e:
                LOGGER.exception("Failed to decode HTTP body")
                return {
                    "statusCode": 500, 
                    "headers": cors_headers,
                    "body": json.dumps({"error": f"upload_decode_failed: {str(e)}"})
                }
        else:
            return {
                "statusCode": 400, 
                "headers": cors_headers,
                "body": json.dumps({"error": "Unknown event type. Send 'body' or S3 'Records'."})
            }

        # --- PIPELINE: Extract Text ---
        digital_text = extract_digital_text(pdf_path)
        LOGGER.info(f"PyPDF2 extracted {len(digital_text)} characters")

        ocr_text = ""
        # Conditional OCR if text is missing or too short
        if len(digital_text) < 50:
            LOGGER.info("Text content scant. Attempting OCR fallback...")
            try:
                ocr_text = extract_ocr_text_vision(pdf_path)
            except Exception as e:
                LOGGER.error(f"OCR Warning (Non-fatal): {e}")

        combined_text = combine_text_streams([digital_text, ocr_text])

        if not combined_text or len(combined_text.strip()) == 0:
            return {
                "statusCode": 200, 
                "headers": cors_headers,
                "body": json.dumps({"message": "no_text_extracted", "questions": []})
            }

        # --- PIPELINE: Generate Quiz ---
        quiz_title = Path(key).stem[:120] or "SmartQuiz Upload"
        try:
            questions = call_gemini(combined_text, quiz_title)
        except Exception as e:
            LOGGER.exception("Gemini call failed")
            return {
                "statusCode": 500, 
                "headers": cors_headers,
                "body": json.dumps({"error": f"ai_generation_failed: {str(e)}"})
            }

        # --- PIPELINE: Save to Firestore ---
        try:
            persist_quiz({"title": quiz_title, "questions": questions}, bucket, key)
        except Exception as e:
            LOGGER.exception("Firestore write failed")
            # We don't fail the HTTP request here, as the user still wants their questions
            
        # --- FINAL SUCCESS RESPONSE ---
        return {
            "statusCode": 200,
            "headers": cors_headers,
            "body": json.dumps({
                "message": "processed", 
                "questions": questions,
                "title": quiz_title
            })
        }

    except Exception as e:
        LOGGER.exception("Unhandled Lambda Error")
        return {
            "statusCode": 500, 
            "headers": cors_headers,
            "body": json.dumps({"error": f"internal_server_error: {str(e)}"})
        }


# ---------------------------------------------------------------------------
# S3 helpers
# ---------------------------------------------------------------------------


def _extract_s3_coordinates(event: dict) -> Tuple[Optional[str], Optional[str]]:
    try:
        record = event["Records"][0]
        bucket = record["s3"]["bucket"]["name"]
        key = record["s3"]["object"]["key"]
        return bucket, key
    except (KeyError, IndexError, TypeError):
        return None, None


def download_pdf_to_tmp(bucket: str, key: str, local_path: Path) -> Path:
    s3_client = _get_boto_client("s3")
    if s3_client is None:
        raise RuntimeError("S3 client unavailable.")

    LOGGER.info("Downloading s3://%s/%s", bucket, key)
    s3_client.download_file(bucket, key, str(local_path))
    return local_path


# ---------------------------------------------------------------------------
# Text extraction
# ---------------------------------------------------------------------------


def extract_digital_text(pdf_path: Path) -> str:
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(str(pdf_path))
        pages = []
        for page in reader.pages:
            try:
                text = page.extract_text() or ""
            except Exception:
                text = ""
            if text:
                pages.append(text)
        return "\n".join(pages).strip()
    except Exception:
        LOGGER.exception("PyPDF2 failed to parse %s", pdf_path)
    return ""


def extract_ocr_text_vision(pdf_path):
    from google.cloud import vision
    LOGGER.info(f"Starting Google Cloud Vision OCR for {pdf_path}")

    try:
        service_account_info = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
        if not service_account_info:
            return ""

        if isinstance(service_account_info, str):
            creds_dict = json.loads(service_account_info)
        else:
            creds_dict = service_account_info

        credentials = service_account.Credentials.from_service_account_info(creds_dict)
        vision_client = vision.ImageAnnotatorClient(credentials=credentials)

        with open(pdf_path, "rb") as f:
            content = f.read()

        image = vision.Image(content=content)
        response = vision_client.text_detection(image=image)

        if response.error.message:
            LOGGER.error(f"Vision API Error: {response.error.message}")
            return ""

        texts = response.text_annotations
        if texts:
            return texts[0].description
        return ""

    except Exception as e:
        LOGGER.error(f"OCR Failed: {e}")
        return ""


def combine_text_streams(chunks: Iterable[str]) -> str:
    return "\n\n".join(chunk.strip() for chunk in chunks if chunk and chunk.strip()).strip()


# ---------------------------------------------------------------------------
# Generative AI (Google Gemini)
# ---------------------------------------------------------------------------


def call_gemini(source_text: str, quiz_title: str) -> List[dict]:
    try:
        import google.generativeai as genai
    except ImportError as exc:
        raise RuntimeError("google-generativeai missing") from exc

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY required")

    genai.configure(api_key=api_key)
    model_name = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash-001")
    model = genai.GenerativeModel(model_name)
    target_questions = int(os.environ.get("QUIZ_QUESTION_COUNT", "30"))

    snippet = source_text[:16000]
    prompt = (
        "You are a helpful tutor that turns source text into quizzes.\n"
        "Return ONLY a JSON array (no prose).\n"
        "Each item must contain: question, choices (>=4), answer, explanation.\n"
        f"Create exactly {target_questions} unique questions.\n"
        f"Quiz title: {quiz_title}\n"
        "Source (may be truncated):\n"
        f"{snippet}\n"
    )

    response = model.generate_content(prompt)
    text = _extract_text_from_response(response)
    try:
        questions = _parse_ai_json(text)
    except Exception:
        questions = _fallback_quiz_from_text(source_text, max_questions=target_questions)
    return _ensure_question_count(questions, target_questions, source_text)


def _extract_text_from_response(response) -> str:
    if getattr(response, "text", None):
        return response.text
    candidates = getattr(response, "candidates", [])
    for candidate in candidates:
        parts = candidate.get("content", {}).get("parts") if isinstance(candidate, dict) else getattr(candidate, "content", None)
        if parts:
            return parts[0].text
    raise ValueError("Gemini response contained no text")


def _parse_ai_json(text: str) -> List[dict]:
    import json as _json
    import re
    try:
        payload = _json.loads(text)
        if isinstance(payload, list): return payload
        if isinstance(payload, dict):
            for v in payload.values():
                if isinstance(v, list): return v
    except Exception: pass
    match = re.search(r"(\[\s*\{[\s\S]*?\}\s*\])", text)
    if match: return _json.loads(match.group(1))
    raise ValueError("Invalid JSON output")


def _ensure_question_count(questions: List[dict], target: int, source_text: str) -> List[dict]:
    sanitized = [q for q in questions if isinstance(q, dict)]
    if len(sanitized) >= target:
        return sanitized[:target]
    
    deficit = target - len(sanitized)
    if deficit > 0:
        sanitized.extend(_fallback_quiz_from_text(source_text, max_questions=deficit))
    return sanitized[:target]


# ---------------------------------------------------------------------------
# Firestore persistence
# ---------------------------------------------------------------------------


_FIRESTORE_CLIENT = None


def get_firestore_client():
    global _FIRESTORE_CLIENT
    if _FIRESTORE_CLIENT: return _FIRESTORE_CLIENT

    import firebase_admin
    from firebase_admin import credentials, firestore

    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if not raw: raise RuntimeError("FIREBASE_SERVICE_ACCOUNT required")

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        payload = json.loads(base64.b64decode(raw).decode("utf-8"))

    cred = credentials.Certificate(payload)
    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred)

    _FIRESTORE_CLIENT = firestore.client()
    return _FIRESTORE_CLIENT


def persist_quiz(quiz: dict, bucket: str, key: str) -> None:
    from firebase_admin import firestore as firebase_firestore
    db = get_firestore_client()
    
    # Simple logic for guest identification
    is_guest = "guests" in key or "direct-upload" in bucket
    owner_type = "guest" if is_guest else "unknown"
    
    doc = {
        "title": quiz.get("title"),
        "questions": quiz.get("questions", []),
        "source": {"bucket": bucket, "key": key},
        "pipeline": "lambda-dual-path",
        "created_at": firebase_firestore.SERVER_TIMESTAMP,
        "ownerType": owner_type,
    }
    if is_guest:
        doc["expirationDate"] = datetime.now(timezone.utc) + timedelta(hours=24)

    db.collection("quizzes").add(doc)
    LOGGER.info("Quiz saved to Firestore")


# ---------------------------------------------------------------------------
# Fallback logic
# ---------------------------------------------------------------------------


def _fallback_quiz_from_text(source_text: str, max_questions: int = 3) -> List[dict]:
    import re
    tokens = [re.sub(r"[^A-Za-z0-9]", "", word).lower() for word in source_text.split() if word]
    keywords = list(dict.fromkeys([t for t in tokens if len(t) >= 4]))  # dedup
    
    questions = []
    for idx, keyword in enumerate(keywords[:max_questions]):
        questions.append({
            "question": f"Which term is discussed in section {idx+1}?",
            "choices": [keyword, "Option B", "Option C", "Option D"],
            "answer": keyword,
            "explanation": f"The document mentions {keyword}."
        })
    return questions or [{"question": "Error fallback", "choices": ["A","B","C","D"], "answer": "A", "explanation": "Failed to generate."}]