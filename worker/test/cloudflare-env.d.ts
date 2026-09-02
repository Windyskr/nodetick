import type { Env as NodeTickEnv } from '../src/env.js';

declare global {
  namespace Cloudflare {
    interface Env extends NodeTickEnv {}
  }
}

export {};
