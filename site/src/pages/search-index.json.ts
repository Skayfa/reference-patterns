import { getCollection } from 'astro:content';

export async function GET() {
  const patterns = await getCollection('patterns');
  const index = patterns.map((p) => ({
    id: p.id,
    name: p.data.name,
    language: p.data.language,
    category: p.data.category,
    tags: p.data.tags,
    verdict: p.data.verdict ?? null,
  }));
  return new Response(JSON.stringify(index), {
    headers: { 'Content-Type': 'application/json' },
  });
}
