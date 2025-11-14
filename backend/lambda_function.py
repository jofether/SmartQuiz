"""AWS Lambda entry point for SmartQuiz processing pipeline.

The function is triggered by an S3 ObjectCreated event. It orchestrates the
pipeline: download PDF → extract text (digital + OCR) → call GenAI → persist quiz
results to Firebase Firestore.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Dict, List

try:  # Local development might not have boto3 installed.
    import boto3  # type: ignore
except ImportError:  # pragma: no cover
    boto3 = None  # type: ignore

# Third-party libraries (only needed once real implementation starts)
# from PyPDF2 import PdfReader
# import requests
# from google.cloud import firestore

if boto3:
    s3 = boto3.client("s3")
    textract = boto3.client("textract")
else:  # pragma: no cover
    s3 = textract = None

QUIZ_GENERATION_ENDPOINT = os.environ.get("QUIZ_GENERATION_ENDPOINT", "https://genai.example.com/quizzes")
QUIZ_GENERATION_API_KEY = os.environ.get("QUIZ_GENERATION_API_KEY", "demo-key")
FIRESTORE_PROJECT_ID = os.environ.get("FIRESTORE_PROJECT_ID", "smartquiz-demo")


def lambda_handler(event, context):
    if not s3:
        raise RuntimeError("boto3 is required to run this Lambda handler. Add it to your local environment.")

    record = event["Records"][0]
    bucket = record["s3"]["bucket"]["name"]
    key = record["s3"]["object"]["key"]

    print(f"➡️  Processing {bucket}/{key}")

    try:
        local_path = download_from_s3(bucket, key)
        digital_text = extract_digital_text(local_path)
        ocr_text = extract_text_with_textract(bucket, key)
        combined_text = f"{digital_text}\n{ocr_text}".strip()

        if not combined_text:
            raise RuntimeError("No text extracted from PDF")

        quiz_payload = generate_quiz_with_ai(combined_text, Path(key).stem)
        persist_quiz_to_firestore(quiz_payload)

        response_message = f"Successfully generated quiz for {key}"
        print(f"✅ {response_message}")
        return {"statusCode": 200, "body": json.dumps(response_message)}

    except Exception as exc:  # pylint: disable=broad-except
        error_msg = f"Failed to process {key}: {exc}"
        print(f"❌ {error_msg}")
        return {"statusCode": 500, "body": json.dumps(error_msg)}


def download_from_s3(bucket: str, key: str) -> Path:
    """Download the PDF from S3 into /tmp and return the local path."""
    if not s3:
        raise RuntimeError("boto3 client not initialized.")
    tmp_dir = Path(tempfile.gettempdir())
    local_path = tmp_dir / Path(key).name
    s3.download_file(bucket, key, str(local_path))
    print(f"Downloaded object to {local_path}")
    return local_path


def extract_digital_text(pdf_path: Path) -> str:
    """Extract text from digitally-native PDFs using PyPDF2."""
    try:
        from PyPDF2 import PdfReader  # type: ignore  # Imported lazily to keep Lambda cold start fast

        reader = PdfReader(str(pdf_path))
        contents = [page.extract_text() or "" for page in reader.pages]
        text = "\n".join(filter(None, contents)).strip()
        if text:
            print(f"Extracted {len(text)} characters via PyPDF2")
            return text
    except ImportError:
        print("PyPDF2 not installed; returning placeholder text.")
    except Exception as exc:  # pylint: disable=broad-except
        print(f"PyPDF2 extraction failed: {exc}")

    return f"[digital-text placeholder from {pdf_path.name}]"


def extract_text_with_textract(bucket: str, key: str) -> str:
    """Call AWS Textract for OCR on scanned content."""
    if not textract:
        return ""  # Skip OCR in local dev without boto3
    # Placeholder for Textract API invocation.
    # response = textract.start_document_text_detection(...)
    # Poll for job completion, then aggregate blocks.
    return "[ocr-text placeholder]"


def generate_quiz_with_ai(source_text: str, quiz_title: str) -> Dict[str, object]:
    """Send text to a GenAI endpoint and return structured quiz JSON."""
    # Example payload for actual API request:
    # response = requests.post(
    #     QUIZ_GENERATION_ENDPOINT,
    #     headers={"Authorization": f"Bearer {QUIZ_GENERATION_API_KEY}"},
    #     json={"title": quiz_title, "source": source_text}
    # )
    # response.raise_for_status()
    # return response.json()

    sample_questions: List[Dict[str, object]] = [
        {
            "question": "Which AWS service stores objects?",
            "options": ["Lambda", "EC2", "S3", "DynamoDB"],
            "answer": "S3"
        },
        {
            "question": "Which Firebase product stores realtime quiz data?",
            "options": ["Firestore", "Cloud Storage", "Hosting", "Remote Config"],
            "answer": "Firestore"
        },
    ]

    return {"title": quiz_title, "questions": sample_questions}


def persist_quiz_to_firestore(quiz: Dict[str, object]) -> None:
    """Persist quiz data to Firestore (placeholder)."""
    # db = firestore.Client(project=FIRESTORE_PROJECT_ID)
    # doc_ref = db.collection("quizzes").document(quiz["title"])
    # doc_ref.set(quiz)
    print(f"Firestore ({FIRESTORE_PROJECT_ID}) write placeholder: {quiz['title']}")
