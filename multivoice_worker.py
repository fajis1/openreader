import asyncio
import json
import os
import re
import time
from nats.aio.client import Client as NATS
from google import genai
from pydantic import BaseModel, Field

# Ensure we have rate limiting setup similar to audiobook_worker
from gemini_rate_limiter import extract_gemini_usage, refresh_gemini_cooldown

API_STATES = {}
MAX_DELAY = 300
MIN_DELAY = 5

class Character(BaseModel):
    name: str = Field(description="The name of the character or narrator")
    description: str = Field(description="A brief description of the character's gender, age, and personality or speaking style")
    sample_text: str = Field(description="A 1-2 sentence direct quote of dialogue spoken by this character from the text")

class CharacterExtractionResult(BaseModel):
    characters: list[Character]

async def enforce_rate_limit(api_state, msg):
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
            return False
    return True

async def process_extract(msg):
    """Phase 1: Extract Characters using Gemini 3.1 Lite"""
    data = json.loads(msg.data.decode())
    api_key = data.get("api_key")
    backup_api_key = data.get("backup_api_key")
    raw_text = data.get("raw_text")
    ai_model = data.get("ai_model") or "gemini-2.5-flash-8b" # Fast/Lite model with 1M context
    
    print(f"\n[🎭] INCOMING CHARACTER EXTRACTION BATCH SIZE: {len(raw_text)} characters")

    if not api_key or not raw_text:
        await msg.respond(json.dumps({"status": "error", "message": "Missing API Key or Text"}).encode())
        return

    client = genai.Client(api_key=api_key)
    api_state = API_STATES.setdefault(api_key, {"lock": asyncio.Lock(), "current_delay": 0, "resume_at": 0})
    
    prompt = (
        "You are an expert casting director for an audiobook production. "
        "Read the following text and extract all distinct speaking characters. "
        "Also include a 'Narrator' character. "
        "For each character, provide their name, a brief description (gender, age, personality), "
        "and a 1-2 sentence direct quote of dialogue they spoke in the text to serve as an audio sample."
    )

    try:
        async with api_state["lock"]:
            while True:
                if not await enforce_rate_limit(api_state, msg): return
                try:
                    print(f"  -> Extracting characters with {ai_model}...")
                    response = await client.aio.models.generate_content(
                        model=ai_model,
                        contents=f"{prompt}\n\nTEXT:\n{raw_text}",
                        config=genai.types.GenerateContentConfig(
                            response_mime_type="application/json",
                            response_schema=CharacterExtractionResult,
                        )
                    )
                    
                    if api_state["current_delay"] > 0:
                        api_state["current_delay"] = max(0, api_state["current_delay"] // 2)
                        api_state["resume_at"] = 0
                    
                    result_json = json.loads(response.text)
                    await msg.respond(json.dumps({
                        "status": "success",
                        "characters": result_json.get("characters", []),
                        "usage": extract_gemini_usage(response),
                    }).encode())
                    print("[*] Extraction finished and returned.")
                    break
                except Exception as e:
                    error_msg = str(e).lower()
                    if "429" in error_msg or "quota" in error_msg or "rate limit" in error_msg or "503" in error_msg:
                        if backup_api_key and backup_api_key != api_key:
                            api_key = backup_api_key
                            client = genai.Client(api_key=api_key)
                            api_state = API_STATES.setdefault(api_key, {"lock": asyncio.Lock(), "current_delay": 0, "resume_at": 0})
                            continue
                        api_state["current_delay"] = MIN_DELAY if api_state["current_delay"] == 0 else min(api_state["current_delay"] * 2, MAX_DELAY)
                        continue
                    raise e
    except Exception as e:
        print(f"[!] Extraction Error: {e}")
        await msg.respond(json.dumps({"status": "error", "message": str(e)}).encode())

async def process_assign(msg):
    """Phase 2: Assign Voices using Gemini 3.6"""
    data = json.loads(msg.data.decode())
    api_key = data.get("api_key")
    backup_api_key = data.get("backup_api_key")
    raw_text = data.get("raw_text")
    characters = data.get("characters", [])
    continuity_state = data.get("continuity_state", "Beginning of book.")
    pronunciations = data.get("pronunciations", {})
    pronunciation_prompt = data.get("pronunciation_prompt", "")
    ai_model = data.get("ai_model") or "gemini-2.5-flash"
    
    print(f"\n[🎙️] INCOMING VOICE ASSIGNMENT BATCH SIZE: {len(raw_text)} characters")

    if not api_key or not raw_text:
        await msg.respond(json.dumps({"status": "error", "message": "Missing API Key or Text"}).encode())
        return

    client = genai.Client(api_key=api_key)
    api_state = API_STATES.setdefault(api_key, {"lock": asyncio.Lock(), "current_delay": 0, "resume_at": 0})
    
    char_list = "\n".join([f"- {c['name']} (Voice ID: {c['voiceId']})" for c in characters if 'voiceId' in c])
    
    pronunciation_section = ""
    if pronunciations:
        pronunciation_section = (
            f"PRONUNCIATION OVERRIDES:\n"
            f"Ensure these specific words are spelled phonetically as defined below:\n"
            f"{json.dumps(pronunciations, indent=2)}\n"
            f"{pronunciation_prompt}\n\n"
        )
    
    prompt = (
        "You are an expert audiobook producer and voice director. Your task is to take the provided text, assign the correct voices, and add performance markup to enhance the delivery.\n\n"
        f"{pronunciation_section}"
        f"Available Characters and their Voice IDs:\n{char_list}\n\n"
        f"Continuity State from previous chunk: {continuity_state}\n\n"
        "Instructions:\n"
        "1. VOICE TAGS: Wrap every single sentence in a <voice name=\"voiceId\">...</voice> tag indicating who is speaking or narrating. ALL text must be inside a <voice> tag. Use the exact Voice ID from the list above.\n"
        "2. PERFORMANCE ENHANCEMENT: Modify the text inside the tags to improve the emotional delivery and intonation. Use the following tools:\n"
        "   - Punctuation: Use ;:,.!?—…\"()“” heavily to guide pacing and pauses.\n"
        "   - Stress markers: Use ˈ (primary stress) and ˌ (secondary stress) before syllables that need emphasis.\n"
        "   - Volume/Intensity modifiers: Insert (-1) or (-2) immediately after a word to lower its stress/volume. Insert (+1) or (+2) after short, less stressed words to raise their stress.\n"
        "   Example: <voice name=\"am_adam\">I told you... I ˈnever want to see you again(-1)!</voice>\n"
        "3. CONTINUITY: At the very end of your response, output a block exactly like: [CONTINUITY: Briefly describe who is speaking at the end and the current scene context].\n"
        "4. TITLE: Also at the end of your response, output a block exactly like: [TITLE: A 3-5 word phrase describing this chunk].\n"
    )

    try:
        async with api_state["lock"]:
            while True:
                if not await enforce_rate_limit(api_state, msg): return
                try:
                    print(f"  -> Assigning voices with {ai_model}...")
                    response = await client.aio.models.generate_content(
                        model=ai_model,
                        contents=f"{prompt}\n\nTEXT:\n{raw_text}"
                    )
                    
                    if api_state["current_delay"] > 0:
                        api_state["current_delay"] = max(0, api_state["current_delay"] // 2)
                        api_state["resume_at"] = 0
                    
                    final_text = response.text.strip()
                    
                    # Extract Continuity and Title
                    cont_match = re.search(r'\[CONTINUITY:\s*(.*?)\]', final_text, re.DOTALL | re.IGNORECASE)
                    new_cont = cont_match.group(1).strip() if cont_match else continuity_state
                    
                    title_match = re.search(r'\[TITLE:\s*(.*?)\]', final_text, re.DOTALL | re.IGNORECASE)
                    chapter_title = title_match.group(1).strip() if title_match else None
                    
                    # Remove the blocks from the final tagged text
                    tagged_text = re.sub(r'\[CONTINUITY:.*?\]', '', final_text, flags=re.DOTALL | re.IGNORECASE)
                    tagged_text = re.sub(r'\[TITLE:.*?\]', '', tagged_text, flags=re.DOTALL | re.IGNORECASE).strip()
                    
                    await msg.respond(json.dumps({
                        "status": "success", 
                        "tagged_text": tagged_text,
                        "continuity_state": new_cont,
                        "chapter_title": chapter_title,
                        "usage": extract_gemini_usage(response)
                    }).encode())
                    print("[*] Voice assignment finished and returned.")
                    break
                except Exception as e:
                    error_msg = str(e).lower()
                    if "429" in error_msg or "quota" in error_msg or "rate limit" in error_msg or "503" in error_msg:
                        if backup_api_key and backup_api_key != api_key:
                            api_key = backup_api_key
                            client = genai.Client(api_key=api_key)
                            api_state = API_STATES.setdefault(api_key, {"lock": asyncio.Lock(), "current_delay": 0, "resume_at": 0})
                            continue
                        api_state["current_delay"] = MIN_DELAY if api_state["current_delay"] == 0 else min(api_state["current_delay"] * 2, MAX_DELAY)
                        continue
                    raise e
    except Exception as e:
        print(f"[!] Assignment Error: {e}")
        await msg.respond(json.dumps({"status": "error", "message": str(e)}).encode())


async def main():
    nc = NATS()
    try:
        nats_url = os.environ.get("NATS_URL", "nats://127.0.0.1:4222")
        await nc.connect(nats_url)
        print("==========================================")
        print("  PYTHON MULTIVOICE WORKER IS ONLINE")
        print("==========================================")
        await nc.subscribe("audiobooks.multivoice.extract", cb=process_extract)
        await nc.subscribe("audiobooks.multivoice.assign", cb=process_assign)
        
        while True:
            await asyncio.sleep(1)
            
    except KeyboardInterrupt:
        print("\nShutting down worker...")
    finally:
        if nc.is_connected:
            await nc.close()

if __name__ == '__main__':
    raise SystemExit(
        "Multi-voice handlers now run inside audiobook_worker.py so they share one "
        "per-key Gemini rate limiter. Start audiobook_worker.py instead."
    )
