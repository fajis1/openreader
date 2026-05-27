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
                "!@openreader/compute-core/types",
                "!@openreader/compute-core/api-contracts",
              ],
              message:
                "Use '@openreader/compute-core' root imports for light APIs. Allowed subpaths are '@openreader/compute-core/local-runtime', '@openreader/compute-core/types', and '@openreader/compute-core/api-contracts'.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/app/api/**/*.ts", "src/lib/server/**/*.ts"],
    rules: {
      "no-console": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector:
            ":matches(CallExpression[callee.property.name=/^(trace|debug|info|warn|error|fatal)$/][callee.object.name=/^(logger|serverLogger)$/],CallExpression[callee.property.name=/^(trace|debug|info|warn|error|fatal)$/][callee.object.property.name='logger'])[arguments.length<2]",
          message:
            "Server logger calls must pass context + message: logger.<level>({ event, ...ctx }, 'message').",
        },
        {
          selector:
            ":matches(CallExpression[callee.property.name=/^(trace|debug|info|warn|error|fatal)$/][callee.object.name=/^(logger|serverLogger)$/],CallExpression[callee.property.name=/^(trace|debug|info|warn|error|fatal)$/][callee.object.property.name='logger'])[arguments.0.type='Literal']",
          message:
            "Server logger first argument must be an object with an event field, not a string literal.",
        },
        {
          selector:
            ":matches(CallExpression[callee.property.name=/^(trace|debug|info|warn|error|fatal)$/][callee.object.name=/^(logger|serverLogger)$/],CallExpression[callee.property.name=/^(trace|debug|info|warn|error|fatal)$/][callee.object.property.name='logger'])[arguments.0.type='TemplateLiteral']",
          message:
            "Server logger first argument must be an object with an event field, not a template string.",
        },
        {
          selector:
            ":matches(CallExpression[callee.property.name=/^(trace|debug|info|warn|error|fatal)$/][callee.object.name=/^(logger|serverLogger)$/],CallExpression[callee.property.name=/^(trace|debug|info|warn|error|fatal)$/][callee.object.property.name='logger'])[arguments.0.type='ObjectExpression']:not(:has(Property[key.name='event']))",
          message:
            "Server logger context object must include an event field.",
        },
        {
          selector:
            ":matches(CallExpression[callee.property.name=/^(trace|debug|info|warn|error|fatal)$/][callee.object.name=/^(logger|serverLogger)$/],CallExpression[callee.property.name=/^(trace|debug|info|warn|error|fatal)$/][callee.object.property.name='logger']) > ObjectExpression:first-child > Property[key.name='err']",
          message:
            "Use `error` (typically from errorToLog(...)) instead of `err` in server logs.",
        },
      ],
    },
  },
];

export default eslintConfig;
