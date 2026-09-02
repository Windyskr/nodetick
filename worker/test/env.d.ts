import type { Env } from '../src/env.js';

// Give the `env` binding from 'cloudflare:test' the same shape as the worker's
// Env so tests can access env.DB in a type-safe way.
declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}
