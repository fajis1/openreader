import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@openreader/compute-core/*",
                "!@openreader/compute-core/local-runtime",
              ],
              message:
                "Use '@openreader/compute-core' root imports for light APIs. The only allowed subpath is '@openreader/compute-core/local-runtime'.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
