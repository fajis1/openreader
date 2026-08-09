import asyncio
import json
import re
import os
from nats.aio.client import Client as NATS
from google import genai
from pydantic import BaseModel, Field
from gemini_rate_limiter import extract_gemini_usage, refresh_gemini_cooldown

# --- PER-KEY RATE LIMITER STATE ---
# Maps api_key -> {"lock": asyncio.Lock(), "current_delay": 0, "resume_at": 0}
API_STATES = {}
MAX_DELAY = 300            # 5 minutes (in seconds)
MIN_DELAY = 5              # The starting penalty

def academic_pre_clean(text, user_abbreviations, biblical_books):
    """Phase 1: Regex & Structural Expansion"""
    pt = text
    
    # 1. Structural Biblical Reference Handler (The Regex Pass)
    # This matches [Book] [Chapter]:[Verse] or [Book] [Chapter]:[Verse]-[Verse]
    for short, full in biblical_books.items():
        # Pattern matches: "1 Sam 1:2" or "1 Sam 1:2-5"
        # \b ensures "1 Sam" matches but not "1 Samuel"
        pattern = rf"\b{re.escape(short)}\.?\s+(\d+):(\d+)([-–](\d+))?"
        
        def replace_range(match):
            chapter, verse_start, _, verse_end = match.groups()
            if verse_end:
                return f"{full} chapter {chapter} verse {verse_start} through {verse_end}"
            return f"{full} chapter {chapter} verse {verse_start}"
        
        pt = re.sub(pattern, replace_range, pt)

    # 2. Universal Numbering Fixes
    pt = re.sub(r'\bvv\.\s*(\d+)', r'verses \1', pt)
    pt = re.sub(r'\bv\.\s*(\d+)', r'verse \1', pt)
    
    # 3. Static Abbreviation Pass (Direct Swap)
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
    """Triggered when a NATS job arrives"""
    data = json.loads(msg.data.decode())
    user_id = data.get("user_id", "Unknown")
    api_key = data.get("api_key")
    backup_api_key = data.get("backup_api_key")
    prompt = data.get("prompt")
    pronunciation_prompt = data.get("pronunciation_prompt", "")
    raw_text = data.get("raw_text")
    
    # --- ADD THESE 3 LINES RIGHT HERE ---
    text_length = len(raw_text) if raw_text else 0
    print(f"\n[📦] INCOMING BATCH SIZE: {text_length} characters")
    print(f"[🔍] PREVIEW: {str(raw_text)[:150]}...\n")
    # ------------------------------------
    
    # The new dynamic ledgers sent from Next.js
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

        # PHASE 2: Gemini Processing
        print("  -> Initializing Gemini SDK...")
        client = genai.Client(api_key=api_key)
        
        dict_string = json.dumps(pronunciations, indent=2, ensure_ascii=False)
        dynamic_constraints = f"CRITICAL CONTINUITY RULE: Use these exact phonetic spellings:\n{dict_string}\n\n"
        
        title_instruction = "CHAPTER TITLE GENERATION: For narratable text, you MUST summarize the provided text into a unique 3 to 5 word descriptive title based on its actual contents. DO NOT just copy the existing chapter title (e.g. 'Foreword' or 'Chapter 1'). At the very end of your response, after the cleaned text, you MUST add exactly one blank line and then output the title wrapped in tags exactly like this: [CHAPTER_TITLE: Three Word Summary]. Do not include the chapter number or 'continued'. If the correct result is [OMIT], return only [OMIT] and do not add a chapter title.\n\n"
        
        full_prompt = f"{prompt}\n\n{dynamic_constraints}{pronunciation_prompt}\n\n{title_instruction}Text to clean:\n{pre_cleaned_text}"
        final_text = ""
        
        api_state = API_STATES.setdefault(api_key, {"lock": asyncio.Lock(), "current_delay": 0, "resume_at": 0})
        
        import time
        cooldown_remaining = refresh_gemini_cooldown(api_state)
        if cooldown_remaining > 0:
            print(f"  -> [⏳] API Key is in penalty box. Rejecting so Node can re-queue.")
            await msg.respond(json.dumps({
                "status": "rate_limit", 
                "message": f"API is ratelimited. Resumes in {cooldown_remaining}s"
            }).encode())
            return
        
        # --- NEW PER-KEY RATE LIMITER & RETRY LOGIC ---
        async with api_state["lock"]:
            while True:
                # 1. Enforce the current penalty before sending to Google
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
                    print("  -> Processing text with AI...")
                    response = await client.aio.models.generate_content(
                        model=ai_model,
                        contents=full_prompt
                    )
                    
                    if not response.text or not response.text.strip():
                        raise RuntimeError("Gemini returned no text; expected cleaned text or [OMIT]")
                    final_text = response.text.strip()
                    
                    # 2. SUCCESS! Step the delay back down gracefully
                    if api_state["current_delay"] > 0:
                        api_state["current_delay"] = api_state["current_delay"] // 2
                        if api_state["current_delay"] < MIN_DELAY:
                            api_state["current_delay"] = 0
                        api_state["resume_at"] = 0
                        print(f"  -> [✅] API Recovering: Cooldown reduced to {api_state['current_delay']} seconds.")
                    
                    break # Success! Break out of the infinite while loop
                    
                except Exception as e:
                    error_msg = str(e).lower()
                    # Check if it's a rate limit or quota error
                    if "429" in error_msg or "quota" in error_msg or "rate limit" in error_msg or "503" in error_msg:
                        if backup_api_key and backup_api_key != api_key:
                            print(f"  -> [🔄] Primary API Limit Hit! Falling back to backup key...")
                            api_key = backup_api_key
                            client = genai.Client(api_key=api_key)
                            api_state = API_STATES.setdefault(api_key, {"lock": asyncio.Lock(), "current_delay": 0, "resume_at": 0})
                            continue
                            
                        # 3. FAILURE! Spike the delay (up to 5 mins max)
                        if api_state["current_delay"] == 0:
                            api_state["current_delay"] = MIN_DELAY
                        else:
                            api_state["current_delay"] = min(api_state["current_delay"] * 2, MAX_DELAY)
                        
                        print(f"  -> [🛑] API Limit Hit! Spiking cooldown to {api_state['current_delay']} seconds.")
                        continue # Go back to the top of the while loop and wait
                        
                    # If it's a different error, throw it down to the main exception handler
                    raise e
        # --- END OF RATE LIMITER ---
        # PHASE 3: Option B - Two-Way Sync Extraction & Title
        title_match = re.search(r'\[\s*CHAPTER_TITLE\s*:\s*(.*?)\]', final_text, re.IGNORECASE)
        chapter_title = ""
        if title_match:
            chapter_title = title_match.group(1).strip()
            final_text = final_text[:title_match.start()].strip()

        outcome = "omitted" if final_text.upper() in {"[OMIT]", "[OMITTED]"} else "cleaned"
        if outcome == "omitted":
            final_text = ""
            chapter_title = ""

        learned_words = extract_learned_words(final_text, pronunciations)
        if learned_words:
            print(f"  -> [LEARNED] Discovered {len(learned_words)} new phonetic overrides!")

        # Strip out the bypass exclamation mark from heteronym tags so TTS gets valid markup
        final_text = re.sub(r'\[([^\]]+)\]\(!(/[^/]+/)\)', r'[\1](\2)', final_text)

        # PHASE 4: Changelog Generation
        import difflib
        diff_lines = list(difflib.unified_diff(
            raw_text.splitlines(),
            final_text.splitlines(),
            fromfile='Original',
            tofile='AI Cleaned',
            lineterm=''
        ))
        changelog = '\n'.join(diff_lines)

        # Package it all up to send back to Next.js
        result = {
            "status": "success",
            "outcome": outcome,
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


class Character(BaseModel):
    name: str = Field(description="Exact character name, or Narrator")
    description: str = Field(description="Brief age, personality, and speaking-style description")
    sample_text: str = Field(description="A short direct quote spoken by this character")


class CharacterExtractionResult(BaseModel):
    characters: list[Character]


class VoiceSegment(BaseModel):
    speaker: str = Field(description="Exact primary character or alias name from the supplied cast")
    voice_id: str = Field(description="Exact voice ID assigned to that character")
    text: str = Field(description="Complete narration or dialogue for this consecutive speaker segment")


class VoiceAssignmentResult(BaseModel):
    segments: list[VoiceSegment]
    continuity_state: str = Field(description="Brief scene and final-speaker context for the next chunk")
    chapter_title: str = Field(description="A unique three-to-five-word descriptive title")


async def generate_multivoice_content(msg, api_key, backup_api_key, model, contents, response_schema):
    """Use the standard worker's per-key cooldown state for Audio Drama calls."""
    active_key = api_key
    remaining_backup_key = backup_api_key
    while True:
        api_state = API_STATES.setdefault(active_key, {"lock": asyncio.Lock(), "current_delay": 0, "resume_at": 0})
        cooldown_remaining = refresh_gemini_cooldown(api_state)
        if cooldown_remaining > 0:
            if remaining_backup_key and remaining_backup_key != active_key:
                active_key = remaining_backup_key
                remaining_backup_key = ""
                continue
            await msg.respond(json.dumps({
                "status": "rate_limit",
                "message": f"API is rate limited. Resumes in {cooldown_remaining}s",
            }).encode())
            return None

        client = genai.Client(api_key=active_key)
        async with api_state["lock"]:
            if api_state["current_delay"] > 0:
                if api_state["current_delay"] <= 30:
                    await asyncio.sleep(api_state["current_delay"])
                else:
                    import time
                    api_state["resume_at"] = time.time() + api_state["current_delay"]
                    await msg.respond(json.dumps({
                        "status": "rate_limit",
                        "message": f"API is rate limited. Resumes in {api_state['current_delay']}s",
                    }).encode())
                    return None
            try:
                response = await client.aio.models.generate_content(
                    model=model,
                    contents=contents,
                    config=genai.types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=response_schema,
                    ),
                )
                if not response.text or not response.text.strip():
                    raise RuntimeError("Gemini returned an empty structured Audio Drama response")
                if api_state["current_delay"] > 0:
                    api_state["current_delay"] //= 2
                    if api_state["current_delay"] < MIN_DELAY:
                        api_state["current_delay"] = 0
                    api_state["resume_at"] = 0
                return response
            except Exception as error:
                error_message = str(error).lower()
                if any(token in error_message for token in ("429", "quota", "rate limit", "503")):
                    if remaining_backup_key and remaining_backup_key != active_key:
                        active_key = remaining_backup_key
                        remaining_backup_key = ""
                        continue
                    api_state["current_delay"] = MIN_DELAY if api_state["current_delay"] == 0 else min(api_state["current_delay"] * 2, MAX_DELAY)
                    continue
                raise


async def process_multivoice_extract(msg):
    """Extract a reviewable cast from canonical, evenly sampled book text."""
    try:
        data = json.loads(msg.data.decode())
        raw_text = data.get("raw_text") or ""
        api_key = data.get("api_key") or ""
        if not api_key or not raw_text.strip():
            await msg.respond(json.dumps({"status": "error", "message": "Missing API key or document text"}).encode())
            return
        prompt = (
            "You are casting a LitRPG audiobook. Extract every distinct speaking character visible in the supplied "
            "chapter excerpts. Always include one character named Narrator. Merge obvious spelling variants only when "
            "they clearly identify the same person; otherwise keep them separate so the user can review aliases. "
            "Do not treat chapter headings, stat names, classes, skills, monsters without dialogue, footnotes, authors, "
            "or publishers as speakers. Preserve exact character-name spelling and provide one real short quote when available.\n\n"
            f"BOOK EXCERPTS:\n{raw_text}"
        )
        response = await generate_multivoice_content(
            msg,
            api_key,
            data.get("backup_api_key") or "",
            data.get("ai_model") or "gemini-3.1-flash-lite",
            prompt,
            CharacterExtractionResult,
        )
        if response is None:
            return
        parsed = json.loads(response.text)
        await msg.respond(json.dumps({
            "status": "success",
            "characters": parsed.get("characters", []),
            "usage": extract_gemini_usage(response),
        }, ensure_ascii=False).encode())
    except Exception as error:
        print(f"[!] Audio Drama character extraction error: {error}")
        await msg.respond(json.dumps({"status": "error", "message": str(error)}).encode())


async def process_multivoice_assign(msg):
    """Return structured, server-validated speaker segments for one audiobook chunk."""
    try:
        data = json.loads(msg.data.decode())
        raw_text = data.get("raw_text") or ""
        api_key = data.get("api_key") or ""
        characters = data.get("characters") or []
        if not api_key or not raw_text.strip() or not characters:
            await msg.respond(json.dumps({"status": "error", "message": "Missing API key, text, or reviewed cast"}).encode())
            return
        cast_json = json.dumps(characters, indent=2, ensure_ascii=False)
        pronunciations = json.dumps(data.get("pronunciations") or {}, indent=2, ensure_ascii=False)
        prompt = (
            "You are assigning speakers for a LitRPG audiobook. Return structured JSON only. Split the supplied text "
            "into consecutive speaker segments. Use only exact primary names or aliases from REVIEWED CAST, and copy "
            "that cast member's exact voiceId into voice_id. Narrative prose belongs to Narrator. Preserve every "
            "narratable sentence and its order: do not summarize, omit, invent, or duplicate text. You may make only "
            "minor punctuation changes for speaking cadence. Never emit XML, HTML, bracketed control markers, stage "
            "directions, or commentary. Apply pronunciation overrides using Kokoro markup only where supplied.\n\n"
            f"REVIEWED CAST:\n{cast_json}\n\n"
            f"CONTINUITY FROM PREVIOUS CHUNK:\n{data.get('continuity_state') or 'Beginning of book.'}\n\n"
            f"PRONUNCIATION OVERRIDES:\n{pronunciations}\n"
            f"{data.get('pronunciation_prompt') or ''}\n\n"
            f"TEXT TO ASSIGN:\n{raw_text}"
        )
        response = await generate_multivoice_content(
            msg,
            api_key,
            data.get("backup_api_key") or "",
            data.get("ai_model") or "gemini-3.1-flash-lite",
            prompt,
            VoiceAssignmentResult,
        )
        if response is None:
            return
        parsed = json.loads(response.text)
        await msg.respond(json.dumps({
            "status": "success",
            "segments": parsed.get("segments", []),
            "continuity_state": parsed.get("continuity_state", ""),
            "chapter_title": parsed.get("chapter_title", ""),
            "usage": extract_gemini_usage(response),
        }, ensure_ascii=False).encode())
    except Exception as error:
        print(f"[!] Audio Drama voice assignment error: {error}")
        await msg.respond(json.dumps({"status": "error", "message": str(error)}).encode())

async def main():
    nc = NATS()
    try:
        nats_url = os.environ.get("NATS_URL", "nats://127.0.0.1:4222")
        await nc.connect(nats_url)
        print("==========================================")
        print("  PYTHON AUDIOBOOK WORKER IS ONLINE")
        print("  [Loaded: Standard Cleaner + LitRPG Audio Drama]")
        print("==========================================")
        await nc.subscribe("audiobooks.gemini.clean", cb=process_message)
        await nc.subscribe("audiobooks.multivoice.extract", cb=process_multivoice_extract)
        await nc.subscribe("audiobooks.multivoice.assign", cb=process_multivoice_assign)
        
        while True:
            await asyncio.sleep(1)
            
    except KeyboardInterrupt:
        print("\nShutting down worker...")
    finally:
        if nc.is_connected:
            await nc.close()

if __name__ == '__main__':
    asyncio.run(main())
