import { execFileSync } from 'node:child_process';

const requiredNodeMajor = 24;
const actualNodeMajor = Number(process.versions.node.split('.')[0]);

if (actualNodeMajor !== requiredNodeMajor) {
  throw new Error(`Node.js ${requiredNodeMajor}.x is required; found ${process.versions.node}`);
}

for (const [command, args] of [
  ['corepack', ['pnpm', '--version']],
  ['git', ['--version']],
]) {
  const version = execFileSync(command, args, { encoding: 'utf8' }).trim();
  console.log(`${command}: ${version}`);
}

console.log('Toolchain baseline is available.');
