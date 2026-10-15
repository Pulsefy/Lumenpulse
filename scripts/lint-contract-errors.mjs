import fs from 'node:fs';
import path from 'node:path';

const baseDir = 'apps/onchain/contracts';
const contracts = fs.readdirSync(baseDir).filter(name => {
  const stat = fs.statSync(path.join(baseDir, name));
  return stat.isDirectory() && fs.existsSync(path.join(baseDir, name, 'src', 'errors.rs'));
});

const allocatedCodes = new Map();
let hasOverlap = false;

for (const contract of contracts) {
  const errorsPath = path.join(baseDir, contract, 'src', 'errors.rs');
  const content = fs.readFileSync(errorsPath, 'utf8');
  
  const regex = /\s+(\w+)\s*=\s*(\d+),/g;
  let match;
  
  while ((match = regex.exec(content)) !== null) {
    const name = match[1];
    const code = Number.parseInt(match[2], 10);
    
    if (allocatedCodes.has(code)) {
      console.error(`[Lint Error] Overlapping error code ${code} found in ${contract}::${name}. Already used by ${allocatedCodes.get(code)}`);
      hasOverlap = true;
    } else {
      allocatedCodes.set(code, `${contract}::${name}`);
    }
  }
}

if (hasOverlap) {
  process.exit(1);
}

console.log('Contract error codes lint passed.');
