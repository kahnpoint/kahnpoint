// @ts-check
import mdx from "@astrojs/mdx";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, fontProviders } from "astro/config";

// https://astro.build/config
export default defineConfig({
  site: "https://kahnpoint.com",

  vite: {
    plugins: [tailwindcss()],
    // Phaser is bundled at server start, so the first visit to /xor does not wait on it.
    optimizeDeps: { include: ["phaser"] },
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
