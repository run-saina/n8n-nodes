import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzePackage, analyzePackageByName } from '@n8n/scan-community-package/scanner/scanner.mjs';
import { readFileSync } from 'node:fs';

function check(result) {
  if (!result.passed) throw new Error(result.details || result.message || 'Package scan failed');
}

if (process.argv.includes('--published')) {
  const { name, version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  check(await analyzePackageByName(name, version));
  console.log('Published package passed verification');
} else {
  check(await analyzePackage(process.cwd(), ['package.json', '{nodes,credentials}/**/*.{ts,js,json}']));
  const temporary = mkdtempSync(join(tmpdir(), 'saina-n8n-scan-'));
  try {
    const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', temporary], { encoding: 'utf8' }));
    execFileSync('tar', ['-xzf', join(temporary, packed.filename), '-C', temporary]);
    check(await analyzePackage(join(temporary, 'package')));
    console.log('Source and packed package passed security scanning');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
