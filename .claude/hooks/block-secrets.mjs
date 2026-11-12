// Block git commits that stage .env files or obvious secrets.
import { execSync } from 'node:child_process';
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  const cmd = JSON.parse(input || '{}')?.tool_input?.command ?? '';
  if (!/git\s+commit/.test(cmd)) return;
  const staged = execSync('git diff --cached --name-only', { encoding: 'utf8' });
  if (/(^|\/)\.env($|\.)(?!example)/m.test(staged)) {
    process.stderr.write('Refusing to commit a .env file. Unstage it.');
    process.exit(2);
  }
  const diff = execSync('git diff --cached', { encoding: 'utf8' });
  if (/(sk-ant-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC )?PRIVATE KEY-----)/.test(diff)) {
    process.stderr.write('Staged changes contain what looks like a secret. Remove it.');
    process.exit(2);
  }
});
