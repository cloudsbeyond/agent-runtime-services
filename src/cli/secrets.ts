import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { getSecret, listSecretIds, removeSecret, setSecret } from '../config/keystore';

interface ExecRequest {
  protocolVersion?: number;
  provider?: string;
  ids?: string[];
}

interface ExecResponseValue {
  protocolVersion: number;
  values: Record<string, string>;
  errors?: Record<string, { message: string }>;
}

const PROTOCOL_VERSION = 1;

export async function runSecretsGet(): Promise<void> {
  const input = await readAllStdin();
  let req: ExecRequest;
  try {
    req = JSON.parse(input || '{}') as ExecRequest;
  } catch (err) {
    console.error(`secrets get: invalid stdin JSON: ${(err as Error).message}`);
    process.exit(2);
  }
  const resp: ExecResponseValue = {
    protocolVersion: PROTOCOL_VERSION,
    values: {},
  };
  for (const id of req.ids ?? []) {
    try {
      const v = await getSecret(id);
      if (v !== undefined) {
        resp.values[id] = v;
      } else {
        (resp.errors ??= {})[id] = { message: 'not found' };
      }
    } catch (err) {
      (resp.errors ??= {})[id] = { message: (err as Error).message };
    }
  }
  process.stdout.write(`${JSON.stringify(resp)}\n`);
}

export interface SecretEntryCliOptions {
  id?: string;
}

export function secretEntryForCli(opts: SecretEntryCliOptions): { id: string; label: string } {
  const id = opts.id?.trim();
  if (id) return { id, label: id };
  throw new Error('usage: agent-runtime-services secrets set --id <id>');
}

export async function runSecretsSet(opts: SecretEntryCliOptions): Promise<void> {
  let entry: { id: string; label: string };
  try {
    entry = secretEntryForCli(opts);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
  const plaintext = await promptPassword(`Input ${entry.label}: `);
  if (!plaintext) {
    console.error('cancelled: secret is empty');
    process.exit(1);
  }
  await setSecret(entry.id, plaintext);
  console.log('encrypted secret stored in Runtime Services secrets.enc');
}

export async function runSecretsList(): Promise<void> {
  const ids = await listSecretIds();
  if (ids.length === 0) {
    console.log('No Runtime Services secrets stored.');
    return;
  }
  console.log(`# Runtime Services secrets (${ids.length})\n`);
  for (const id of ids) console.log(`  - ${id}`);
}

export async function runSecretsRemove(opts: SecretEntryCliOptions): Promise<void> {
  let entry: { id: string; label: string };
  try {
    entry = secretEntryForCli(opts);
  } catch (err) {
    console.error((err as Error).message.replace('secrets set', 'secrets remove'));
    process.exit(1);
  }
  const removed = await removeSecret(entry.id);
  if (!removed) {
    console.error(`secret not found: ${entry.id}`);
    process.exit(1);
  }
  console.log(`removed ${entry.id}`);
}

async function readAllStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function promptPassword(prompt: string): Promise<string> {
  const isTTY = Boolean(process.stdin.isTTY);
  return new Promise((resolve) => {
    const muted = new Writable({
      write(_chunk: Buffer | string, _enc, cb) {
        cb();
      },
    });
    process.stdout.write(prompt);
    const rl = createInterface({
      input: process.stdin,
      output: isTTY ? muted : process.stdout,
      terminal: isTTY,
    });
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}
