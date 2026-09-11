import { createHttpHandler } from './http.js';
import { getRuntime } from './runtime.js';

const invoke = createHttpHandler(() => getRuntime());

export async function handler(event, context) {
  return invoke(event, context);
}
