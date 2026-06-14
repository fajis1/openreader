// constants.ts

export const BASE_ABBREVIATIONS = [
  { key: "NT", value: "New Testament" }, { key: "OT", value: "Old Testament" }, 
  { key: "AT", value: "Old Testament" }, { key: "NTG", value: "New Testament Greek" }, 
  { key: "HB", value: "Hebrew Bible" }, { key: "LXX", value: "Septuagint" }, 
  { key: "MT", value: "Masoretic Text" }, { key: "DSS", value: "Dead Sea Scrolls" }, 
  { key: "DSSSE", value: "Dead Sea Scrolls Study Edition" }, { key: "SP", value: "Samaritan Pentateuch" }, 
  { key: "Vg", value: "Vulgate" }, { key: "VL", value: "Vetus Latina" }, 
  { key: "Tg", value: "Targum" }, { key: "Tgs", value: "Targums" }, 
  { key: "Pesh", value: "Peshitta" }, { key: "GNT", value: "Greek New Testament" }, 
  { key: "IVP", value: "I.V.P." }, { key: "AJA", value: "A.J.A." }, 
  { key: "BA", value: "B.A." }, { key: "BDAG", value: "Bauer-Danker-Arndt-Gingrich Lexicon" }, 
  { key: "HALOT", value: "Hebrew and Aramaic Lexicon of the Old Testament" }, 
  { key: "BDB", value: "Brown-Driver-Briggs Lexicon" }, 
  { key: "TDNT", value: "Theological Dictionary of the New Testament" }, 
  { key: "TWOT", value: "Theological Wordbook of the Old Testament" }, 
  { key: "NICOT", value: "New International Commentary on the Old Testament" }, 
  { key: "NICNT", value: "New International Commentary on the New Testament" }, 
  { key: "WBC", value: "Word Biblical Commentary" }, { key: "NAC", value: "New American Commentary" }, 
  { key: "AB", value: "Anchor Bible" }, { key: "AYB", value: "Anchor Yale Bible" }, 
  { key: "LCL", value: "Loeb Classical Library" }, { key: "ECF", value: "Early Church Fathers" }, 
  { key: "ANF", value: "Ante-Nicene Fathers" }, { key: "NPNF", value: "Nicene and Post-Nicene Fathers" }, 
  { key: "ST", value: "Summa Theologica" }, { key: "STh", value: "Summa Theologiae" }, 
  { key: "ms.", value: "manuscript" }, { key: "mss.", value: "manuscripts" }, 
  { key: "var.", value: "variant" }, { key: "varr.", value: "variants" }, 
  { key: "lit.", value: "literally" }, { key: "sic", value: "thus in the original" }, 
  { key: "hapax", value: "word occurring only once" }, { key: "lect.", value: "lectionary" }, 
  { key: "ed.", value: "edited by" }, { key: "eds.", value: "editors" }, 
  { key: "trans.", value: "translated by" }, { key: "repr.", value: "reprinted" }, 
  { key: "rev.", value: "revised" }, { key: "cf.", value: "compare" }, 
  { key: "contra", value: "against" }, { key: "esp.", value: "especially" }, 
  { key: "i.e.", value: "that is" }, { key: "e.g.", value: "for example" }, 
  { key: "et al.", value: "and others" }, { key: "vol.", value: "volume" }, 
  { key: "vols.", value: "volumes" }, { key: "ch.", value: "chapter" }, 
  { key: "chs.", value: "chapters" }, { key: "v.", value: "verse" }, 
  { key: "vv.", value: "verses" }, { key: "bk.", value: "book" }, 
  { key: "sec.", value: "section" }, { key: "pp.", value: "pages" }, 
  { key: "p.", value: "page" }, { key: "Apoc.", value: "Apocrypha" }, 
  { key: "Deut.", value: "Deuterocanonical" }, { key: "L.A.B.", value: "Liber Antiquitatum Biblicarum" }, 
  { key: "OTP", value: "Old Testament Pseudepigrapha" }, { key: "Pss. Sol.", value: "Psalms of Solomon" }, 
  { key: "Heb.", value: "Hebrew" }, { key: "Aram.", value: "Aramaic" }, 
  { key: "Gr.", value: "Greek" }, { key: "Lat.", value: "Latin" }, 
  { key: "Syr.", value: "Syriac" }, { key: "Copt.", value: "Coptic" }
];

export const BASE_BOOKS = [
  { key: "Gen", value: "Genesis" }, { key: "Exod", value: "Exodus" }, { key: "Lev", value: "Leviticus" }, 
  { key: "Num", value: "Numbers" }, { key: "Deut", value: "Deuteronomy" }, { key: "Josh", value: "Joshua" }, 
  { key: "Judg", value: "Judges" }, { key: "Ruth", value: "Ruth" }, { key: "1-2 Sam", value: "1-2 Samuel" }, 
  { key: "1 Sam", value: "1 Samuel" }, { key: "2 Sam", value: "2 Samuel" }, { key: "1-2 Kings", value: "1-2 Kings" }, 
  { key: "1 Kings", value: "1 Kings" }, { key: "2 Kings", value: "2 Kings" }, { key: "1-2 Chron", value: "1-2 Chronicles" }, 
  { key: "1 Chron", value: "1 Chronicles" }, { key: "2 Chron", value: "2 Chronicles" }, { key: "Ezra", value: "Ezra" }, 
  { key: "Neh", value: "Nehemiah" }, { key: "Esther", value: "Esther" }, { key: "Job", value: "Job" }, 
  { key: "Ps", value: "Psalms" }, { key: "Pss", value: "Psalms" }, { key: "Prov", value: "Proverbs" }, 
  { key: "Eccles", value: "Ecclesiastes" }, { key: "Song of Sol", value: "Song of Solomon" }, { key: "Isa", value: "Isaiah" }, 
  { key: "Jer", value: "Jeremiah" }, { key: "Lam", value: "Lamentation" }, { key: "Ezek", value: "Ezekiel" }, 
  { key: "Dan", value: "Daniel" }, { key: "Hosea", value: "Hosea" }, { key: "Joel", value: "Joel" }, 
  { key: "Amos", value: "Amos" }, { key: "Obad", value: "Obadiah" }, { key: "Jon", value: "Jonah" }, 
  { key: "Mic", value: "Micah" }, { key: "Nah", value: "Nahum" }, { key: "Hab", value: "Habakkuk" }, 
  { key: "Zeph", value: "Zephaniah" }, { key: "Hag", value: "Haggai" }, { key: "Zech", value: "Zechariah" }, 
  { key: "Mal", value: "Malachi" }, { key: "Tob", value: "Tobit" }, { key: "Jdt", value: "Judith" }, 
  { key: "Add Esth", value: "Additions to Esther" }, { key: "Wis", value: "Wisdom of Solomon" }, { key: "Sir", value: "Sirach" }, 
  { key: "Ecclus", value: "Sirach" }, { key: "Bar", value: "Baruch" }, { key: "Ep Jer", value: "Epistle of Jeremiah" }, 
  { key: "Pr Azar", value: "Prayer of Azariah" }, { key: "Sus", value: "Susanna" }, { key: "Bel", value: "Bel and the Dragon" }, 
  { key: "1 Macc", value: "1 Maccabees" }, { key: "2 Macc", value: "2 Maccabees" }, { key: "3 Macc", value: "3 Maccabees" }, 
  { key: "4 Macc", value: "4 Maccabees" }, { key: "1 Esd", value: "1 Esdras" }, { key: "2 Esd", value: "2 Esdras" }, 
  { key: "Pr Man", value: "Prayer of Manasseh" }, { key: "Ps 151", value: "Psalm 151" }, { key: "Odes", value: "Odes" }, 
  { key: "Wis Sol", value: "Wisdom of Solomon" }, { key: "1 Enoch", value: "1 Enoch" }, { key: "2 Enoch", value: "2 Enoch" }, 
  { key: "3 Enoch", value: "3 Enoch" }, { key: "Jub", value: "Jubilees" }, { key: "Jos Asen", value: "Joseph and Aseneth" }, 
  { key: "Matt", value: "Matthew" }, { key: "Mark", value: "Mark" }, { key: "Luke", value: "Luke" }, 
  { key: "John", value: "John" }, { key: "Acts", value: "Acts" }, { key: "Rom", value: "Romans" }, 
  { key: "1-2 Cor", value: "1-2 Corinthians" }, { key: "1 Cor", value: "1 Corinthians" }, { key: "2 Cor", value: "2 Corinthians" }, 
  { key: "Gal", value: "Galatians" }, { key: "Eph", value: "Ephesians" }, { key: "Phil", value: "Philippians" }, 
  { key: "Col", value: "Colossians" }, { key: "1-2 Thess", value: "1-2 Thessalonians" }, { key: "1 Thess", value: "1 Thessalonians" }, 
  { key: "2 Thess", value: "2 Thessalonians" }, { key: "1-2 Tim", value: "1-2 Timothy" }, { key: "1 Tim", value: "1 Timothy" }, 
  { key: "2 Tim", value: "2 Timothy" }, { key: "Titus", value: "Titus" }, { key: "Philem", value: "Philemon" }, 
  { key: "Heb", value: "Hebrews" }, { key: "James", value: "James" }, { key: "1-2 Pet", value: "1-2 Peter" }, 
  { key: "1 Pet", value: "1 Peter" }, { key: "2 Pet", value: "2 Peter" }, { key: "1-3 John", value: "1-3 John" }, 
  { key: "1 John", value: "1 John" }, { key: "2 John", value: "2 John" }, { key: "3 John", value: "3 John" }, 
  { key: "Jude", value: "Jude" }, { key: "Rev", value: "Revelation" }
];
export const PRESET_PROMPTS = [
  {
    name: "LitRPG & GameLit",
    content: `You are an expert audiobook preparation assistant. Your task is to clean and format the following text to make it sound incredibly natural and well-paced for a Text-to-Speech engine.

Follow these rules STRICTLY:

1. FIX OCR AND HYPHENATION: Fix obvious OCR errors and broken sentences. 
   - ENGLISH RECONSTRUCTION: If an English word is broken by hyphens or capitalization for emphasis (e.g., "Le-VIT-i-cal", "ex-e-GEE-sis", "un-i-VO-cally"), you MUST collapse it back into its standard dictionary spelling (e.g., "Levitical", "exegesis", "univocally"). Do NOT phoneticize standard English vocabulary.
   - SUFFIX EXPANSION: Expand common name suffixes to their full words (e.g., change "Jr." to "Junior" and "Sr." to "Senior").

2. STRICT SEMINARY PRONUNCIATION (KOKORO MARKUP): When encountering Hebrew or Greek words, you MUST use Kokoro's phonetic markup syntax to ensure correct pronunciation and stress. 
   - Format: \`[Original Text](/IPA_Transcription/)\` (e.g., \`[καταλλάσσω](/kɑtɑlˈlɑsoʊ/)\`, \`[בְּרִית](/bəˈɹiθ/)\`).
   - You must use English-compatible IPA (e.g., use \`/k/\` or \`/x/\` for gutturals, do not use true pharyngeal fricatives that will break an English TTS voice). Always include the primary stress marker \`ˈ\` on the correct syllable.
   - HEBREW ROOT EXCEPTION: If a 3-letter Hebrew root is presented in English caps (e.g., "K-P-R" or "KPR"), DO NOT use IPA. Format it with commas and spaces so the engine reads the individual letters: "K, P, R".
   - NO SINGLE-LETTER CAPS: In phonetic syllables, do not put a single capital letter between hyphens (e.g., do NOT use "a-B-c"). Combine them into multi-letter syllables.
   (See Phonetic Reference Guide Below)

3. SMART CITATION FILTERING: Handle biblical and academic citations based on context:
   - KEEP the citation if it follows an actual quoted Bible verse or direct textual quote.
   - REMOVE the citation if it is a "long list" (e.g., "(cf. Gen 1:26, 2:7; Rom 5:12)").
   - REMOVE standard academic author/date markers (e.g., "(Smith 1999, 45)").
   - REMOVE stranded footnotes that bled into the text (e.g., lines starting with numbers followed by historians, like "98. Cassius Dio, Roman History...").

4. DO NOT SUMMARIZE: Do not summarize or paraphrase. Keep the author's original meaning exactly as written. 

5. OPTIMIZE FOR CADENCE: Add commas (,) for natural breaths, and use em-dashes (—) or ellipses (...) to separate complex parenthetical thoughts. Split long paragraphs into smaller ones to force longer pauses.

6. STRIP METADATA AND SOURCE TAGS: Delete all bracketed source markers (e.g., "<source>") and decorative delimiters (e.g., "****", "---"). These are metadata, not text, and must be destroyed. This rule takes precedence over Rule 3.

7. SMART NUMBER FORMATTING: DO NOT spell out biblical chapter and verse numbers into text words (e.g., keep "6:18", do not write "six eighteen"). However, to ensure the TTS reads ranges correctly, you MUST replace hyphens/dashes between numbers with the word "through" (e.g., convert "6:18-21" to "6:18 through 21").

9. RETURN FORMAT: Return ONLY the cleaned, optimized text. No conversational filler at the beginning or end.

10. THE GARBAGE & TABLE FILTER: If an entire chunk consists of academic citations, Tables of Contents, disconnected word soup, broken formatting from a PDF table (e.g., "Parity, suzerainty, patron"), academic indexes, bibliographies, or repetitive strings of page numbers, DO NOT attempt to fix or phoneticize it. Audiobooks cannot read tables or disconnected data. You must return an EMPTY STRING (literally nothing).

11. SURGICAL FOREIGN QUOTE PRUNING (ORDER OF OPERATIONS PRIORITY): This rule takes absolute precedence over Rule 2. Delete any full sentence or long quotation (more than 5 words total) that is predominantly in a foreign language (e.g., German, French, Latin, Greek). 
   - KEEP short foreign terms (1 to 5 words) embedded within English sentences (e.g., Greek/Hebrew concepts).
   - This rule still applies even if an English conjunction (like "and", "or") bridges two long foreign phrases. Destroy the whole block.
   - DO NOT rewrite, paraphrase, or add new English words to bridge the gap left by the deletion. 
   - Mechanically close the gap: Simply remove the foreign text and join the remaining punctuation, or insert an ellipsis (...) to indicate the omission, leaving the surrounding English text exactly as the author wrote it.
   - ONLY after pruning the long quotes should you apply Rule 2's pronunciation rules to the surviving short terms.


12. SECTION HEADING PACING: When you encounter a section heading or a verse marker starting a new thought (e.g., "The Purification Offering", "NOTES", "6:2."), you MUST force a natural pause before and after it. Do this by isolating the header with double newlines.

---
PHONETIC REFERENCE GUIDE (ENGLISH-COMPATIBLE IPA):
FOR KOINE GREEK (Strict Erasmian): α=/ɑ/, ε=/ɛ/, η=/eɪ/, ι=/i/, ο=/oʊ/ or /ɒ/, υ=/u/, ω=/oʊ/, αι=/aɪ/, ει=/eɪ/, οι=/ɔɪ/, ου=/u/, ευ=/ju/, χ=/k/, θ=/θ/.
FOR BIBLICAL HEBREW (Standard Academic): Qamats/Patah=/ɑ/, Tsere/Segol=/ɛ/ or /eɪ/, Hireq=/i/, Holem=/oʊ/, Shureq/Qibbuts=/u/, Shewa=/ə/ (if vocal), Het/Khaf=/k/ or /x/ (use English compatible sounds).

# ==========================================
# --- EXAMPLES OF THE EXPECTED TRANSFORMATION ---
# ==========================================

--- EXAMPLE 1 (Number Ranges, Citations, & Phonetics) ---
RAW TEXT:
The law of the sacrifice, qŏdāšîm, (cf. Lev 6:18-21; Rainey 1970) is central to the text.

OPTIMIZED TEXT:
The law of the sacrifice, [qŏdāšîm](/koʊdɑˈʃim/), is central to the text.
(Why: Academic author citation is stripped, long list citation is stripped, numbers are left alone if kept, Hebrew is converted to Kokoro IPA).

--- EXAMPLE 2 (Number Ranges & OCR Fixing) ---
RAW TEXT:
He read verses 4-9 to eƯect change.

OPTIMIZED TEXT:
He read verses 4 through 9 to effect change.
(Why: The hyphen in the number range becomes "through", and the OCR artifact is fixed).

--- EXAMPLE 3 (Navigational Pruning & Foreign Sentence Pruning) ---
RAW TEXT:
The concept of holy, qādôš, is defined by the phrase das Heilige ist ganz andere, which means separate. For further discussion, see the Introduction, §F.

OPTIMIZED TEXT:
The concept of holy, [qādôš](/kɑˈdoʊʃ/), is defined by the phrase... which means separate.
(Why: The short Hebrew term gets IPA, the long German quote is replaced by an ellipsis, and the navigational cross-reference is completely destroyed).

--- EXAMPLE 4 (Header Pacing) ---
RAW TEXT:
The Purification Offering
17 The Lord spoke to Moses, saying: 18Speak to Aaron and his sons thus:

OPTIMIZED TEXT:
The Purification Offering.

The Lord spoke to Moses, saying: "Speak to Aaron and his sons thus:"
(Why: The header is isolated for a pause, the floating '17' and '18' verse numbers are removed to prevent robotic reading, and quotes are added for dialogue).

--- EXAMPLE 5 (Negative Pattern - What NOT to do) ---
RAW TEXT:
Read 6:18.

BAD OPTIMIZED TEXT:
Read six eighteen.

GOOD OPTIMIZED TEXT:
Read 6:18.
(Why: TTS engines misread "six eighteen" out of context. Keep the digits).`
  }
];
export const PRESET_MODELS = [
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (Fastest)" },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro (Most Accurate)" },
  { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite (Efficient)" },
  { id: "gemma-4-31b-it", name: "Gemma 4 31B IT (Local/Open)" },
  { id: "custom", name: "Custom Model Identifier..." } // NEW
];