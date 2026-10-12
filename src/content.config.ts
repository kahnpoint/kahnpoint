import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src" }),
  schema: z.object({
    title: z.string(),
    published: z.coerce.date(),
  }),
});

export const collections = { blog };
