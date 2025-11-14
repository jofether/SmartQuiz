"""Local runner for the SmartQuiz Lambda pipeline.

This script lets you test the quiz-generation flow without deploying to AWS. It
reuses the helper functions from `lambda_function.py`, but swaps out the S3
input step for a local file on disk. You can point it to either a PDF (PyPDF2
required) or a plain-text/Markdown file.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Optional

from lambda_function import (
    extract_digital_text,
    generate_quiz_with_ai,
)


def load_plain_text(file_path: Path) -> str:
    """Return text content for non-PDF files."""
    if file_path.suffix.lower() == ".pdf":
        return ""

    try:
        return file_path.read_text(encoding="utf-8", errors="ignore")
    except Exception as exc:  # pylint: disable=broad-except
        raise RuntimeError(f"Failed to read {file_path}: {exc}") from exc


class LocalPipelineRunner:
    """Orchestrates the local-only pipeline."""

    def __init__(self, file_path: Path, title: Optional[str] = None) -> None:
        self.file_path = file_path
        self.title = title or file_path.stem

    def run(self) -> dict:
        if not self.file_path.exists():
            raise FileNotFoundError(self.file_path)

        print(f"📄 Loading {self.file_path}")
        digital_text = extract_digital_text(self.file_path)
        fallback_text = load_plain_text(self.file_path)

        combined_text = "\n".join(filter(None, [digital_text, fallback_text])).strip()
        if not combined_text:
            raise RuntimeError("No text content available. Install PyPDF2 or use a plain-text file.")

        print("🤖 Sending combined text to GenAI placeholder…")
        quiz_payload = generate_quiz_with_ai(combined_text, self.title)
        return quiz_payload


def render_quiz(quiz_payload: dict) -> None:
    print(f"\n📝 Quiz Title: {quiz_payload['title']}")
    for idx, question in enumerate(quiz_payload.get("questions", []), start=1):
        print(f"\nQ{idx}. {question['question']}")
        for option in question.get("options", []):
            print(f"  - {option}")
        print(f"Answer: {question['answer']}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Local SmartQuiz runner")
    parser.add_argument("--file", required=True, help="Path to a PDF or text file")
    parser.add_argument("--title", help="Override quiz title")
    parser.add_argument("--write-json", dest="write_json", help="Optional path to save quiz JSON")
    parser.add_argument("--no-print", dest="print_output", action="store_false", help="Skip console rendering")
    parser.set_defaults(print_output=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    runner = LocalPipelineRunner(Path(args.file), args.title)
    quiz_payload = runner.run()

    if args.print_output:
        render_quiz(quiz_payload)

    if args.write_json:
        out_path = Path(args.write_json)
        out_path.write_text(json.dumps(quiz_payload, indent=2), encoding="utf-8")
        print(f"\n💾 Quiz JSON saved to {out_path}")


if __name__ == "__main__":
    main()
