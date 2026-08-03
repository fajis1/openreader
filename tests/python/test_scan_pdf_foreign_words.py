import unittest
from unittest.mock import patch

import scan_pdf_foreign_words


class ForeignWordContextTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
