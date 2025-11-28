import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";
import importPlugin from "eslint-plugin-import";
import prettier from "eslint-plugin-prettier";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
    // replaces ignorePatterns from .eslintrc.cjs
    globalIgnores(["node_modules/", "dist/", "build/", "coverage/"]),

    {
        files: ["**/*.{js,jsx}"],

        extends: [
            js.configs.recommended,
            reactHooks.configs["recommended-latest"],
            reactRefresh.configs.vite,
        ],

        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            ecmaFeatures: {
                jsx: true,
            },
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },

        plugins: {
            react,
            "react-hooks": reactHooks,
            "jsx-a11y": jsxA11y,
            import: importPlugin,
            prettier,
        },

        settings: {
            react: {
                version: "detect",
            },
            "import/resolver": {
                node: {
                    extensions: [".js", ".jsx"],
                },
            },
        },

        rules: {
            // from old .eslintrc.cjs
            "react/react-in-jsx-scope": "off",
            "react/prop-types": "off",
            "prettier/prettier": "warn",
            "import/order": [
                "warn",
                {
                    groups: [
                        "builtin",
                        "external",
                        "internal",
                        ["parent", "sibling", "index"],
                    ],
                    "newlines-between": "always",
                },
            ],

            // from previous flat config
            "no-unused-vars": ["error", { varsIgnorePattern: "^[A-Z_]" }],
        },
    },
]);