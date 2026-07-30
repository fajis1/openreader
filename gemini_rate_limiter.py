import math
import time
from typing import MutableMapping


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
