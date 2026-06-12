import asyncio
import json
import re
from nats.aio.client import Client as NATS
from google import genai

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
        pattern = rf"\b{re.escape(short)}\s+(\d+):(\d+)([-–](\d+))?"
        
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
    prompt = data.get("prompt")
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
    ai_model = data.get("ai_model") or "gemini-2.5-flash"
    
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
        
        full_prompt = f"{prompt}\n\n{dynamic_constraints}Text to clean:\n{pre_cleaned_text}"
        final_text = ""
        
        api_state = API_STATES.setdefault(api_key, {"lock": asyncio.Lock(), "current_delay": 0, "resume_at": 0})
        
        import time
        if time.time() < api_state["resume_at"]:
            print(f"  -> [⏳] API Key is in penalty box. Rejecting so Node can re-queue.")
            await msg.respond(json.dumps({
                "status": "rate_limit", 
                "message": f"API is ratelimited. Resumes in {int(api_state['resume_at'] - time.time())}s"
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
        # PHASE 3: Option B - Two-Way Sync Extraction
        learned_words = extract_learned_words(final_text, pronunciations)
        if learned_words:
            print(f"  -> [LEARNED] Discovered {len(learned_words)} new phonetic overrides!")

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
        await nc.connect("nats://127.0.0.1:4222")
        print("==========================================")
        print("  PYTHON AUDIOBOOK WORKER IS ONLINE")
        print("  [Loaded: Regex Engine, Auto-Sync Module]")
        print("==========================================")
        await nc.subscribe("audiobooks.gemini.clean", cb=process_message)
        
        while True:
            await asyncio.sleep(1)
            
    except KeyboardInterrupt:
        print("\nShutting down worker...")
    finally:
        if nc.is_connected:
            await nc.close()

if __name__ == '__main__':
    asyncio.run(main())