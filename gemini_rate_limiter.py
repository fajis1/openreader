import asyncio
import math
import time
from typing import Awaitable, Callable, MutableMapping, Sequence, TypeVar


T = TypeVar("T")


def extract_gemini_usage(response: object) -> dict[str, int]:
    """Return non-sensitive Gemini usage counters in a stable JSON shape."""
    metadata = getattr(response, "usage_metadata", None)

    def count(*names: str) -> int:
        for name in names:
            value = getattr(metadata, name, None)
            if isinstance(value, (int, float)):
                return max(0, int(value))
        return 0

    return {
        "inputTokens": count("prompt_token_count"),
        "outputTokens": count("candidates_token_count"),
        "thinkingTokens": count("thoughts_token_count"),
        "cachedInputTokens": count("cached_content_token_count"),
        "totalTokens": count("total_token_count"),
    }


def refresh_gemini_cooldown(
    api_state: MutableMapping[str, object],
    *,
    now: float | None = None,
) -> int:
    """Return remaining cooldown seconds and clear an expired penalty for a probe."""
    current_time = time.time() if now is None else now
    resume_at = float(api_state.get("resume_at", 0) or 0)

    if resume_at <= 0:
        return 0

    remaining = resume_at - current_time
    if remaining > 0:
        return max(1, math.ceil(remaining))

    # The queue has waited out the full penalty. Reset the exponential delay so
    # this attempt reaches Gemini instead of scheduling the same cooldown again.
    api_state["resume_at"] = 0
    api_state["current_delay"] = 0
    return 0


def ordered_gemini_models(primary: str, fallbacks: object, *, limit: int = 2) -> list[str]:
    """Return a trimmed, de-duplicated primary plus at most two fallbacks."""
    models = [primary.strip()] if isinstance(primary, str) and primary.strip() else []
    if isinstance(fallbacks, Sequence) and not isinstance(fallbacks, (str, bytes)):
        for value in fallbacks:
            model = value.strip() if isinstance(value, str) else ""
            if model and model not in models:
                models.append(model)
            if len(models) >= limit + 1:
                break
    return models


def is_gemini_capacity_error(error: Exception) -> bool:
    message = str(error).lower()
    return any(token in message for token in ("429", "quota", "rate limit", "503"))


async def call_gemini_with_capacity_fallback(
    *,
    api_states: MutableMapping[object, MutableMapping[str, object]],
    api_keys: Sequence[str],
    models: Sequence[str],
    request: Callable[[str, str], Awaitable[T]],
    min_delay: int,
    max_delay: int,
) -> tuple[T, str] | None:
    """Try each model across configured keys before reporting exhausted capacity."""
    keys = list(dict.fromkeys(key.strip() for key in api_keys if key and key.strip()))
    for model in models:
        for api_key in keys:
            state_key = (api_key, model)
            api_state = api_states.setdefault(
                state_key,
                {"lock": asyncio.Lock(), "current_delay": 0, "resume_at": 0},
            )
            if refresh_gemini_cooldown(api_state) > 0:
                continue
            lock = api_state["lock"]
            if not isinstance(lock, asyncio.Lock):
                raise TypeError("Gemini limiter lock is invalid")
            async with lock:
                if refresh_gemini_cooldown(api_state) > 0:
                    continue
                try:
                    response = await request(api_key, model)
                except Exception as error:
                    if not is_gemini_capacity_error(error):
                        raise
                    current_delay = int(api_state.get("current_delay", 0) or 0)
                    next_delay = min_delay if current_delay == 0 else min(current_delay * 2, max_delay)
                    api_state["current_delay"] = next_delay
                    api_state["resume_at"] = time.time() + next_delay
                    continue

                current_delay = int(api_state.get("current_delay", 0) or 0)
                if current_delay > 0:
                    reduced_delay = current_delay // 2
                    api_state["current_delay"] = reduced_delay if reduced_delay >= min_delay else 0
                api_state["resume_at"] = 0
                return response, model
    return None
