"""AWS Lambda function for dual-path PDF text extraction and quiz generation.

Triggered by S3 ObjectCreated events, the function performs two parallel text
extraction paths on every uploaded PDF:

Path A (digital text)
    1. Download the object from S3 to the Lambda /tmp directory.
    2. Use PyPDF2 to read any embedded machine-readable text.

Path B (OCR text)
    1. Call AWS Textract's StartDocumentTextDetection on the same S3 object.
    2. Poll the job for completion and concatenate the LINE blocks returned.

Finally, both text outputs are combined and printed to CloudWatch Logs.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import tempfile
import time
from pathlib import Path
from typing import List, Optional, Tuple

import boto3

LOGGER = logging.getLogger("smartquiz.lambda")
LOGGER.setLevel(logging.INFO)

S3 = boto3.client("s3")
TEXTRACT = boto3.client("textract")


# ---------------------------------------------------------------------------
# Lambda entrypoint
# ---------------------------------------------------------------------------

def lambda_handler(event, context):
    """AWS Lambda entrypoint invoked by the runtime."""

    LOGGER.info("Received event: %s", json.dumps(event))

    bucket, key = _extract_s3_coordinates(event)
    if not bucket or not key:
        LOGGER.error("Event missing bucket/key; aborting")
        return {"statusCode": 400, "body": json.dumps({"error": "invalid_event"})}

    try:
        local_pdf = download_pdf(bucket, key)
    except Exception:
        LOGGER.exception("Failed to download s3://%s/%s", bucket, key)
        return {"statusCode": 500, "body": json.dumps({"error": "download_failed"})}

    digital_text = extract_digital_text(local_pdf)
    ocr_text = extract_ocr_text(bucket, key)

    combined_text = "\n\n".join(text for text in (digital_text, ocr_text) if text).strip()

    if not combined_text:
        LOGGER.warning("No text extracted from %s; skipping AI step", key)
        return {
            "statusCode": 200,
            "body": json.dumps({"message": "no_text_extracted", "object": key}),
        }

    print("--- COMBINED TEXT BEGIN ---")
    print(combined_text)
    print("--- COMBINED TEXT END ---")

    quiz_title = Path(key).stem[:120]

    try:
        questions = call_generative_ai(combined_text, quiz_title)
    except Exception:
        LOGGER.exception("Generative AI step failed for %s", key)
        return {
            "statusCode": 500,
            "body": json.dumps({"error": "ai_failed", "object": key}),
        }

    try:
        persist_quiz_to_firestore({"title": quiz_title, "questions": questions}, bucket, key)
    except Exception:
        LOGGER.exception("Failed writing quiz to Firestore for %s", key)
        return {
            "statusCode": 500,
            "body": json.dumps({"error": "firestore_failed", "object": key}),
        }

    return {
        "statusCode": 200,
        "body": json.dumps({"message": "processed", "object": key, "questions": len(questions)}),
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_s3_coordinates(event: dict) -> Tuple[Optional[str], Optional[str]]:
    """Safely pull the bucket name and object key from the event body."""

    try:
        record = event["Records"][0]
        bucket = record["s3"]["bucket"]["name"]
        key = record["s3"]["object"]["key"]
        return bucket, key
    except Exception:
        return None, None


def download_pdf(bucket: str, key: str) -> Path:
    """Download the PDF to /tmp and return its local Path."""

    tmp_dir = Path(tempfile.gettempdir())
    tmp_dir.mkdir(parents=True, exist_ok=True)

    local_path = tmp_dir / Path(key).name
    LOGGER.info("Downloading s3://%s/%s to %s", bucket, key, local_path)
    S3.download_file(bucket, key, str(local_path))
    LOGGER.info("Download complete: %s", local_path)
    return local_path


def extract_digital_text(pdf_path: Path) -> str:
    """Path A: Extract any embedded text via PyPDF2."""

    try:
        from PyPDF2 import PdfReader

        reader = PdfReader(str(pdf_path))
        pages: List[str] = []
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
    except ImportError:
        LOGGER.warning("PyPDF2 is not available in this runtime")
    except Exception:
        LOGGER.exception("PyPDF2 failed to read %s", pdf_path)

    return ""


def extract_ocr_text(bucket: str, key: str, max_wait_seconds: int = 60) -> str:
    """Path B: Invoke Textract OCR and collect LINE blocks."""

    try:
        response = TEXTRACT.start_document_text_detection(
            DocumentLocation={"S3Object": {"Bucket": bucket, "Name": key}}
        )
    except Exception:
        LOGGER.exception("Textract start_document_text_detection failed")
        return ""

    job_id = response.get("JobId")
    if not job_id:
        LOGGER.error("Textract did not return a JobId")
        return ""

    lines: List[str] = []
    start_time = time.time()
    next_token = None

    while time.time() - start_time < max_wait_seconds:
        try:
            if next_token:
                job_resp = TEXTRACT.get_document_text_detection(JobId=job_id, NextToken=next_token)
            else:
                job_resp = TEXTRACT.get_document_text_detection(JobId=job_id)
        except Exception:
            LOGGER.exception("Failed to poll Textract job %s", job_id)
            break

        status = job_resp.get("JobStatus")
        LOGGER.info("Textract job %s status: %s", job_id, status)

        if status == "SUCCEEDED":
            _collect_line_blocks(job_resp.get("Blocks", []), lines)
            next_token = job_resp.get("NextToken")
            if not next_token:
                break
            continue

        if status in {"FAILED", "PARTIAL_SUCCESS"}:
            _collect_line_blocks(job_resp.get("Blocks", []), lines)
            break

        time.sleep(2)

    ocr_text = "\n".join(lines).strip()
    LOGGER.info("Textract extracted %d characters", len(ocr_text))
    return ocr_text


def _collect_line_blocks(blocks: List[dict], sink: List[str]) -> None:
    for block in blocks:
        if block.get("BlockType") == "LINE" and block.get("Text"):
            sink.append(block["Text"])


# ---------------------------------------------------------------------------
# Generative AI (Google Gemini)
# ---------------------------------------------------------------------------


def call_generative_ai(source_text: str, quiz_title: str) -> List[dict]:
    """Send the combined text to Google Gemini and return quiz questions."""

    try:
        import google.generativeai as genai
    except ImportError as exc:
        raise RuntimeError("google-generativeai is not installed in the Lambda package") from exc

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY environment variable is required")

    genai.configure(api_key=api_key)

    model_name = os.environ.get("GEMINI_MODEL", "gemini-1.5-pro")
    model = genai.GenerativeModel(model_name)

    snippet = source_text[:16000]
    meta_prompt = (
        "You are a helpful assistant that converts source material into a multiple-choice quiz.\n"
        "Return ONLY a single valid JSON array (no prose, no markdown).\n"
        "Each array element must be an object with these keys:\n"
        " - question: string\n"
        " - choices: array of strings (minimum 2 options)\n"
        " - answer: string (must exactly match one of the choices)\n"
        " - explanation: optional string with a short rationale\n"
        "Ensure the JSON is parseable by a strict JSON parser and do not include extra characters outside the array.\n\n"
        f"Title: {quiz_title}\n\n"
        "Source Material (may be truncated):\n"
        f"{snippet}\n\n"
        "Produce the JSON output now."
    )

    response = model.generate_content(meta_prompt)
    text_output = _extract_text_from_response(response)
    return _parse_ai_json(text_output)


def _extract_text_from_response(response) -> str:
    if hasattr(response, "text") and response.text:
        return response.text

    candidates = getattr(response, "candidates", None) or []
    for candidate in candidates:
        parts = candidate.get("content", {}).get("parts") if isinstance(candidate, dict) else getattr(candidate, "content", None)
        if not parts:
            continue
        texts = []
        for part in parts:
            part_text = getattr(part, "text", None) or part.get("text") if isinstance(part, dict) else None
            if part_text:
                texts.append(part_text)
        if texts:
            return "\n".join(texts)
    raise ValueError("Gemini response did not contain text content")


def _parse_ai_json(text: str) -> List[dict]:
    import json as _json
    import re

    try:
        data = _json.loads(text)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            for value in data.values():
                if isinstance(value, list):
                    return value
    except Exception:
        LOGGER.debug("Strict JSON parse failed; attempting regex extraction")

    match = re.search(r"(\[\s*\{[\s\S]*?\}\s*\])", text)
    if match:
        candidate = match.group(1)
        data = _json.loads(candidate)
        if isinstance(data, list):
            return data

    raise ValueError("Could not parse AI response into a JSON array of questions")


# ---------------------------------------------------------------------------
# Firestore persistence
# ---------------------------------------------------------------------------


def init_firestore_from_env():
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore as fb_firestore
    except ImportError as exc:
        raise RuntimeError("firebase-admin must be bundled with the Lambda") from exc

    if firebase_admin._apps:
        return fb_firestore.client()

    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if not raw:
        raise RuntimeError("FIREBASE_SERVICE_ACCOUNT environment variable is required")

    try:
        payload = _parse_service_account(raw)
    except Exception as exc:
        raise RuntimeError("Failed to parse FIREBASE_SERVICE_ACCOUNT") from exc

    cred = credentials.Certificate(payload)
    firebase_admin.initialize_app(cred)
    return fb_firestore.client()


def _parse_service_account(value: str) -> dict:
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        decoded = base64.b64decode(value).decode("utf-8")
        return json.loads(decoded)


def persist_quiz_to_firestore(quiz: dict, bucket: str, key: str) -> None:
    db = init_firestore_from_env()
    owner_id = _infer_owner_from_key(key)
    doc = {
        "title": quiz.get("title") or Path(key).stem,
        "questions": quiz.get("questions", []),
        "source": {"bucket": bucket, "key": key},
        "pipeline": "lambda-dual-path",
        "created_at": db.SERVER_TIMESTAMP,
        "ownerId": owner_id,
    }
    db.collection("quizzes").add(doc)
    LOGGER.info("Stored quiz for %s in Firestore", key)


def _infer_owner_from_key(key: str) -> Optional[str]:
    """Attempt to recover the Firebase UID from an S3 key like uploads/<uid>/..."""

    parts = key.strip("/").split("/")
    if len(parts) >= 2 and parts[0] == "uploads":
        return parts[1]
    return None


