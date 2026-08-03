import sys
import re
import json
import sqlite3
import argparse
from collections import Counter

# Unicode ranges:
# Greek: 0370-03FF, 1F00-1FFF
# Hebrew: 0590-05FF
# Cyrillic: 0400-04FF
# CJK: 4E00-9FFF
# Arabic: 0600-06FF
# Latin Extended / Accented / Diacritics: 00C0-024F, 1E00-1EFF
ALL_FOREIGN_REGEX = re.compile(r'[\u0370-\u03FF\u1F00-\u1FFF\u0590-\u05FF\u0400-\u04FF\u4E00-\u9FFF\u0600-\u06FF\u00C0-\u024F\u1E00-\u1EFF]+')
GREEK_HEBREW_REGEX = re.compile(r'[\u0370-\u03FF\u1F00-\u1FFF\u0590-\u05FF]+')
# Fantasy / LitRPG capitalized terms / uncommon non-dictionary words (e.g. Xylar, Eldoria, Statblock terms, Khar'Thok)
FANTASY_LITRPG_REGEX = re.compile(r"\b[A-Z][a-z]+(?:'[A-Z][a-z]+)?\b|\b[a-zA-Z]*[0-9]+[a-zA-Z]*\b")
ALL_FOREIGN_TERM_CHARS = r"\u0300-\u036F\u0370-\u03FF\u1F00-\u1FFF\u0590-\u05FF\u0400-\u04FF\u4E00-\u9FFF\u0600-\u06FF\u00C0-\u024F\u1E00-\u1EFF"
GREEK_HEBREW_TERM_CHARS = r"\u0300-\u036F\u0370-\u03FF\u1F00-\u1FFF\u0590-\u05FF"

# Common English stop words for LitRPG / Fantasy filtering
ENGLISH_STOP_WORDS = {
    'The', 'A', 'An', 'And', 'Or', 'But', 'If', 'Then', 'Else', 'When', 'At', 'By', 'For', 'With',
    'About', 'Against', 'Between', 'Into', 'Through', 'During', 'Before', 'After', 'Above', 'Below',
    'To', 'From', 'Up', 'Down', 'In', 'Out', 'On', 'Off', 'Over', 'Under', 'Again', 'Further',
    'He', 'She', 'It', 'They', 'Them', 'His', 'Her', 'Its', 'Their', 'This', 'That', 'These', 'Those',
    'Is', 'Are', 'Was', 'Were', 'Be', 'Been', 'Being', 'Have', 'Has', 'Had', 'Do', 'Does', 'Did',
    'Can', 'Could', 'Will', 'Would', 'Shall', 'Should', 'May', 'Might', 'Must', 'Not', 'No', 'So'
}

STOP_WORDS = {
    'ὁ', 'ἡ', 'τό', 'τοῦ', 'τῆς', 'τῷ', 'τήν', 'τόν', 'οἱ', 'αἱ', 'τά', 'τῶν', 'τοῖς', 'ταῖς', 'τούς', 'τάς',
    'καί', 'δέ', 'τε', 'γάρ', 'ἀλλά', 'μή', 'οὐ', 'οὐκ', 'οὐχ', 'ἐν', 'εἰς', 'ἐκ', 'ἐξ', 'πρός', 'ἀπό', 'διά',
    'μετά', 'κατά', 'περί', 'ὑπέρ', 'ὑπό', 'ἐπί', 'παρά', 'σύν', 'ὦ', 'εἰ', 'ὡς', 'ἄν', 'ὅτι', 'ἵνα',
    'אֵת', 'אֶת', 'וְ', 'הַ', 'בְּ', 'לְ', 'כְּ', 'מִ', 'עַל', 'אֶל', 'כִּי', 'אֲשֶׁר', 'עַד', 'עִם'
}

# Known extraction fragments that are not usable standalone dictionary terms.
# Keep this intentionally narrow; Gemini handles genuine inflected forms using context.
KNOWN_OCR_FRAGMENTS = {'κω'}

def load_pdf_text(pdf_path):
    """Extract text from a PDF file using pypdf or PyMuPDF if available."""
    try:
        import pypdf
        reader = pypdf.PdfReader(pdf_path)
        text = ""
        for page in reader.pages:
            t = page.extract_text()
            if t:
                text += t + "\n"
        if text.strip():
            return text
    except Exception:
        pass

    try:
        import fitz # PyMuPDF
        doc = fitz.open(pdf_path)
        text = ""
        for page in doc:
            text += page.get_text() + "\n"
        return text
    except Exception:
        pass

    raise RuntimeError("Please install pypdf or PyMuPDF (pymupdf) in your Python environment: pip install pypdf")

def fetch_global_pronunciations(sqlite_db_path="drizzle/sqlite.db"):
    """Query the adminSettings table for global pronunciations."""
    try:
        conn = sqlite3.connect(sqlite_db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT valueJson FROM adminSettings WHERE key = 'global_pronunciations'")
        row = cursor.fetchone()
        conn.close()
        if row and row[0]:
            data = json.loads(row[0])
            result = {}
            for k, v in data.items():
                if isinstance(v, list):
                    result[k] = v
                elif isinstance(v, str):
                    result[k] = [v]
            return result
    except Exception as e:
        sys.stderr.write(f"Warning: Could not read global_pronunciations from DB ({e})\n")
    return {}

def scan_pdf_foreign_words(pdf_path, db_path="drizzle/sqlite.db", target_percentile=80.0, mode="all_foreign", query=None, quiet=False):
    if not quiet:
        print(f"Reading PDF text from: {pdf_path} (Mode: {mode}, Target: {target_percentile}%)...")
    full_text = load_pdf_text(pdf_path)

    if mode == "fantasy_litrpg":
        raw_matches = FANTASY_LITRPG_REGEX.findall(full_text)
        cleaned_matches = [m.strip('.,;:!?·\'"()[]{}«»') for m in raw_matches]
        filtered_matches = [m for m in cleaned_matches if len(m) > 2 and m not in ENGLISH_STOP_WORDS]
    elif mode == "greek_hebrew":
        raw_matches = GREEK_HEBREW_REGEX.findall(full_text)
        cleaned_matches = [m.strip('.,;:!?·\'"()[]{}«»') for m in raw_matches]
        filtered_matches = [m for m in cleaned_matches if len(m) > 1 and m not in STOP_WORDS and m not in KNOWN_OCR_FRAGMENTS]
    elif mode == "custom" and query:
        custom_regex = re.compile(re.escape(query), re.IGNORECASE)
        raw_matches = custom_regex.findall(full_text)
        filtered_matches = [m.strip('.,;:!?·\'"()[]{}«»') for m in raw_matches]
    else: # all_foreign (default)
        raw_matches = ALL_FOREIGN_REGEX.findall(full_text)
        cleaned_matches = [m.strip('.,;:!?·\'"()[]{}«»') for m in raw_matches]
        filtered_matches = [m for m in cleaned_matches if len(m) > 1 and m not in STOP_WORDS and m not in KNOWN_OCR_FRAGMENTS]

    if not filtered_matches:
        if not quiet:
            print("No significant matching terms found in the document.")
        return []

    counts = Counter(filtered_matches)
    total_occurrences = sum(counts.values())
    sorted_words = counts.most_common()

    # Calculate cumulative percentage coverage threshold
    target_count = (target_percentile / 100.0) * total_occurrences
    cumulative = 0
    top_words = []

    for word, freq in sorted_words:
        cumulative += freq
        top_words.append((word, freq))
        if cumulative >= target_count:
            break

    if not quiet:
        print(f"\nFound {len(sorted_words)} unique terms ({total_occurrences} total occurrences).")
        print(f"Target {target_percentile:.0f}% cumulative frequency consists of {len(top_words)} unique words.\n")

    global_dict = fetch_global_pronunciations(db_path)

    results = []
    for word, freq in top_words:
        pct = (freq / total_occurrences) * 100
        pronunciations = global_dict.get(word, ["No global pronunciation recorded yet"])
        contexts = []
        if mode == "fantasy_litrpg":
            term_chars = r"A-Za-z0-9'"
        elif mode == "greek_hebrew":
            term_chars = GREEK_HEBREW_TERM_CHARS
        elif mode == "all_foreign":
            term_chars = ALL_FOREIGN_TERM_CHARS
        else:
            term_chars = r"\w"
        complete_term_pattern = re.compile(
            rf"(?<![{term_chars}]){re.escape(word)}(?![{term_chars}])",
            re.IGNORECASE,
        )
        for match in complete_term_pattern.finditer(full_text):
            start = max(
                full_text.rfind(".", 0, match.start()),
                full_text.rfind("!", 0, match.start()),
                full_text.rfind("?", 0, match.start()),
                full_text.rfind("\n", 0, match.start()),
            )
            endings = [
                pos for pos in (
                    full_text.find(".", match.end()),
                    full_text.find("!", match.end()),
                    full_text.find("?", match.end()),
                    full_text.find("\n", match.end()),
                ) if pos >= 0
            ]
            end = min(endings) + 1 if endings else min(len(full_text), match.end() + 180)
            context = full_text[start + 1:end].strip()
            if context and context not in contexts:
                contexts.append(context[:320])
            if len(contexts) >= 2:
                break
        results.append({
            "word": word,
            "count": freq,
            "percentage": round(pct, 2),
            "pronunciations": pronunciations,
            "contexts": contexts,
        })

    return results

def main():
    parser = argparse.ArgumentParser(description="Scan PDF for foreign words / LitRPG terms and output frequencies.")
    parser.add_argument("pdf_path", help="Path to the PDF file")
    parser.add_argument("--db", default="drizzle/sqlite.db", help="Path to SQLite database")
    parser.add_argument("--target", type=float, default=80.0, help="Target percentage threshold (80.0 or 100.0)")
    parser.add_argument("--mode", default="all_foreign", choices=["all_foreign", "fantasy_litrpg", "greek_hebrew", "custom"], help="Scanning mode")
    parser.add_argument("--query", default=None, help="Custom search query term")
    parser.add_argument("--json", action="store_true", help="Output raw JSON format")

    args = parser.parse_args()

    results = scan_pdf_foreign_words(args.pdf_path, args.db, args.target, mode=args.mode, query=args.query, quiet=args.json)

    if args.json:
        print(json.dumps(results, indent=2, ensure_ascii=False))
    else:
        print(f"{'WORD':<20} | {'COUNT':<6} | {'GLOBAL PRONUNCIATION(S)'}")
        print("-" * 65)
        for r in results:
            pron_str = ", ".join(r['pronunciations']) if isinstance(r['pronunciations'], list) else str(r['pronunciations'])
            print(f"{r['word']:<20} | {r['count']:<6} | {pron_str}")

if __name__ == "__main__":
    main()
