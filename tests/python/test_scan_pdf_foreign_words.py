import unittest
from unittest.mock import patch

import scan_pdf_foreign_words


class ForeignWordContextTests(unittest.TestCase):
    def test_litrpg_mode_rejects_standard_english_and_keeps_book_terms(self):
        text = (
            "The hero entered the Dungeon with Aethrian and cast manamancy. "
            "THE common words should disappear, but Khar'Thok and Rank42 remain."
        )
        standard_english = {
            "the", "hero", "entered", "dungeon", "with", "and", "cast",
            "common", "words", "should", "disappear", "but", "remain",
        }

        def fake_zipf(word, _language):
            return 5.0 if word in standard_english else 0.0

        with (
            patch.object(scan_pdf_foreign_words, "load_pdf_text", return_value=text),
            patch.object(scan_pdf_foreign_words, "fetch_global_pronunciations", return_value={}),
            patch.object(scan_pdf_foreign_words, "zipf_frequency", side_effect=fake_zipf),
        ):
            results = scan_pdf_foreign_words.scan_pdf_foreign_words(
                "unused.pdf", target_percentile=100, mode="fantasy_litrpg", quiet=True,
            )

        terms = {item["word"] for item in results}
        self.assertEqual(terms, {"Aethrian", "manamancy", "Khar'Thok", "Rank42"})

    def test_known_ocr_fragments_are_not_returned_as_dictionary_candidates(self):
        text = "The fragment κω appears beside the valid term λόγος."
        for mode in ("greek_hebrew", "all_foreign"):
            with self.subTest(mode=mode):
                with (
                    patch.object(scan_pdf_foreign_words, "load_pdf_text", return_value=text),
                    patch.object(scan_pdf_foreign_words, "fetch_global_pronunciations", return_value={}),
                ):
                    results = scan_pdf_foreign_words.scan_pdf_foreign_words(
                        "unused.pdf",
                        target_percentile=100,
                        mode=mode,
                        quiet=True,
                    )

                    self.assertNotIn("κω", [item["word"] for item in results])
                    self.assertIn("λόγος", [item["word"] for item in results])

    def test_contexts_match_complete_foreign_terms_not_compound_substrings(self):
        text = (
            "The compound θεολόγος appears first. "
            "Another θεολόγος appears second. "
            "The standalone λόγος means word."
        )
        with (
            patch.object(scan_pdf_foreign_words, "load_pdf_text", return_value=text),
            patch.object(scan_pdf_foreign_words, "fetch_global_pronunciations", return_value={}),
        ):
            results = scan_pdf_foreign_words.scan_pdf_foreign_words(
                "unused.pdf",
                target_percentile=100,
                mode="greek_hebrew",
                quiet=True,
            )

        logos = next(item for item in results if item["word"] == "λόγος")
        self.assertEqual(logos["contexts"], ["The standalone λόγος means word."])

    def test_preserves_mixed_script_ocr_evidence_for_gemini_review(self):
        text = "The damaged OCR token vio[θεσ]iα appears beside υἱοθεσία."
        with (
            patch.object(scan_pdf_foreign_words, "load_pdf_text", return_value=text),
            patch.object(scan_pdf_foreign_words, "fetch_global_pronunciations", return_value={}),
        ):
            results = scan_pdf_foreign_words.scan_pdf_foreign_words(
                "unused.pdf",
                target_percentile=100,
                mode="greek_hebrew",
                quiet=True,
            )

        shard = next(item for item in results if item["word"] == "θεσ")
        intact = next(item for item in results if item["word"] == "υἱοθεσία")
        self.assertTrue(shard["ocrSuspect"])
        self.assertEqual(shard["ocrEvidence"], ["vio[θεσ]iα"])
        self.assertNotIn("ocrSuspect", intact)

    def test_exposes_fuzzy_group_priority_and_variants(self):
        text = "Aethrian Aethrian Aethriann Common Common Common Common."
        with (
            patch.object(scan_pdf_foreign_words, "load_pdf_text", return_value=text),
            patch.object(scan_pdf_foreign_words, "fetch_global_pronunciations", return_value={}),
            patch.object(
                scan_pdf_foreign_words,
                "zipf_frequency",
                side_effect=lambda word, _language: 5.0 if word == "common" else 0.0,
            ),
        ):
            results = scan_pdf_foreign_words.scan_pdf_foreign_words(
                "unused.pdf",
                target_percentile=100,
                mode="fantasy_litrpg",
                quiet=True,
            )

        aethrian = next(item for item in results if item["word"] == "Aethrian")
        self.assertEqual(aethrian["fuzzyGroupCount"], 3)
        self.assertEqual(aethrian["fuzzyGroupVariants"], ["Aethrian", "Aethriann"])
        self.assertNotIn("Common", [item["word"] for item in results])

    def test_marks_safe_extraction_artifacts_for_automatic_ignore(self):
        text = "δ᾽ σ᾿ υἱοθεσ דמותὁμοίωμα Θεσμοφόρος θεός·"
        with (
            patch.object(scan_pdf_foreign_words, "load_pdf_text", return_value=text),
            patch.object(scan_pdf_foreign_words, "fetch_global_pronunciations", return_value={}),
        ):
            results = scan_pdf_foreign_words.scan_pdf_foreign_words(
                "unused.pdf", target_percentile=100, mode="greek_hebrew", quiet=True,
            )

        by_word = {item["word"]: item for item in results}
        for artifact in ("δ᾽", "σ᾿", "υἱοθεσ", "דמותὁμοίωμα"):
            self.assertTrue(by_word[artifact]["ocrFragment"])
            self.assertTrue(by_word[artifact]["automaticIgnoreReason"])
        self.assertNotIn("ocrFragment", by_word["Θεσμοφόρος"])
        self.assertNotIn("ocrFragment", by_word["θεός"])


if __name__ == "__main__":
    unittest.main()
