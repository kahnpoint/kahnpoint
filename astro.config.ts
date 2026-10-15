import mdx from "@astrojs/mdx";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, fontProviders } from "astro/config";

export default defineConfig({
  site: "https://kahnpoint.com",
  redirects: {
    "/xor": { destination: "/onehot", status: 301 },
    "/onehot-proof": { destination: "/onehot", status: 301 },
  },

  vite: {
    plugins: [tailwindcss()],
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
