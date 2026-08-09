import asyncio
import json
import re
import os
import time
import difflib
from nats.aio.client import Client as NATS
from google import genai
from gemini_rate_limiter import extract_gemini_usage, refresh_gemini_cooldown

# --- PER-KEY RATE LIMITER STATE ---
API_STATES = {}
MAX_DELAY = 300            
MIN_DELAY = 5              

def academic_pre_clean(text, user_abbreviations, biblical_books):
    """Phase 1: Regex & Structural Expansion"""
    pt = text
    for short, full in biblical_books.items():
        pattern = rf"\b{re.escape(short)}\.?\s+(\d+):(\d+)([-–](\d+))?"
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

async def process_message(msg):
    data = json.loads(msg.data.decode())
    user_id = data.get("user_id", "Unknown")
    api_key = data.get("api_key")
    backup_api_key = data.get("backup_api_key")
    prompt = data.get("prompt")
    pronunciation_prompt = data.get("pronunciation_prompt", "")
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
        
        # Definitions and pronunciations are resolved once during the book
        # pre-scan and are already present in raw_text. Scholar cleanup must
        # remain a single Gemini request per chunk.
        enriched_text = pre_cleaned_text

        # PHASE 2: Gemini Processing
        print("  -> Initializing Gemini SDK...")
        client = genai.Client(api_key=api_key)
        
        dict_string = json.dumps(pronunciations, indent=2, ensure_ascii=False)
        dynamic_constraints = f"CRITICAL CONTINUITY RULE: Use these exact phonetic spellings:\n{dict_string}\n\n"
        title_instruction = "CHAPTER TITLE GENERATION: You MUST summarize the provided text into a unique 3 to 5 word descriptive title based on its actual contents. DO NOT just copy the existing chapter title (e.g. 'Foreword' or 'Chapter 1'). At the very end of your response, after the cleaned text, you MUST add exactly one blank line and then output the title wrapped in tags exactly like this: [CHAPTER_TITLE: Three Word Summary]. Do not include the chapter number or 'continued'.\n\n"
        
        full_prompt = f"{prompt}\n\n{dynamic_constraints}{pronunciation_prompt}\n\n{title_instruction}Text to clean:\n{enriched_text}"
        final_text = ""
        
        api_state = API_STATES.setdefault(api_key, {"lock": asyncio.Lock(), "current_delay": 0, "resume_at": 0})
        
        cooldown_remaining = refresh_gemini_cooldown(api_state)
        if cooldown_remaining > 0:
            print(f"  -> [⏳] API Key is in penalty box. Rejecting so Node can re-queue.")
            await msg.respond(json.dumps({
                "status": "rate_limit", 
                "message": f"API is ratelimited. Resumes in {cooldown_remaining}s"
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
                    
                    final_text = ""
                    if response.text:
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

        # PHASE 3: Two-Way Sync Extraction & Title
        title_match = re.search(r'\[\s*CHAPTER_TITLE\s*:\s*(.*?)\]', final_text, re.IGNORECASE)
        chapter_title = ""
        if title_match:
            chapter_title = title_match.group(1).strip()
            final_text = final_text[:title_match.start()].strip()

        learned_words = extract_learned_words(final_text, pronunciations)
        if learned_words:
            print(f"  -> [LEARNED] Discovered {len(learned_words)} new phonetic overrides!")

        # Strip out the bypass exclamation mark from heteronym tags so TTS gets valid markup
        final_text = re.sub(r'\[([^\]]+)\]\(!(/[^/]+/)\)', r'[\1](\2)', final_text)

        # PHASE 4: Changelog Generation
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
            "changelog": changelog,
            "chapter_title": chapter_title,
            "usage": extract_gemini_usage(response),
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
