// After Claude edits a file: format Prisma schema; typecheck the API when API code changed.
import { execSync } from 'node:child_process';
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  const file = JSON.parse(input || '{}')?.tool_input?.file_path ?? '';
  try {
    if (file.endsWith('schema.prisma')) execSync('npx prisma format', { cwd: 'apps/api', stdio: 'ignore' });
    if (file.includes('apps/api/src') && file.endsWith('.ts')) {
      execSync('npx tsc --noEmit -p tsconfig.json', { cwd: 'apps/api', stdio: 'pipe' });
    }
  } catch (e) {
    // Exit 2 feeds the error back to Claude so it fixes it right away.
    process.stderr.write(String(e.stdout ?? e.message).slice(0, 4000));
    process.exit(2);
  }
});
