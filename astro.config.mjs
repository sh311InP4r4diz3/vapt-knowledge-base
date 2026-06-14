import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://sh3llInP4r4diz3.github.io',
  base: '/vapt-knowledge-base',
  markdown: {
    shikiConfig: {
      theme: 'github-dark-dimmed',
      wrap: true,
    }
  }
});
