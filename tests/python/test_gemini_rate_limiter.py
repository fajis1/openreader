import unittest
from pathlib import Path

from gemini_rate_limiter import extract_gemini_usage, refresh_gemini_cooldown


class GeminiRateLimiterTests(unittest.TestCase):
    def test_usage_metadata_is_normalized_without_prompt_content(self):
        class Usage:
            prompt_token_count = 120
            candidates_token_count = 80
            thoughts_token_count = 10
            cached_content_token_count = 70
            total_token_count = 210

        class Response:
            usage_metadata = Usage()

        self.assertEqual(extract_gemini_usage(Response()), {
            "inputTokens": 120,
            "outputTokens": 80,
            "thinkingTokens": 10,
            "cachedInputTokens": 70,
            "totalTokens": 210,
        })

    def test_active_cooldown_is_preserved_and_reported(self):
        state = {"current_delay": 40, "resume_at": 140}

        remaining = refresh_gemini_cooldown(state, now=100)

        self.assertEqual(remaining, 40)
        self.assertEqual(state, {"current_delay": 40, "resume_at": 140})

    def test_fractional_remaining_time_rounds_up(self):
        state = {"current_delay": 40, "resume_at": 100.2}

        remaining = refresh_gemini_cooldown(state, now=100)

        self.assertEqual(remaining, 1)

    def test_expired_cooldown_is_cleared_for_a_probe(self):
        state = {"current_delay": 40, "resume_at": 100}

        remaining = refresh_gemini_cooldown(state, now=100)

        self.assertEqual(remaining, 0)
        self.assertEqual(state, {"current_delay": 0, "resume_at": 0})

    def test_in_request_delay_without_resume_time_is_unchanged(self):
        state = {"current_delay": 10, "resume_at": 0}

        remaining = refresh_gemini_cooldown(state, now=100)

        self.assertEqual(remaining, 0)
        self.assertEqual(state, {"current_delay": 10, "resume_at": 0})

    def test_both_smart_audio_workers_refresh_expired_cooldowns(self):
        repository_root = Path(__file__).resolve().parents[2]

        for worker_name in ("audiobook_worker.py", "biblical_scholar_worker.py"):
            source = (repository_root / worker_name).read_text(encoding="utf-8")
            self.assertIn(
                "cooldown_remaining = refresh_gemini_cooldown(api_state)",
                source,
                worker_name,
            )

    def test_docker_image_includes_workers_and_shared_limiter(self):
        repository_root = Path(__file__).resolve().parents[2]
        dockerfile = (repository_root / "Dockerfile").read_text(encoding="utf-8")

        for filename in (
            "audiobook_worker.py",
            "biblical_scholar_worker.py",
            "gemini_rate_limiter.py",
        ):
            self.assertIn(f"/app/{filename} ./{filename}", dockerfile, filename)


if __name__ == "__main__":
    unittest.main()
