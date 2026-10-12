export default {
  plugins: [
    "prettier-plugin-astro",
    "@ianvs/prettier-plugin-sort-imports",
    "prettier-plugin-tailwindcss",
  ],
  tailwindStylesheet: "./src/styles/global.css",
  importOrder: ["<BUILTIN_MODULES>", "<THIRD_PARTY_MODULES>", "^[.]"],
  overrides: [
    {
      files: "*.astro",
      options: { parser: "astro" },
    },
  ],
};
