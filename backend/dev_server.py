"""Lightweight Flask server to mimic the SmartQuiz backend during local dev."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Dict, List
from uuid import uuid4

from flask import Flask, jsonify, request
from flask_cors import CORS

from lambda_function import extract_digital_text, generate_quiz_with_ai

app = Flask(__name__)
CORS(app)

QUIZ_DB: List[Dict[str, object]] = []


def _read_text_from_file(path: Path) -> str:
    if path.suffix.lower() == ".pdf":
        return extract_digital_text(path)
    return path.read_text(encoding="utf-8", errors="ignore")


def _build_response_payload(quiz: Dict[str, object]) -> Dict[str, object]:
    quiz.setdefault("id", str(uuid4()))
    quiz.setdefault("questionCount", len(quiz.get("questions", [])))
    return quiz


@app.get("/api/health")
def health():  # pragma: no cover - trivial endpoint
    return {"status": "ok"}


@app.get("/api/quizzes")
def list_quizzes():
    return jsonify(QUIZ_DB)


@app.post("/api/quizzes")
def create_quiz():
    file = request.files.get("file")
    if not file:
        return {"error": "Missing file field"}, 400

    suffix = Path(file.filename or "upload").suffix or ".txt"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        file.save(tmp.name)
        tmp_path = Path(tmp.name)

    try:
        text = _read_text_from_file(tmp_path).strip()
        if not text:
            return {"error": "Unable to extract text from upload"}, 400

        quiz = generate_quiz_with_ai(text, Path(file.filename or "Untitled").stem)
        payload = _build_response_payload(quiz)
        QUIZ_DB.insert(0, payload)
        return jsonify(payload)
    finally:
        tmp_path.unlink(missing_ok=True)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=True)
