/* Where the site's public files (web/public) are.
 *
 * The site's app runs from web/; the tests and scripts run from the repository
 * root or from app/. Each finds the same folder.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

export function appPublicDir(cwd: string = process.cwd()): string {
  const candidates = [
    path.join(cwd, 'web', 'public'),
    path.join(cwd, '..', 'web', 'public'),
  ];
  return path.resolve(candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]);
}
