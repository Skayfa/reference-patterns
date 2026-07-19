export const REPO_URL = 'https://github.com/Skayfa/reference-patterns';

// Accent per top-level language dir. A future language simply falls back to
// muted until it earns a line here.
const LANGUAGE_ACCENTS: Record<string, string> = {
  typescript: '#5EA1F7',
  go: '#43C9D6',
  rust: '#E8825A',
  fullstack: '#B58CF2',
  protobuf: '#5FC98E',
};

export const accentFor = (language: string): string =>
  LANGUAGE_ACCENTS[language] ?? 'var(--muted)';

const LANGUAGE_HEADINGS: Record<string, string> = {
  typescript: 'TypeScript',
  go: 'Go',
  rust: 'Rust',
  protobuf: 'Protobuf',
};

export const languageHeading = (language: string): string =>
  LANGUAGE_HEADINGS[language] ?? language.charAt(0).toUpperCase() + language.slice(1);

export type Verdict = 'adopted' | 'trial' | 'rejected';

export const VERDICT_COLORS: Record<Verdict, string> = {
  adopted: '#64C983',
  trial: '#E2B34E',
  rejected: '#E5646C',
};

export const sourceUrl = (id: string): string => `${REPO_URL}/tree/main/${id}`;

// GH Pages serves under /reference-patterns — every internal link goes through here.
export const withBase = (path: string): string => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
};
