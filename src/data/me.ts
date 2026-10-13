import { z } from "zod";
import meJson from "../../public/me.json";

const iconItem = z.object({
  label: z.string(),
  icon: z.string(),
});

const schema = z.object({
  name: z.object({
    first: z.string(),
    last: z.string(),
  }),
  birthDate: z.iso.date(),
  bio: z.string(),
  stats: z.array(iconItem),
  skills: z.array(iconItem),
  projects: z.array(
    iconItem.extend({
      url: z.string(),
      note: z.string().optional(),
    }),
  ),
  links: z.array(
    iconItem.extend({
      url: z.url(),
    }),
  ),
  education: z.array(
    z.object({
      institution: z.string(),
      degree: z.string(),
      score: z.string(),
      dateStart: z.string(),
      dateEnd: z.string().optional(),
    }),
  ),
  experience: z.array(
    z.object({
      company: z.string(),
      companyUrl: z.url().optional(),
      role: z.string(),
      dateStart: z.string(),
      dateEnd: z.string().optional(),
      details: z.array(z.string()),
    }),
  ),
});

export const me = schema.parse(meJson);

export function ageInYears(birthDate: string): number {
  const today = new Date();
  const birth = new Date(`${birthDate}T00:00:00Z`);
  const birthdayPending =
    today.getUTCMonth() < birth.getUTCMonth() ||
    (today.getUTCMonth() === birth.getUTCMonth() &&
      today.getUTCDate() < birth.getUTCDate());
  return (
    today.getUTCFullYear() - birth.getUTCFullYear() - (birthdayPending ? 1 : 0)
  );
}
