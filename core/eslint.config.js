import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import-x";

export default [
  {
    ignores: ["out/**", "dist/**", "**/*.d.ts"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        project: "./tsconfig.json",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      import: importPlugin,
    },
    rules: {
      "no-negated-condition": "warn",
      "@typescript-eslint/naming-convention": "off",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "error",
      curly: "warn",
      eqeqeq: "warn",
      "no-throw-literal": "warn",
      semi: "off",
      "import/order": [
        "warn",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
            "object",
            "type",
          ],
          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },
          "newlines-between": "always",
        },
      ],
      quotes: "off",
      "import/no-unresolved": "off",
      "@typescript-eslint/no-explicit-any": "off",
      complexity: ["error", { max: 36 }],
      "max-lines-per-function": ["error", { max: 500 }],
      "max-statements": ["error", { max: 108 }],
      "max-depth": ["error", { max: 6 }],
      "max-nested-callbacks": ["error", { max: 4 }],
      "max-params": ["error", { max: 8 }],
    },
  },
  {
    files: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.vitest.ts",
    ],
    rules: {
      "max-lines-per-function": "off",
      "max-nested-callbacks": ["error", { max: 5 }],
    },
  },
  {
    // ESLint 9 counts async/generator branches more strictly than ESLint 8.
    // Keep the existing methods within a bounded baseline until they are refactored.
    files: [
      "indexing/docs/DocsService.ts",
      "llm/index.ts",
      "llm/llms/WatsonX.ts",
    ],
    rules: {
      complexity: ["error", { max: 45 }],
    },
  },
  {
    // ESLint 10 counts one existing Bedrock branch more strictly than ESLint 8.
    files: ["llm/llms/Bedrock.ts"],
    rules: {
      "max-depth": ["error", { max: 7 }],
    },
  },
];
