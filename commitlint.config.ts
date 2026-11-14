export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      1,
      "always",
      ["dsl", "renderer", "harness", "evals", "observer", "ci", "claude", "skills", "deps", "docs"],
    ],
    "body-max-line-length": [0],
  },
};
