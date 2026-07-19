import { defineConfig } from 'astro/config';
import sectionize from 'remark-sectionize';

export default defineConfig({
  site: 'https://skayfa.github.io',
  base: '/reference-patterns',
  markdown: {
    remarkPlugins: [sectionize],
    shikiConfig: { theme: 'vesper' },
  },
});
