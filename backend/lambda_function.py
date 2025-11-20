"""SmartQuiz Lambda handler: convert uploaded PDFs into Firestore quizzes.

Pipeline per invocation:
1. Receive S3 ObjectCreated event and download the PDF to /tmp.
2. Perform dual-path text extraction (PyPDF2 + Google Vision OCR).
3. Merge extracted text and call Google Gemini for structured questions.
4. Persist the quiz document to Firestore using Firebase Admin SDK.
"""

from __future__ import annotations

import base64
import json
import logging
import os
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
            "%s client disabled because AWS region is not configured. Set AWS_REGION for full functionality.",
            service_name.upper(),
        )
        client = None

    _BOTO_CLIENTS[service_name] = client
    return client


# ---------------------------------------------------------------------------
# Lambda entrypoint
# ---------------------------------------------------------------------------


def lambda_handler(event, _context):
    """AWS Lambda entrypoint triggered by an S3 ObjectCreated notification."""

    LOGGER.info("Inbound event: %s", json.dumps(event))
    bucket, key = _extract_s3_coordinates(event)
    if not bucket or not key:
        return {"statusCode": 400, "body": json.dumps({"error": "invalid_event"})}

    key = urllib.parse.unquote_plus(key)

    try:
        local_pdf = download_pdf_to_tmp(bucket, key)
    except Exception:
        LOGGER.exception("Unable to download s3://%s/%s", bucket, key)
        return {"statusCode": 500, "body": json.dumps({"error": "download_failed"})}

    # --- 1. Extract Digital Text First ---
    digital_text = extract_digital_text(local_pdf)
    LOGGER.info(f"PyPDF2 extracted {len(digital_text)} characters")

    # --- 2. Conditional OCR (Safety Check) ---
    ocr_text = ""
    # Only risk running OCR if digital text is missing or very short (< 50 chars)
    if len(digital_text) < 50:
        LOGGER.info("Text content is missing or scant. Attempting OCR fallback...")
        try:
            ocr_text = extract_ocr_text_vision(local_pdf)
        except Exception as e:
            # Capture error but DO NOT crash. Allow the function to try Gemini with whatever it has.
            LOGGER.error(f"OCR Warning (Non-fatal): {e}")
    else:
        LOGGER.info("Sufficient digital text found. Skipping OCR to prevent API errors.")

    combined_text = combine_text_streams([digital_text, ocr_text])

    if not combined_text or len(combined_text.strip()) == 0:
        LOGGER.warning("No text extracted from %s", key)
        return {"statusCode": 200, "body": json.dumps({"message": "no_text_extracted"})}

    quiz_title = Path(key).stem[:120] or "SmartQuiz Upload"

    try:
        # --- 3. Call Gemini ---
        questions = call_gemini(combined_text, quiz_title)
    except Exception:
        LOGGER.exception("Gemini call failed for %s", key)
        return {"statusCode": 500, "body": json.dumps({"error": "ai_failed"})}

    try:
        persist_quiz({"title": quiz_title, "questions": questions}, bucket, key)
    except Exception:
        LOGGER.exception("Firestore write failed for %s", key)
        return {"statusCode": 500, "body": json.dumps({"error": "firestore_failed"})}

    return {"statusCode": 200, "body": json.dumps({"message": "processed", "questions": len(questions)})}


# ---------------------------------------------------------------------------
# S3 helpers
# ---------------------------------------------------------------------------


def _extract_s3_coordinates(event: dict) -> Tuple[Optional[str], Optional[str]]:
    """Return (bucket, key) tuple from the S3 event body."""

    try:
        record = event["Records"][0]
        bucket = record["s3"]["bucket"]["name"]
        key = record["s3"]["object"]["key"]
        return bucket, key
    except (KeyError, IndexError, TypeError):
        LOGGER.error("Malformed S3 event: %s", event)
        return None, None


def download_pdf_to_tmp(bucket: str, key: str) -> Path:
    """Download the S3 object into /tmp and return its local path."""

    s3_client = _get_boto_client("s3")
    if s3_client is None:
        raise RuntimeError("S3 client unavailable. Set AWS_REGION before invoking lambda_handler locally.")

    tmp_dir = Path(tempfile.gettempdir())
    tmp_dir.mkdir(parents=True, exist_ok=True)
    local_path = tmp_dir / Path(key).name

    LOGGER.info("Downloading s3://%s/%s", bucket, key)
    s3_client.download_file(bucket, key, str(local_path))
    return local_path


# ---------------------------------------------------------------------------
# Text extraction
# ---------------------------------------------------------------------------


def extract_digital_text(pdf_path: Path) -> str:
    """Fast path: use PyPDF2 for digital/native text."""

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

        combined = "\n".join(pages).strip()
        LOGGER.info("PyPDF2 extracted %d characters", len(combined))
        return combined
    except ImportError as exc:
        LOGGER.error("PyPDF2 missing from deployment: %s", exc)
    except Exception:
        LOGGER.exception("PyPDF2 failed to parse %s", pdf_path)

    return ""


def extract_ocr_text_vision(pdf_path):
    """
    Uses Google Cloud Vision (OCR) to extract text from PDF.
    Requires 'FIREBASE_SERVICE_ACCOUNT' env var containing the JSON key.
    """
    from google.cloud import vision

    print(f"[INFO] Starting Google Cloud Vision OCR for {pdf_path}")
    
    try:
        # --- AUTHENTICATION FIX START ---
        # 1. Get the JSON string from the environment variable
        service_account_info = os.environ.get('FIREBASE_SERVICE_ACCOUNT')
        if not service_account_info:
            print("[ERROR] FIREBASE_SERVICE_ACCOUNT env var is missing.")
            return ""
        
        # 2. Parse the string into a dictionary
        if isinstance(service_account_info, str):
            creds_dict = json.loads(service_account_info)
        else:
            creds_dict = service_account_info

        # 3. Create credentials object
        credentials = service_account.Credentials.from_service_account_info(creds_dict)
        
        # 4. Pass credentials to the client
        vision_client = vision.ImageAnnotatorClient(credentials=credentials)
        # --- AUTHENTICATION FIX END ---

        with open(pdf_path, "rb") as f:
            content = f.read()

        # Construct the request (using PDF/TIFF requires async_batch_annotate_files usually, 
        # but for simple image-based PDFs, we might need to render pages first. 
        # HOWEVER, assuming your current logic works for the file type, we just fix the auth).
        # Note: If you are sending a PDF file directly to 'image' param, it might fail 
        # because Vision expects an image (JPG/PNG) for simple annotation. 
        # But let's fix the Auth first.
        
        image = vision.Image(content=content)
        response = vision_client.text_detection(image=image)

        if response.error.message:
            print(f"[ERROR] Vision API Error: {response.error.message}")
            return ""

        texts = response.text_annotations
        if texts:
            return texts[0].description
        return ""

    except Exception as e:
        print(f"[ERROR] OCR Failed: {e}")
        # Print detailed traceback to logs to see why
        import traceback
        traceback.print_exc()
        return ""


def combine_text_streams(chunks: Iterable[str]) -> str:
    return "\n\n".join(chunk.strip() for chunk in chunks if chunk and chunk.strip()).strip()


# ---------------------------------------------------------------------------
# Generative AI (Google Gemini)
# ---------------------------------------------------------------------------


def call_gemini(source_text: str, quiz_title: str) -> List[dict]:
    """Send the merged text to Gemini and return a list of quiz questions."""

    try:
        import google.generativeai as genai
    except ImportError as exc:
        raise RuntimeError("google-generativeai is not installed (packaging error)") from exc

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY environment variable is required")

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
    questions = _parse_ai_json(text)
    return _ensure_question_count(questions, target_questions, source_text)


def _extract_text_from_response(response) -> str:
    if getattr(response, "text", None):
        return response.text

    candidates = getattr(response, "candidates", [])
    for candidate in candidates:
        parts = candidate.get("content", {}).get("parts") if isinstance(candidate, dict) else getattr(candidate, "content", None)
        if not parts:
            continue
        excerpts = []
        for part in parts:
            part_text = getattr(part, "text", None) or part.get("text") if isinstance(part, dict) else None
            if part_text:
                excerpts.append(part_text)
        if excerpts:
            return "\n".join(excerpts)

    raise ValueError("Gemini response contained no text")


def _parse_ai_json(text: str) -> List[dict]:
    import json as _json
    import re

    try:
        payload = _json.loads(text)
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict):
            for value in payload.values():
                if isinstance(value, list):
                    return value
    except Exception:
        LOGGER.debug("Strict JSON parsing failed; attempting regex extract")

    match = re.search(r"(\[\s*\{[\s\S]*?\}\s*\])", text)
    if match:
        return _json.loads(match.group(1))

    raise ValueError("Gemini output was not a JSON array")


def _ensure_question_count(questions: List[dict], target: int, source_text: str) -> List[dict]:
    sanitized = [q for q in questions if isinstance(q, dict)]
    if len(sanitized) >= target:
        return sanitized[:target]

    deficit = max(target - len(sanitized), 0)
    if deficit:
        LOGGER.warning(
            "Gemini produced %d questions; padding with %d fallback items to reach %d",
            len(sanitized),
            deficit,
            target,
        )
        filler = _fallback_quiz_from_text(source_text, max_questions=deficit)
        sanitized.extend(filler)

    # If fallback still cannot reach target, return whatever we have.
    return sanitized[:target]


# ---------------------------------------------------------------------------
# Firestore persistence
# ---------------------------------------------------------------------------


_FIRESTORE_CLIENT = None


def get_firestore_client():
    """Initialize Firebase Admin once and return the Firestore client."""

    global _FIRESTORE_CLIENT  # noqa: PLW0603 - intentional module cache
    if _FIRESTORE_CLIENT is not None:
        return _FIRESTORE_CLIENT

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError as exc:
        raise RuntimeError("firebase-admin is not installed") from exc

    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if not raw:
        raise RuntimeError("FIREBASE_SERVICE_ACCOUNT environment variable is required")

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        decoded = base64.b64decode(raw).decode("utf-8")
        payload = json.loads(decoded)

    cred = credentials.Certificate(payload)
    if not firebase_admin._apps:  # type: ignore[attr-defined]
        firebase_admin.initialize_app(cred)

    _FIRESTORE_CLIENT = firestore.client()
    return _FIRESTORE_CLIENT


def persist_quiz(quiz: dict, bucket: str, key: str) -> None:
    from firebase_admin import firestore as firebase_firestore

    db = get_firestore_client()
    owner_id = _infer_owner_from_key(key)
    doc = {
        "title": quiz.get("title") or Path(key).stem,
        "questions": quiz.get("questions", []),
        "source": {"bucket": bucket, "key": key},
        "pipeline": "lambda-dual-path",
        "created_at": firebase_firestore.SERVER_TIMESTAMP,
        "ownerId": owner_id,
    }
    db.collection("quizzes").add(doc)
    LOGGER.info("Quiz saved for %s", key)


def _infer_owner_from_key(key: str) -> Optional[str]:
    parts = key.strip("/").split("/")
    if len(parts) >= 2 and parts[0] == "uploads":
        return parts[1]
    return None


# ---------------------------------------------------------------------------
# Local helper (dev utility)
# ---------------------------------------------------------------------------


def generate_quiz_with_ai(source_text: str, quiz_title: str) -> dict:
    """Convenience wrapper for local scripts/tests."""

    try:
        questions = call_gemini(source_text, quiz_title)
    except Exception as exc:  # pragma: no cover - dev safeguard
        LOGGER.warning("Gemini unavailable, returning stub questions: %s", exc)
        questions = _fallback_quiz_from_text(source_text)

    return {"title": quiz_title or "SmartQuiz Draft", "questions": questions}


def _fallback_quiz_from_text(source_text: str, max_questions: int = 3) -> List[dict]:
    import re

    tokens = [re.sub(r"[^A-Za-z0-9]", "", word).lower() for word in source_text.split() if word]
    keywords: List[str] = []
    for token in tokens:
        if len(token) >= 4 and token not in keywords:
            keywords.append(token)

    questions: List[dict] = []
    for idx, keyword in enumerate(keywords[:max_questions]):
        distractors = []
        for filler in keywords[max(idx + 1, 1): idx + 4]:
            if filler != keyword and filler not in distractors:
                distractors.append(filler)
        while len(distractors) < 3:
            distractors.append(f"Option {len(distractors) + 1}")

        choices = (distractors[:3] + [keyword])[:4]

        questions.append(
            {
                "question": f"Which keyword appears in snippet {idx + 1}?",
                "choices": choices,
                "answer": keyword,
                "explanation": f"The term '{keyword}' is present in the document.",
            }
        )

    return questions or [
        {
            "question": "Placeholder question",
            "choices": ["A", "B", "C", "D"],
            "answer": "A",
            "explanation": "Fallback used because no keywords were detected.",
        }
    ]