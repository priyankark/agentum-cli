import { isAbsolute } from 'path';

/** Load the bundled package, or an explicitly configured trusted development build. */
export function loadRustAddon<T>(): T {
  const configured = process.env.AGENTUM_RUSTY_ROBOT_PATH;
  if (configured && !isAbsolute(configured)) throw new Error('AGENTUM_RUSTY_ROBOT_PATH must be an absolute trusted addon path');
  return require(configured || '@priyankark/rusty-robot') as T;
}
