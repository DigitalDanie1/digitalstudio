// The generation logic lives in ../lib/generate.mjs (shared with the Vercel functions).
// Needs `npm install` at the repo root so @anthropic-ai/sdk and zod resolve from the root node_modules.
export * from '../lib/generate.mjs';
