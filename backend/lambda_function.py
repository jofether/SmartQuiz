"""AWS Lambda entrypoint — Dual-path PDF text extraction.

This Lambda is triggered by S3 ObjectCreated events. For a new PDF it:
  - downloads the PDF from S3 to /tmp,
  - extracts digital (machine-readable) text with PyPDF2,
  - kicks off AWS Textract async text detection for OCR and polls for the result,
  - combines both texts and prints the final combined text to CloudWatch logs.

Notes:
  - For production, prefer Textract asynchronous notifications (SNS/SQS) rather
    than polling inside the same Lambda. Polling here is implemented for demo
    and small PDFs.
  - This function currently only logs the combined text. AI generation and
    Firestore writes will be added in later iterations.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time
from pathlib import Path
from typing import List

import boto3

logger = logging.getLogger("smartquiz.lambda")
logger.setLevel(logging.INFO)

# Boto3 clients
s3 = boto3.client("s3")
textract = boto3.client("textract")


def lambda_handler(event, context):
    """Lambda handler triggered by S3 put events.

    Expects an event with Records[0].s3.bucket.name and Records[0].s3.object.key
    as delivered by the S3 ObjectCreated notification.
    """
    logger.info("Received event: %s", json.dumps(event))

    try:
        record = event["Records"][0]
        bucket = record["s3"]["bucket"]["name"]
        key = record["s3"]["object"]["key"]
    except Exception as exc:
        logger.exception("Invalid event structure")
        return {"statusCode": 400, "body": json.dumps("Invalid event structure")}

    logger.info("Processing s3://%s/%s", bucket, key)

    try:
        local_path = download_from_s3(bucket, key)

        digital_text = extract_digital_text(local_path)
        ocr_text = extract_text_with_textract(bucket, key)

        # Combine and print the final script to logs (the user's request)
        combined = "\n\n".join(filter(None, [digital_text.strip(), ocr_text.strip()]))
        if not combined:
            logger.warning("No text could be extracted from %s", key)
        else:
            logger.info("--- BEGIN COMBINED TEXT for %s ---", key)
            # Print full combined text. Be aware of CloudWatch log size limits.
            logger.info(combined)
            logger.info("--- END COMBINED TEXT for %s (chars=%d) ---", key, len(combined))

            # GENERATIVE AI STEP
            try:
                ai_questions = call_generative_ai(combined, Path(key).stem)
                quiz_doc = {"title": Path(key).stem, "questions": ai_questions}
                persist_quiz_to_firestore(quiz_doc, bucket, key)
                logger.info("AI generated quiz and persisted to Firestore for %s", key)
            except Exception:
                logger.exception("AI generation or Firestore persistence failed for %s", key)
                return {"statusCode": 500, "body": json.dumps({"error": "ai_or_persist_failed", "object": key})}

        return {"statusCode": 200, "body": json.dumps({"message": "Processed", "object": key})}

    except Exception:
        logger.exception("Processing failed for %s/%s", bucket, key)
        return {"statusCode": 500, "body": json.dumps({"error": "processing_failed", "object": key})}


def download_from_s3(bucket: str, key: str) -> Path:
    """Download the S3 object to /tmp and return a Path to the file.

    Lambda has a writable /tmp directory. We place the file there using the
    object's basename.
    """
    local_dir = Path(tempfile.gettempdir())
    local_dir.mkdir(parents=True, exist_ok=True)
    local_path = local_dir / Path(key).name
    logger.info("Downloading s3://%s/%s to %s", bucket, key, local_path)
    s3.download_file(bucket, key, str(local_path))
    logger.info("Download complete")
    return local_path


def extract_digital_text(pdf_path: Path) -> str:
    """Extract machine-readable text from a PDF using PyPDF2.

    Returns an empty string on failure.
    """
    try:
        from PyPDF2 import PdfReader

        reader = PdfReader(str(pdf_path))
        pages: List[str] = []
        for page in reader.pages:
            try:
                page_text = page.extract_text() or ""
            except Exception:
                page_text = ""
            if page_text:
                pages.append(page_text)

        text = "\n".join(pages).strip()
        logger.info("PyPDF2 extracted %d characters", len(text))
        return text
    except ImportError:
        logger.warning("PyPDF2 is not installed in the runtime. Install PyPDF2 in the Lambda layer.")
        return ""
    except Exception:
        logger.exception("PyPDF2 extraction failed")
        return ""


def extract_text_with_textract(bucket: str, key: str, max_wait_seconds: int = 60) -> str:
    """Kick off Textract StartDocumentTextDetection and poll for completion.

    Note: This uses synchronous polling for demo purposes. For production, use
    SNS/SQS notifications (StartDocumentTextDetection -> SNS -> Lambda worker).
    """
    try:
        logger.info("Starting Textract job for s3://%s/%s", bucket, key)
        resp = textract.start_document_text_detection(
            DocumentLocation={"S3Object": {"Bucket": bucket, "Name": key}}
        )
        job_id = resp.get("JobId")
        if not job_id:
            logger.error("Textract did not return a JobId")
            return ""

        # Poll until job completes or we hit the timeout
        start_time = time.time()
        next_token = None
        finished = False
        all_lines: List[str] = []

        while (time.time() - start_time) < max_wait_seconds:
            if next_token:
                status_resp = textract.get_document_text_detection(JobId=job_id, NextToken=next_token)
            else:
                status_resp = textract.get_document_text_detection(JobId=job_id)

            status = status_resp.get("JobStatus")
            logger.info("Textract job %s status: %s", job_id, status)

            if status == "SUCCEEDED":
                finished = True
                # Collect text from Blocks
                blocks = status_resp.get("Blocks", [])
                for b in blocks:
                    if b.get("BlockType") == "LINE" and b.get("Text"):
                        all_lines.append(b.get("Text"))

                # Handle pagination
                next_token = status_resp.get("NextToken")
                while next_token:
                    page = textract.get_document_text_detection(JobId=job_id, NextToken=next_token)
                    blocks = page.get("Blocks", [])
                    for b in blocks:
                        if b.get("BlockType") == "LINE" and b.get("Text"):
                            all_lines.append(b.get("Text"))
                    next_token = page.get("NextToken")
                break

            if status in ("FAILED", "PARTIAL_SUCCESS"):
                logger.warning("Textract job finished with status: %s", status)
                # Try to extract whatever blocks are present
                blocks = status_resp.get("Blocks", [])
                for b in blocks:
                    if b.get("BlockType") == "LINE" and b.get("Text"):
                        all_lines.append(b.get("Text"))
                finished = True
                break

            # Not finished yet — wait and poll again
            time.sleep(2)

        if not finished:
            logger.warning("Textract job did not finish within %s seconds", max_wait_seconds)

        ocr_text = "\n".join(all_lines).strip()
        logger.info("Textract extracted approx %d characters", len(ocr_text))
        return ocr_text


def call_generative_ai(source_text: str, quiz_title: str) -> List[dict]:
    """Call a Generative AI (Google Gemini) to produce a JSON array of questions.

    This function will try the following, in order:
      1. If the `google.generativeai` package is available, use it (recommended).
      2. Otherwise, POST to an external REST endpoint set in GEMINI_API_ENDPOINT
         with Authorization: Bearer GEMINI_API_KEY.

    The function expects the AI to return a JSON array of objects. It will
    validate and return a Python list of dicts on success, or raise ValueError.
    """
    gemini_api_key = os.environ.get("GEMINI_API_KEY")
    gemini_endpoint = os.environ.get("GEMINI_API_ENDPOINT")

    # Compose a strict meta-prompt instructing the model to return pure JSON
    # matching the schema: [{question, choices[], answer, optional explanation}]
    snippet = source_text[:16000]  # keep prompt bounded
    meta_prompt = (
        "You are a helpful assistant that converts source material into a quiz.\n"
        "Return ONLY a single valid JSON array (no prose, no markdown).\n"
        "Each array element must be an object with these keys:\n"
        " - question: string (the question prompt)\n"
        " - choices: array of strings (minimum 2)\n"
        " - answer: string (must exactly match one of the choices)\n"
        " - explanation: optional string (short explanation)\n"
        "Ensure the JSON is parseable by a strict JSON parser. Do not include any extra\n"
        "characters outside the JSON array.\n\n"
        f"Title: {quiz_title}\n\nSource:\n{snippet}\n\n"
        "Produce the output now."
    )

    # Try the official google.generativeai client first (if installed)
    try:
        import google.generativeai as genai  # type: ignore

        # Configure with API key from environment
        if not gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY is required for google.generativeai usage")
        genai.configure(api_key=gemini_api_key)

        logger.info("Calling google.generativeai with configured key")
        # The exact call depends on the client version; use the high-level 'generate_text'
        # if available, otherwise use the generic client.
        if hasattr(genai, "generate_text"):
            resp = genai.generate_text(model=os.environ.get("GEMINI_MODEL", "gemini-pro"),
                                       input=meta_prompt)
            text = getattr(resp, "text", None) or resp["candidates"][0]["content"]
        else:
            # Fallback generic call
            client = genai.Client()
            resp = client.generate_text(model=os.environ.get("GEMINI_MODEL", "gemini-pro"),
                                        prompt=meta_prompt)
            text = resp.text

        logger.info("AI returned %d characters", len(text or ""))
        return _parse_ai_json(text)

    except ImportError:
        logger.info("google.generativeai not installed; falling back to REST endpoint")
    except Exception:
        logger.exception("google.generativeai call failed; attempting REST fallback")

    # Fallback: call an explicit REST endpoint (user must set GEMINI_API_ENDPOINT)
    if not gemini_endpoint or not gemini_api_key:
        raise RuntimeError("No available Generative AI client or endpoint configured (set GEMINI_API_KEY and GEMINI_API_ENDPOINT)")

    try:
        import requests

        headers = {"Authorization": f"Bearer {gemini_api_key}", "Content-Type": "application/json"}
        payload = {"prompt": meta_prompt, "max_tokens": 1500}
        logger.info("POSTing to GEMINI endpoint %s", gemini_endpoint)
        r = requests.post(gemini_endpoint, headers=headers, json=payload, timeout=60)
        r.raise_for_status()
        text = r.text
        logger.info("REST AI returned %d characters", len(text or ""))
        return _parse_ai_json(text)
    except Exception:
        logger.exception("REST call to Generative AI failed")
        raise


def _parse_ai_json(text: str) -> List[dict]:
    """Attempt to recover a JSON array from the model's text and return it as Python list.

    Tries strict json.loads first; if that fails, heuristically extracts the first
    JSON array substring.
    """
    import json
    import re

    # Quick attempt: load entire text
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return data
        # Some models return {"output": [...]} — try to discover the list inside
        if isinstance(data, dict):
            for v in data.values():
                if isinstance(v, list):
                    return v
    except Exception:
        logger.debug("Strict json.loads failed; attempting to extract JSON array substring")

    # Heuristic: find the first balanced JSON array using regex (approximate)
    m = re.search(r"(\[\s*\{[\s\S]*?\}\s*\])", text)
    if m:
        try:
            candidate = m.group(1)
            data = json.loads(candidate)
            if isinstance(data, list):
                return data
        except Exception:
            logger.exception("Heuristic JSON extraction failed")

    raise ValueError("Could not parse AI response into a JSON array of questions")


def init_firestore_from_env():
    """Initialize Firebase Admin SDK from a service account JSON stored in env.

    Expected environment variable: FIREBASE_SERVICE_ACCOUNT containing the
    JSON service account as a string (or base64-encoded JSON). This function
    initializes the firebase_admin app lazily and returns a Firestore client.
    """
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore as fb_firestore
    except Exception:
        logger.exception("firebase_admin is not installed or failed to import")
        raise

    if firebase_admin._apps:
        return fb_firestore.client()

    sa_raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if not sa_raw:
        raise RuntimeError("FIREBASE_SERVICE_ACCOUNT not set in environment")

    # Try to detect base64-encoded payload
    try:
        import base64

        # If it looks like base64 (no whitespace and has typical padding), decode it
        if "\n" not in sa_raw and (len(sa_raw) % 4) == 0:
            try:
                decoded = base64.b64decode(sa_raw).decode("utf-8")
                sa_json = json.loads(decoded)
            except Exception:
                # Not base64 — assume raw JSON string
                sa_json = json.loads(sa_raw)
        else:
            sa_json = json.loads(sa_raw)
    except Exception:
        logger.exception("Failed to parse FIREBASE_SERVICE_ACCOUNT (must be JSON or base64-encoded JSON)")
        raise

    cred = credentials.Certificate(sa_json)
    firebase_admin.initialize_app(cred)
    logger.info("Initialized Firebase Admin SDK")
    return fb_firestore.client()


def persist_quiz_to_firestore(quiz: dict, source_bucket: str, source_key: str) -> None:
    """Persist the quiz JSON to Firestore collection `quizzes`.

    The document will include metadata about the S3 source and a server-side
    timestamp.
    """
    db = init_firestore_from_env()
    doc = {
        "title": quiz.get("title") or Path(source_key).stem,
        "questions": quiz.get("questions") or quiz.get("items") or [],
        "source_s3": {"bucket": source_bucket, "key": source_key},
        "pipeline": "lambda-dual-path",
        "created_at": db.SERVER_TIMESTAMP,
    }
    # Add document with auto-id
    ref = db.collection("quizzes").add(doc)
    logger.info("Wrote quiz to Firestore (doc ref: %s)", ref)
    

