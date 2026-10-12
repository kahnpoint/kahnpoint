// @ts-check
import { defineConfig, fontProviders } from "astro/config";

import tailwindcss from "@tailwindcss/vite";

import mdx from "@astrojs/mdx";

// https://astro.build/config
export default defineConfig({
  site: "https://kahnpoint.com",

  vite: {
    plugins: [tailwindcss()],
  },

  integrations: [mdx()],

  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: "Arvo",
      cssVariable: "--font-heading",
    },
    {
      provider: fontProviders.fontsource(),
      name: "Commissioner",
      cssVariable: "--font-sans",
    },
  ],
});
