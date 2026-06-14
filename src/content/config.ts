import { defineCollection, z } from 'astro:content';

const writeups = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    platform: z.enum(['HackTheBox', 'TryHackMe']),
    difficulty: z.enum(['Easy', 'Medium', 'Hard', 'Insane']),
    ipAddress: z.string().optional(),
    tags: z.array(z.string()),
    category: z.string(),
  }),
});

const methodologies = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    phase: z.enum(['Reconnaissance', 'Exploitation', 'Privilege Escalation', 'Post-Exploitation']),
    order: z.number(),
  }),
});

const cheatsheets = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: z.string(),
  }),
});

export const collections = { writeups, methodologies, cheatsheets };
