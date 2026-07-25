import asyncio
import json
import re
import os
import time
import difflib
from nats.aio.client import Client as NATS
from google import genai

# --- PER-KEY RATE LIMITER STATE ---
API_STATES = {}
MAX_DELAY = 300            
MIN_DELAY = 5              

LINGUISTIC_PROMPT = """
Perform only the following task: Search the provided text for isolated Greek or Hebrew words (1 to 3 words long). 

If a word is strictly Koine Greek or Biblical Hebrew script, provide a one-word English definition.

HARD CONSTRAINTS:
1. IF the text contains English, German, Latin, or proper names, return an empty JSON object {}.
2. IF the text contains a sequence of 4 or more foreign words, return an empty JSON object {}.
3. DO NOT define English theological words (Messiah, glory, law, participation, etc).
4. DO NOT define Greek/Hebrew articles or prepositions (του, της, αυτου, etc).

CRITICAL RESTRAINTS:
1. IGNORE ENGLISH AND NAMES: Do not extract standard English words, theological terms (e.g., law, Messiah, glory), or proper names (e.g., Enoch, Esdras, Baruch).
2. IGNORE MODERN LANGUAGES: Do not extract German, French, or Latin words (e.g., Taufe, Die, und, Leiden). ONLY target Koine Greek and Biblical Hebrew.
3. IGNORE BASIC GRAMMAR: Do not extract basic Greek/Hebrew articles, prepositions, or pronouns (e.g., της, του, αυτου, εν, και).
4. IGNORE LONG PHRASES (PIPELINE SURVIVAL RULE): If you see a sequence of 4 or more consecutive Greek/Hebrew words, IGNORE all of them. Only define isolated terms (1 to 3 words max).

OUTPUT FORMAT:
Return a JSON object where the keys are the EXACT foreign words found in the text, and the values are their single-word English definitions. Return ONLY the JSON object.

EXAMPLES OF WHAT TO DO:
Input: "...when the δόξα of God..."
Output: 
{
  "δόξα": "glory"
}

EXAMPLES OF WHAT NOT TO DO (RETURN EMPTY JSON):
Input: "...the law and the Messiah bring glorification..."
Output: 
{}
(Reason: English words. Ignore completely.)

Input: "...In der Taufe haben Christen..."
Output: 
{}
(Reason: German language. Ignore completely.)

Input: "...συμμορφους της εικονος του υιου αυτου..."
Output: 
{}
(Reason: 6 consecutive Greek words. Leave untouched so downstream filters can process it.)
"""

def academic_pre_clean(text, user_abbreviations, biblical_books):
    """Phase 1: Regex & Structural Expansion"""
    pt = text
    for short, full in biblical_books.items():
        pattern = rf"\b{re.escape(short)}\s+(\d+):(\d+)([-–](\d+))?"
        def replace_range(match):
            chapter, verse_start, _, verse_end = match.groups()
            if verse_end:
                return f"{full} chapter {chapter} verse {verse_start} through {verse_end}"
            return f"{full} chapter {chapter} verse {verse_start}"
        pt = re.sub(pattern, replace_range, pt)
    pt = re.sub(r'\bvv\.\s*(\d+)', r'verses \1', pt)
    pt = re.sub(r'\bv\.\s*(\d+)', r'verse \1', pt)
    if user_abbreviations:
        for key in sorted(user_abbreviations.keys(), key=len, reverse=True): 
            pt = re.sub(r'(?<!\w)' + re.escape(key) + r'(?!\w)', user_abbreviations[key], pt)
    return pt

def extract_learned_words(cleaned_text, existing_dict):
    """Phase 3: Scrape the output for new [Word](/IPA/) tags"""
    new_words = {}
    matches = re.findall(r'\[([^\]]+)\]\((/[^/]+/)\)', cleaned_text)
    for name, ipa in matches:
        if name not in existing_dict and name not in new_words:
            new_words[name] = ipa
    return new_words

async def enrich_text_with_semantics(chunk, api_key, backup_api_key=None, model_name="gemini-3.5-flash"):
    """Uses Gemini to inject English definitions next to Greek/Hebrew words."""
    if not api_key:
        return chunk, []
        
    try:
        client = genai.Client(api_key=api_key)
        full_prompt = f"{LINGUISTIC_PROMPT}\n\nText:\n{chunk}"
        
        response = await client.aio.models.generate_content(
            model=model_name,
            contents=full_prompt,
            config={"response_mime_type": "application/json", "temperature": 0.0}
        )
        
        definitions = json.loads(response.text.strip())
        if "defined_words" in definitions:
            definitions = definitions["defined_words"]
            
        words_defined = []
        modified_text = chunk
        
        for foreign_word, english_def in definitions.items():
            if not isinstance(english_def, str) or not english_def: 
                continue
            if foreign_word.lower() in ["the", "and", "or", "in", "of", "to", "a", "is", "that", "it", "law", "messiah", "glory", "baptism", "taufe", "die", "und", "leiden"]:
                continue
            
            if foreign_word in modified_text:
                replacement = f"{foreign_word}, {english_def},"
                modified_text = modified_text.replace(foreign_word, replacement)
                words_defined.append(foreign_word)
            
        return modified_text, words_defined
        
    except Exception as e:
        if backup_api_key:
            print(f"    [🔄] Semantic enrichment hit error with primary key: {e}. Trying backup key...")
            return await enrich_text_with_semantics(chunk, backup_api_key, None, model_name)
        print(f"    [GEMINI ERROR] Semantic enrichment failed: {e}")
        return chunk, []

async def process_message(msg):
    data = json.loads(msg.data.decode())
    user_id = data.get("user_id", "Unknown")
    api_key = data.get("api_key")
    backup_api_key = data.get("backup_api_key")
    prompt = data.get("prompt")
    raw_text = data.get("raw_text")
    
    text_length = len(raw_text) if raw_text else 0
    print(f"\n[📦] INCOMING BATCH SIZE (SCHOLAR PROFILE): {text_length} characters")
    print(f"[🔍] PREVIEW: {str(raw_text)[:150]}...\n")
    
    pronunciations = data.get("pronunciations", {})
    abbreviations = data.get("abbreviations", {})
    books = data.get("books", {})
    ai_model = data.get("ai_model") or "gemini-3.5-flash"
    
    print(f"\n[*] New job intercepted for User: {user_id}")

    if not api_key or not raw_text:
        print("[!] Missing API Key or Text. Aborting job.")
        await msg.respond(json.dumps({"status": "error", "message": "Missing API Key"}).encode())
        return

    try:
        # PHASE 1: Pre-Clean with Regex & Abbreviations
        print("  -> Running fast pre-clean...")
        pre_cleaned_text = academic_pre_clean(raw_text, abbreviations, books)
        
        # PHASE 2: Semantic Enrichment (Biblical Language Scholar Profile)
        print("  -> Running Semantic Enrichment via Gemini...")
        enriched_text, words_defined = await enrich_text_with_semantics(pre_cleaned_text, api_key, backup_api_key, ai_model)
        
        if words_defined:
            print(f"  -> [SEMANTICS] Enriched {len(words_defined)} biblical words with English definitions.")

        # PHASE 3: Gemini Processing
        print("  -> Initializing Gemini SDK...")
        client = genai.Client(api_key=api_key)
        
        dict_string = json.dumps(pronunciations, indent=2, ensure_ascii=False)
        dynamic_constraints = f"CRITICAL CONTINUITY RULE: Use these exact phonetic spellings:\n{dict_string}\n\n"
        
        full_prompt = f"{prompt}\n\n{dynamic_constraints}Text to clean:\n{enriched_text}"
        final_text = ""
        
        api_state = API_STATES.setdefault(api_key, {"lock": asyncio.Lock(), "current_delay": 0, "resume_at": 0})
        
        if time.time() < api_state["resume_at"]:
            print(f"  -> [⏳] API Key is in penalty box. Rejecting so Node can re-queue.")
            await msg.respond(json.dumps({
                "status": "rate_limit", 
                "message": f"API is ratelimited. Resumes in {int(api_state['resume_at'] - time.time())}s"
            }).encode())
            return
        
        async with api_state["lock"]:
            while True:
                if api_state["current_delay"] > 0:
                    if api_state["current_delay"] <= 30:
                        print(f"  -> [⏳] Rate Limiter Active: Pausing for {api_state['current_delay']} seconds...")
                        await asyncio.sleep(api_state["current_delay"])
                    else:
                        api_state["resume_at"] = time.time() + api_state["current_delay"]
                        print(f"  -> [🛑] API Limit is {api_state['current_delay']}s. Rejecting back to Node.js queue...")
                        await msg.respond(json.dumps({
                            "status": "rate_limit", 
                            "message": f"API is ratelimited. Resumes in {api_state['current_delay']}s"
                        }).encode())
                        return
                    
                try:
                    print("  -> Processing text with AI (Gemini)...")
                    response = await client.aio.models.generate_content(
                        model=ai_model,
                        contents=full_prompt
                    )
                    final_text = response.text.strip()
                    
                    if api_state["current_delay"] > 0:
                        api_state["current_delay"] = api_state["current_delay"] // 2
                        if api_state["current_delay"] < MIN_DELAY:
                            api_state["current_delay"] = 0
                        api_state["resume_at"] = 0
                        print(f"  -> [✅] API Recovering: Cooldown reduced to {api_state['current_delay']} seconds.")
                    
                    break
                    
                except Exception as e:
                    error_msg = str(e).lower()
                    if "429" in error_msg or "quota" in error_msg or "rate limit" in error_msg or "503" in error_msg:
                        if backup_api_key and backup_api_key != api_key:
                            print(f"  -> [🔄] Primary API Limit Hit! Falling back to backup key...")
                            api_key = backup_api_key
                            client = genai.Client(api_key=api_key)
                            api_state = API_STATES.setdefault(api_key, {"lock": asyncio.Lock(), "current_delay": 0, "resume_at": 0})
                            continue

                        if api_state["current_delay"] == 0:
                            api_state["current_delay"] = MIN_DELAY
                        else:
                            api_state["current_delay"] = min(api_state["current_delay"] * 2, MAX_DELAY)
                        
                        print(f"  -> [🛑] API Limit Hit! Spiking cooldown to {api_state['current_delay']} seconds.")
                        continue
                        
                    raise e

        # PHASE 4: Two-Way Sync Extraction
        learned_words = extract_learned_words(final_text, pronunciations)
        if learned_words:
            print(f"  -> [LEARNED] Discovered {len(learned_words)} new phonetic overrides!")

        # PHASE 5: Changelog Generation
        diff_lines = list(difflib.unified_diff(
            raw_text.splitlines(),
            final_text.splitlines(),
            fromfile='Original',
            tofile='AI Cleaned (Scholar)',
            lineterm=''
        ))
        changelog = '\n'.join(diff_lines)

        result = {
            "status": "success",
            "cleaned_text": final_text,
            "new_pronunciations": learned_words,
            "changelog": changelog
        }
        
        await msg.respond(json.dumps(result).encode())
        print("[*] Job finished and returned to the NATS queue.")

    except Exception as e:
        print(f"[!] Critical API Error: {e}")
        await msg.respond(json.dumps({"status": "error", "message": str(e)}).encode())

async def main():
    nc = NATS()
    try:
        nats_url = os.environ.get("NATS_URL", "nats://127.0.0.1:4222")
        await nc.connect(nats_url)
        print("==========================================")
        print("  BIBLICAL SCHOLAR WORKER IS ONLINE")
        print("  [Loaded: Regex Engine, Gemini Semantics, Auto-Sync Module]")
        print("==========================================")
        # We listen to a distinct queue to allow Next.js to route to this specific profile
        await nc.subscribe("audiobooks.scholar.clean", cb=process_message)
        
        while True:
            await asyncio.sleep(1)
            
    except KeyboardInterrupt:
        print("\nShutting down worker...")
    finally:
        if nc.is_connected:
            await nc.close()

if __name__ == '__main__':
    asyncio.run(main())
