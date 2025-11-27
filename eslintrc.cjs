/** @type {import("eslint").Linter.Config} */
module.exports = {
    root: true,

    // ⬇️ This replaces .eslintignore
    ignorePatterns: ["node_modules/", "dist/", "build/", "coverage/"],

    env: {
        browser: true,
        es2021: true,
        node: true,
    },
    parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
            jsx: true,
        },
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
    plugins: ["react", "react-hooks", "jsx-a11y", "import", "prettier"],
    extends: [
        "eslint:recommended",
        "plugin:react/recommended",
        "plugin:react-hooks/recommended",
        "plugin:jsx-a11y/recommended",
        "plugin:import/recommended",
        "plugin:prettier/recommended",
    ],
    rules: {
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
    },
};
