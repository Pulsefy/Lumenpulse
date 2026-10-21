import * as fs from 'fs';
import * as path from 'path';

/**
 * Guard: colour values must come from theme/tokens.ts. Any hex or rgb(a)
 * string literal in app code fails this test - add a token instead.
 */
const ROOT = path.resolve(__dirname, '../..');
const SCANNED_DIRS = ['app', 'components', 'contexts', 'hooks', 'lib', 'src'];
const COLOUR_LITERAL = /['"`](#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))['"`]/;
// Named CSS colours passed to a colour prop/style, e.g. color: 'red'.
const NAMED_COLOUR =
  /[cC]olor\s*[:=]\s*\{?\s*['"`](white|black|red|green|blue|gr[ae]y|yellow|orange|purple|pink)['"`]/;

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe('hard-coded colours', () => {
  it('are not used outside theme/', () => {
    const offenders: string[] = [];
    for (const dir of SCANNED_DIRS) {
      for (const file of sourceFiles(path.join(ROOT, dir))) {
        fs.readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (COLOUR_LITERAL.test(line) || NAMED_COLOUR.test(line)) {
              offenders.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
            }
          });
      }
    }
    expect(offenders).toEqual([]);
  });
});
