import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Base recommended rules
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Global ignores
  {
    ignores: ["**/dist/", "**/node_modules/", "**/.next/"],
  },

  // TypeScript file overrides
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // Allow `any` but warn — the codebase uses it in some places
      "@typescript-eslint/no-explicit-any": "warn",

      // Downgrade Function type usage to warning (used heavily in tests)
      "@typescript-eslint/no-unsafe-function-type": "warn",

      // Allow unused vars that start with underscore
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  }
);
