import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Patterns live at <language>/<category>/<slug>/PATTERN.md in the repo root,
// one level above this site. Some (protobuf/buf-setup) sit one level shallower,
// so both depths are accepted; category comes from frontmatter, not the path.
const patterns = defineCollection({
  loader: glob({
    pattern: ['*/*/PATTERN.md', '*/*/*/PATTERN.md', '!templates/**', '!**/node_modules/**'],
    base: '..',
    generateId: ({ entry }) => entry.replace(/\/PATTERN\.md$/, ''),
  }),
  schema: z.object({
    name: z.string(),
    language: z.string(),
    category: z.string(),
    tags: z.array(z.string()),
    description: z.string(),
    test: z.string(),
    origin: z.string().optional(),
    verdict: z.enum(['adopted', 'rejected', 'trial']).optional(),
    verdict_note: z.string().optional(),
  }),
});

export const collections = { patterns };
