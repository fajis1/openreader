import sys
import re
import json
import sqlite3
import argparse
import unicodedata
from collections import Counter
from functools import lru_cache

try:
    from wordfreq import zipf_frequency
except ImportError:
    zipf_frequency = None

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
FANTASY_LITRPG_REGEX = re.compile(
    r"\b[A-Za-z]+(?:'[A-Za-z]+)?\b|\b(?:[A-Za-z]+[0-9]+[A-Za-z]*|[0-9]+[A-Za-z]+[A-Za-z0-9]*)\b"
)
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
ENGLISH_STOP_WORDS_CASEFOLD = {word.casefold() for word in ENGLISH_STOP_WORDS}

# Words at or above this frequency are familiar enough that Kokoro normally
# handles them without a book-specific pronunciation.  wordfreq's Zipf scale
# puts ordinary English vocabulary above this line while invented fantasy
# names and compounds generally score zero or very close to it.
STANDARD_ENGLISH_ZIPF_THRESHOLD = 2.5
MAX_FUZZY_GROUP_VARIANTS = 25


@lru_cache(maxsize=None)
def is_fantasy_litrpg_candidate(word):
    """Keep book-specific terms, not ordinary English vocabulary."""
    normalized = word.casefold()
    if len(word) <= 2 or normalized in ENGLISH_STOP_WORDS_CASEFOLD:
        return False
    if any(char.isdigit() for char in word):
        return True
    if zipf_frequency is None:
        raise RuntimeError(
            "Fantasy/LitRPG scanning requires the wordfreq Python package."
        )
    return zipf_frequency(normalized, 'en') < STANDARD_ENGLISH_ZIPF_THRESHOLD


def classify_standard_english_words(words):
    """Return English-frequency evidence for dictionary cleanup previews."""
    if zipf_frequency is None:
        raise RuntimeError(
            "English dictionary cleanup requires the wordfreq Python package."
        )
    results = []
    for word in words:
        if not isinstance(word, str) or not re.fullmatch(r"[A-Za-z]+(?:'[A-Za-z]+)?", word):
            continue
        score = zipf_frequency(word.casefold(), 'en')
        if score >= STANDARD_ENGLISH_ZIPF_THRESHOLD:
            results.append({"word": word, "zipfFrequency": round(score, 3)})
    return results

STOP_WORDS = {
    'ὁ', 'ἡ', 'τό', 'τοῦ', 'τῆς', 'τῷ', 'τήν', 'τόν', 'οἱ', 'αἱ', 'τά', 'τῶν', 'τοῖς', 'ταῖς', 'τούς', 'τάς',
    'καί', 'δέ', 'τε', 'γάρ', 'ἀλλά', 'μή', 'οὐ', 'οὐκ', 'οὐχ', 'ἐν', 'εἰς', 'ἐκ', 'ἐξ', 'πρός', 'ἀπό', 'διά',
    'μετά', 'κατά', 'περί', 'ὑπέρ', 'ὑπό', 'ἐπί', 'παρά', 'σύν', 'ὦ', 'εἰ', 'ὡς', 'ἄν', 'ὅτι', 'ἵνα',
    'אֵת', 'אֶת', 'וְ', 'הַ', 'בְּ', 'לְ', 'כְּ', 'מִ', 'עַל', 'אֶל', 'כִּי', 'אֲשֶׁר', 'עַד', 'עִם'
}
STOP_WORDS_FOLDED = {
    ''.join(
        character for character in unicodedata.normalize('NFD', word.casefold())
        if unicodedata.category(character) != 'Mn'
    )
    for word in STOP_WORDS
}


def normalize_foreign_term_for_fuzzy_match(word):
    """Fold case and accents so inflection/OCR variants group consistently."""
    return ''.join(
        character for character in unicodedata.normalize('NFD', word.casefold())
        if unicodedata.category(character) != 'Mn'
    )

# Known extraction fragments that are not usable standalone dictionary terms.
# Keep this intentionally narrow; Gemini handles genuine inflected forms using context.
KNOWN_OCR_FRAGMENTS = {'κω'}

# Keep enough of a mixed-script extraction artifact for Gemini to decide
# whether a matched Greek/Hebrew segment is a real lexical term.  For example,
# a regex match of ``θεσ`` inside ``vio[θεσ]iα`` is not independently useful,
# but Python must not guess which original word the OCR intended.
OCR_TOKEN_DELIMITERS = re.compile(r'[\s,;:!?"\'“”(){}<>]+')
ASCII_LETTER_REGEX = re.compile(r'[A-Za-z]')
GREEK_OR_HEBREW_REGEX = re.compile(r'[\u0370-\u03FF\u1F00-\u1FFF\u0590-\u05FF]')
GREEK_REGEX = re.compile(r'[\u0370-\u03FF\u1F00-\u1FFF]')
HEBREW_REGEX = re.compile(r'[\u0590-\u05FF]')
GREEK_ELISION_REGEX = re.compile(r"^[\u0370-\u03FF\u1F00-\u1FFF][\u1FBD\u1FBF'’]$")


def get_ocr_suspect_evidence(full_text, start, end):
    """Return the raw token when a foreign-script match is embedded in OCR noise."""
    token_start = start
    while token_start > 0 and not OCR_TOKEN_DELIMITERS.match(full_text[token_start - 1]):
        token_start -= 1
    token_end = end
    while token_end < len(full_text) and not OCR_TOKEN_DELIMITERS.match(full_text[token_end]):
        token_end += 1
    raw_token = full_text[token_start:token_end]
    if (
        ('[' in raw_token or ']' in raw_token)
        and ASCII_LETTER_REGEX.search(raw_token)
        and GREEK_OR_HEBREW_REGEX.search(raw_token)
    ):
        return raw_token[:160]
    return None


def collect_foreign_matches(full_text, regex):
    """Collect matches plus any raw mixed-script OCR evidence around them."""
    matches = []
    for match in regex.finditer(full_text):
        word = match.group(0).strip('.,;:!?··\'"()[]{}«»')
        if not word:
            continue
        matches.append((word, get_ocr_suspect_evidence(full_text, match.start(), match.end())))
    return matches


def classify_automatic_ocr_ignore(word):
    """Identify extraction artifacts that are unsafe to send to the dictionary."""
    if GREEK_ELISION_REGEX.fullmatch(word):
        return "single-letter Greek elision"
    if GREEK_REGEX.search(word) and HEBREW_REGEX.search(word):
        return "adjacent Hebrew and Greek text without a separator"
    if word.endswith('σ'):
        return "Greek OCR fragment ending in non-final sigma"
    return None

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

    ocr_suspect_evidence = {}
    if mode == "fantasy_litrpg":
        raw_matches = FANTASY_LITRPG_REGEX.findall(full_text)
        cleaned_matches = [m.strip('.,;:!?·\'"()[]{}«»') for m in raw_matches]
        filtered_matches = [m for m in cleaned_matches if is_fantasy_litrpg_candidate(m)]
    elif mode == "greek_hebrew":
        raw_matches = collect_foreign_matches(full_text, GREEK_HEBREW_REGEX)
        filtered_matches = []
        for word, evidence in raw_matches:
            if (
                len(word) > 1
                and normalize_foreign_term_for_fuzzy_match(word) not in STOP_WORDS_FOLDED
                and word not in KNOWN_OCR_FRAGMENTS
            ):
                filtered_matches.append(word)
                if evidence:
                    ocr_suspect_evidence.setdefault(word, set()).add(evidence)
    elif mode == "custom" and query:
        custom_regex = re.compile(re.escape(query), re.IGNORECASE)
        raw_matches = custom_regex.findall(full_text)
        filtered_matches = [m.strip('.,;:!?·\'"()[]{}«»') for m in raw_matches]
    else: # all_foreign (default)
        raw_matches = collect_foreign_matches(full_text, ALL_FOREIGN_REGEX)
        filtered_matches = []
        for word, evidence in raw_matches:
            if (
                len(word) > 1
                and normalize_foreign_term_for_fuzzy_match(word) not in STOP_WORDS_FOLDED
                and word not in KNOWN_OCR_FRAGMENTS
            ):
                filtered_matches.append(word)
                if evidence:
                    ocr_suspect_evidence.setdefault(word, set()).add(evidence)

    if not filtered_matches:
        if not quiet:
            print("No significant matching terms found in the document.")
        return []

    counts = Counter(filtered_matches)
    total_occurrences = sum(counts.values())

    global_dict = fetch_global_pronunciations(db_path)

    def is_similar(aa, bb):
        if not aa or not bb: return False
        if aa == bb: return True
        if len(aa) > 3 and aa in bb: return True
        if len(bb) > 3 and bb in aa: return True
        if len(aa) < 4 or abs(len(aa) - len(bb)) > 2: return False

        v0 = list(range(len(aa) + 1))
        v1 = [0] * (len(aa) + 1)
        for i in range(len(bb)):
            v1[0] = i + 1
            for j in range(len(aa)):
                cost = 0 if aa[j] == bb[i] else 1
                v1[j + 1] = min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost)
            for j in range(len(aa) + 1):
                v0[j] = v1[j]
        return v0[len(aa)] <= 2

    unique_words = list(counts.keys())
    unique_words_lower = [normalize_foreign_term_for_fuzzy_match(w) for w in unique_words]
    
    PRONOUNS_AND_ARTICLES = {
        "the", "a", "an", "this", "that", "these", "those",
        "i", "me", "my", "mine", "we", "us", "our", "ours",
        "you", "your", "yours", "he", "him", "his",
        "she", "her", "hers", "it", "its",
        "they", "them", "their", "theirs",
        "who", "whom", "whose", "which", "what"
    }

    # Anchor each group on its most frequent unassigned spelling. Members must
    # match that anchor directly; do not union A~B and B~C into an A~C chain.
    # A small cap is a final guard against a very broad OCR neighborhood
    # dominating the priority list.
    normalized_by_word = dict(zip(unique_words, unique_words_lower))
    ordered_anchors = sorted(
        unique_words,
        key=lambda word: (-counts[word], word.casefold()),
    )
    assigned_words = set()
    groups = []
    for anchor in ordered_anchors:
        if anchor in assigned_words:
            continue
        direct_matches = [
            word for word in ordered_anchors
            if word not in assigned_words
            and is_similar(normalized_by_word[anchor], normalized_by_word[word])
        ][:MAX_FUZZY_GROUP_VARIANTS]
        assigned_words.update(direct_matches)
        groups.append(direct_matches)
        
    word_sort_weight = {}
    fuzzy_group_metadata = {}
    for members in groups:
        group_sum = sum(counts[m] for m in members)
        # Deflate if any member of the group is a pronoun or article
        is_deflated = any(m.lower() in PRONOUNS_AND_ARTICLES for m in members)
        effective_group_sum = (group_sum / 10000.0) if is_deflated else group_sum
        
        for m in members:
            effective_indiv_count = (counts[m] / 10000.0) if m.lower() in PRONOUNS_AND_ARTICLES else counts[m]
            word_sort_weight[m] = (effective_group_sum, effective_indiv_count, counts[m])
            fuzzy_group_metadata[m] = {
                "fuzzyGroupCount": group_sum,
                "fuzzyGroupVariants": sorted(
                    members,
                    key=lambda variant: (-counts[variant], variant.casefold()),
                ),
            }

    sorted_unique_words = sorted(unique_words, key=lambda w: word_sort_weight[w], reverse=True)

    # Calculate cumulative percentage coverage threshold
    target_count = (target_percentile / 100.0) * total_occurrences
    cumulative = 0
    top_words = []

    for word in sorted_unique_words:
        freq = counts[word]
        cumulative += freq
        top_words.append((word, freq))
        if cumulative >= target_count:
            break

    if not quiet:
        print(f"\nFound {len(unique_words)} unique terms ({total_occurrences} total occurrences).")
        print(f"Target {target_percentile:.0f}% cumulative frequency consists of {len(top_words)} unique words.\n")

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
        result = {
            "word": word,
            "count": freq,
            **fuzzy_group_metadata[word],
            "percentage": round(pct, 2),
            "pronunciations": pronunciations,
            "contexts": contexts,
        }
        automatic_ignore_reason = classify_automatic_ocr_ignore(word)
        if automatic_ignore_reason:
            result["ocrFragment"] = True
            result["automaticIgnoreReason"] = automatic_ignore_reason
        if word in ocr_suspect_evidence:
            result["ocrSuspect"] = True
            result["ocrEvidence"] = sorted(ocr_suspect_evidence[word])[:2]
        results.append(result)

    return results

def main():
    parser = argparse.ArgumentParser(description="Scan PDF for foreign words / LitRPG terms and output frequencies.")
    parser.add_argument("pdf_path", nargs="?", help="Path to the PDF file")
    parser.add_argument("--db", default="drizzle/sqlite.db", help="Path to SQLite database")
    parser.add_argument("--target", type=float, default=80.0, help="Target percentage threshold (80.0 or 100.0)")
    parser.add_argument("--mode", default="all_foreign", choices=["all_foreign", "fantasy_litrpg", "greek_hebrew", "custom"], help="Scanning mode")
    parser.add_argument("--query", default=None, help="Custom search query term")
    parser.add_argument("--json", action="store_true", help="Output raw JSON format")
    parser.add_argument("--classify-english-json", default=None, help="Classify words from a JSON file for admin cleanup")

    args = parser.parse_args()

    if args.classify_english_json:
        with open(args.classify_english_json, "r", encoding="utf-8") as source:
            words = json.load(source)
        if not isinstance(words, list):
            raise ValueError("English cleanup input must be a JSON array.")
        print(json.dumps(classify_standard_english_words(words), ensure_ascii=False))
        return
    if not args.pdf_path:
        parser.error("pdf_path is required unless --classify-english-json is used")

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
