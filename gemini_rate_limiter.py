import math
import time
from typing import MutableMapping


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
