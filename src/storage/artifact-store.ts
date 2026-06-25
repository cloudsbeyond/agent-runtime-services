import { execFile, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { paths } from '../config/paths';
import type {
  ArtifactManifestStorePort,
  ArtifactStorePort,
  ObjectStorePort,
  ProviderProbeResult,
} from '../providers/ports';
import type { ResourceOverride } from '../resources/catalog';

const execFileAsync = promisify(execFile);

export interface ArtifactSource {
  [key: string]: unknown;
}

export type ArtifactBody = string | Uint8Array | number[];

export interface StoredArtifact {
  id: string;
  namespace: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  expiresAt?: string;
  sourceUrl?: string;
  source: ArtifactSource;
}

export interface SaveArtifactInput {
  namespace: string;
  body: ArtifactBody;
  mimeType: string;
  extension?: string;
  source?: ArtifactSource;
  sourceUrl?: string;
  expiresAt?: string;
}

export interface ArtifactNamespaceOptions {
  namespace: string;
}

export interface ArtifactCleanupOptions extends ArtifactNamespaceOptions {
  now?: Date;
}

export interface LocalArtifactStore {
  providerId?: string;
  save(input: SaveArtifactInput): Promise<StoredArtifact>;
  get(input: ArtifactNamespaceOptions & { id: string }): Promise<{ artifact: StoredArtifact; body: Uint8Array }>;
  list(options: ArtifactNamespaceOptions): Promise<StoredArtifact[]>;
  cleanupExpired(options: ArtifactCleanupOptions): Promise<{ deleted: StoredArtifact[] }>;
}

export interface LocalArtifactStoreOptions {
  artifactsDir?: string;
  manifestDbPath?: string;
  sqliteBinary?: string;
  now?: () => Date;
}

export interface LocalObjectStoreOptions {
  artifactsDir?: string;
}

export interface SqliteArtifactManifestStoreOptions {
  manifestDbPath?: string;
  sqliteBinary?: string;
}

export function createLocalArtifactStore(options: LocalArtifactStoreOptions = {}): LocalArtifactStore {
  return createArtifactStore({
    objectStore: createLocalObjectStore({ artifactsDir: options.artifactsDir }),
    manifestStore: createSqliteArtifactManifestStore({
      manifestDbPath: options.manifestDbPath,
      sqliteBinary: options.sqliteBinary,
    }),
    now: options.now,
    providerId: 'local-fs+sqlite',
  });
}

export interface ArtifactStoreCompositionOptions {
  objectStore: ObjectStorePort;
  manifestStore: ArtifactManifestStorePort;
  now?: () => Date;
  providerId?: string;
}

export function createArtifactStore(options: ArtifactStoreCompositionOptions): ArtifactStorePort {
  const now = options.now ?? (() => new Date());
  const objectStore = options.objectStore;
  const manifestStore = options.manifestStore;

  return {
    providerId: options.providerId ?? composedArtifactProviderId(objectStore, manifestStore),

    async probe(input) {
      const providerId = options.providerId ?? composedArtifactProviderId(objectStore, manifestStore);
      const [objectProbe, manifestProbe] = await Promise.all([
        probeStore(objectStore, {
          resourceId: input?.resourceId ?? 'storage.artifact_store',
          kind: input?.kind ?? 'object-store',
        }),
        probeStore(manifestStore, {
          resourceId: input?.resourceId ?? 'storage.artifact_store',
          kind: input?.kind ?? 'artifact-manifest-store',
        }),
      ]);
      return {
        status: objectProbe.status === 'available' && manifestProbe.status === 'available'
          ? 'available'
          : 'stubbed',
        providerId,
        evidence: [
          ...(objectProbe.evidence ?? []),
          ...(manifestProbe.evidence ?? []),
        ],
      };
    },

    async save(input) {
      const namespace = normalizeRequiredStorageName(input.namespace, 'namespace');
      const createdAt = now().toISOString();
      const bytes = artifactBytes(input.body);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const id = artifactId(createdAt, sha256);
      const extension = normalizeExtension(input.extension, input.mimeType);
      const expiresAt = normalizeOptionalDateString(input.expiresAt, 'expiresAt');
      const object = await objectStore.put({
        namespace,
        key: `${id}.${extension}`,
        body: bytes,
        mimeType: input.mimeType,
      });
      const record: StoredArtifact = {
        id,
        namespace,
        path: object.path,
        mimeType: input.mimeType,
        sizeBytes: object.sizeBytes,
        sha256,
        createdAt,
        ...(expiresAt ? { expiresAt } : {}),
        ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
        source: input.source ?? {},
      };

      await manifestStore.insert(record);
      return record;
    },

    async list(listOptions) {
      return manifestStore.list({
        namespace: normalizeRequiredStorageName(listOptions.namespace, 'namespace'),
      });
    },

    async get(input) {
      const namespace = normalizeRequiredStorageName(input.namespace, 'namespace');
      const id = normalizeRequiredStorageName(input.id, 'id');
      const artifact = await manifestStore.get({ namespace, id });
      return {
        artifact,
        body: await objectStore.get({ path: artifact.path }),
      };
    },

    async cleanupExpired(options) {
      const timestamp = (options.now ?? now()).toISOString();
      const expired = (await this.list({ namespace: options.namespace }))
        .filter((artifact) => artifact.expiresAt && artifact.expiresAt <= timestamp);
      for (const artifact of expired) {
        await objectStore.delete({ path: artifact.path });
        await manifestStore.delete({ namespace: artifact.namespace, id: artifact.id });
      }
      return { deleted: expired };
    },
  };
}

export function createLocalObjectStore(options: LocalObjectStoreOptions = {}): ObjectStorePort {
  const artifactsDir = options.artifactsDir ?? paths.artifactsDir;

  return {
    providerId: 'local-fs',

    async probe() {
      return {
        status: existsSync(artifactsDir) ? 'available' : 'stubbed',
        providerId: 'local-fs',
        evidence: [{
          kind: 'provider_probe',
          message: existsSync(artifactsDir) ? `artifactsDir=${artifactsDir}` : `missing artifactsDir=${artifactsDir}`,
        }],
      };
    },

    async put(input) {
      const namespace = normalizeRequiredStorageName(input.namespace, 'namespace');
      const key = normalizeObjectKey(input.key);
      const bytes = artifactBytes(input.body);
      const path = join(artifactsDir, namespace, key);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
      return {
        path,
        sizeBytes: bytes.byteLength,
      };
    },

    async get(input) {
      return readFile(input.path);
    },

    async delete(input) {
      await unlink(input.path).catch((error: unknown) => {
        if (!isNotFound(error)) throw error;
      });
    },
  };
}

export function createSqliteArtifactManifestStore(
  options: SqliteArtifactManifestStoreOptions = {},
): ArtifactManifestStorePort {
  const manifestDbPath = options.manifestDbPath ?? paths.artifactManifestDb;
  const sqliteBinary = options.sqliteBinary ?? 'sqlite3';

  return {
    providerId: 'local-sqlite-manifest',

    async probe() {
      const manifestDir = dirname(manifestDbPath);
      const sqliteReady = sqliteAvailable(sqliteBinary);
      const dirReady = existsSync(manifestDir);
      return {
        status: dirReady && sqliteReady ? 'available' : 'stubbed',
        providerId: 'local-sqlite-manifest',
        evidence: [{
          kind: 'provider_probe',
          message: dirReady && sqliteReady
            ? `manifestDbPath=${manifestDbPath}`
            : `manifest readiness failed: dir=${dirReady ? 'ok' : 'missing'} sqlite=${sqliteReady ? 'ok' : 'missing'}`,
        }],
      };
    },

    async insert(artifact) {
      await ensureManifest(manifestDbPath, sqliteBinary);
      await insertArtifact(manifestDbPath, {
        ...artifact,
        namespace: normalizeRequiredStorageName(artifact.namespace, 'namespace'),
      }, sqliteBinary);
    },

    async list(options) {
      await ensureManifest(manifestDbPath, sqliteBinary);
      return listArtifacts(manifestDbPath, sqliteBinary, {
        namespace: normalizeRequiredStorageName(options.namespace, 'namespace'),
      });
    },

    async get(input) {
      await ensureManifest(manifestDbPath, sqliteBinary);
      return getArtifact(manifestDbPath, sqliteBinary, {
        namespace: normalizeRequiredStorageName(input.namespace, 'namespace'),
        id: normalizeRequiredStorageName(input.id, 'id'),
      });
    },

    async delete(input) {
      await ensureManifest(manifestDbPath, sqliteBinary);
      await deleteArtifact(manifestDbPath, input.namespace, input.id, sqliteBinary);
    },
  };
}

export function localArtifactStoreResourceOverride(
  options: Pick<LocalArtifactStoreOptions, 'artifactsDir' | 'manifestDbPath' | 'sqliteBinary'> = {},
): ResourceOverride | undefined {
  const artifactsDir = options.artifactsDir ?? paths.artifactsDir;
  const manifestDbPath = options.manifestDbPath ?? paths.artifactManifestDb;
  const sqliteBinary = options.sqliteBinary ?? 'sqlite3';
  if (!existsSync(artifactsDir) || !existsSync(dirname(manifestDbPath)) || !sqliteAvailable(sqliteBinary)) return undefined;
  return {
    id: 'storage.artifact_store',
    status: 'available',
    provider: 'local-fs+sqlite',
  };
}

export async function readArtifactBytes(artifact: Pick<StoredArtifact, 'path'>): Promise<Buffer> {
  return readFile(artifact.path);
}

function artifactBytes(body: ArtifactBody): Buffer {
  return typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
}

function artifactId(createdAt: string, sha256: string): string {
  const timestamp = createdAt.replace(/\D/g, '').slice(0, 14);
  return `artifact-${timestamp}-${sha256.slice(0, 12)}-${randomUUID().slice(0, 8)}`;
}

function normalizeExtension(extension: string | undefined, mimeType: string): string {
  const raw = (extension ?? extensionForMimeType(mimeType)).replace(/^\./, '').toLowerCase();
  const safe = raw.replace(/[^a-z0-9]+/g, '');
  return safe || 'bin';
}

function normalizeOptionalDateString(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (!value.trim()) throw new Error(`${label} must be a valid date string`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date string`);
  return date.toISOString();
}

function extensionForMimeType(mimeType: string): string {
  switch (mimeType.split(';', 1)[0]?.trim().toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'text/html':
      return 'html';
    case 'text/markdown':
      return 'md';
    case 'text/plain':
      return 'txt';
    case 'application/json':
      return 'json';
    default:
      return 'bin';
  }
}

async function ensureManifest(dbPath: string, sqliteBinary: string): Promise<void> {
  await mkdir(dirname(dbPath), { recursive: true, mode: 0o700 });
  await runSqlite(dbPath, [
    'CREATE TABLE IF NOT EXISTS artifacts (',
    'id TEXT PRIMARY KEY,',
    'namespace TEXT NOT NULL,',
    'path TEXT NOT NULL,',
    'mime_type TEXT NOT NULL,',
    'size_bytes INTEGER NOT NULL,',
    'sha256 TEXT NOT NULL,',
    'created_at TEXT NOT NULL,',
    'expires_at TEXT,',
    'source_url TEXT,',
    'source_json TEXT NOT NULL',
    ');',
  ].join(' '), sqliteBinary);
  await addColumnIfMissing(dbPath, 'artifacts', 'namespace', 'TEXT', sqliteBinary);
  await chmod(dbPath, 0o600).catch((error: unknown) => {
    if (!isNotFound(error)) throw error;
  });
}

async function insertArtifact(dbPath: string, artifact: StoredArtifact, sqliteBinary: string): Promise<void> {
  await runSqlite(dbPath, [
    'INSERT OR REPLACE INTO artifacts',
    '(id, namespace, path, mime_type, size_bytes, sha256, created_at, expires_at, source_url, source_json)',
    'VALUES (',
    [
      sqlString(artifact.id),
      sqlString(artifact.namespace),
      sqlString(artifact.path),
      sqlString(artifact.mimeType),
      String(artifact.sizeBytes),
      sqlString(artifact.sha256),
      sqlString(artifact.createdAt),
      sqlNullable(artifact.expiresAt),
      sqlNullable(artifact.sourceUrl),
      sqlString(JSON.stringify(artifact.source)),
    ].join(', '),
    ');',
  ].join(' '), sqliteBinary);
}

async function listArtifacts(
  dbPath: string,
  sqliteBinary: string,
  options: ArtifactNamespaceOptions,
): Promise<StoredArtifact[]> {
  const namespace = normalizeRequiredStorageName(options.namespace, 'namespace');
  const stdout = await runSqliteJson(dbPath, [
    'SELECT id, namespace, path, mime_type AS mimeType, size_bytes AS sizeBytes, sha256,',
    'created_at AS createdAt, expires_at AS expiresAt, source_url AS sourceUrl, source_json AS sourceJson',
    'FROM artifacts',
    `WHERE namespace = ${sqlString(namespace)}`,
    'ORDER BY created_at ASC, id ASC;',
  ].join(' '), sqliteBinary);
  const rows = JSON.parse(stdout.trim() || '[]') as Array<Record<string, unknown>>;
  return rows.map(rowToStoredArtifact);
}

async function getArtifact(
  dbPath: string,
  sqliteBinary: string,
  options: ArtifactNamespaceOptions & { id: string },
): Promise<StoredArtifact> {
  const namespace = normalizeRequiredStorageName(options.namespace, 'namespace');
  const id = normalizeRequiredStorageName(options.id, 'id');
  const stdout = await runSqliteJson(dbPath, [
    'SELECT id, namespace, path, mime_type AS mimeType, size_bytes AS sizeBytes, sha256,',
    'created_at AS createdAt, expires_at AS expiresAt, source_url AS sourceUrl, source_json AS sourceJson',
    'FROM artifacts',
    `WHERE namespace = ${sqlString(namespace)} AND id = ${sqlString(id)}`,
    'LIMIT 1;',
  ].join(' '), sqliteBinary);
  const rows = JSON.parse(stdout.trim() || '[]') as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row) throw new Error(`artifact not found: ${namespace}/${id}`);
  return rowToStoredArtifact(row);
}

function rowToStoredArtifact(row: Record<string, unknown>): StoredArtifact {
  return {
    id: stringField(row.id),
    namespace: stringField(row.namespace),
    path: stringField(row.path),
    mimeType: stringField(row.mimeType),
    sizeBytes: numberField(row.sizeBytes),
    sha256: stringField(row.sha256),
    createdAt: stringField(row.createdAt),
    ...(typeof row.expiresAt === 'string' ? { expiresAt: row.expiresAt } : {}),
    ...(typeof row.sourceUrl === 'string' ? { sourceUrl: row.sourceUrl } : {}),
    source: parseSource(row.sourceJson),
  };
}

async function addColumnIfMissing(
  dbPath: string,
  tableName: string,
  columnName: string,
  definition: string,
  sqliteBinary: string,
): Promise<void> {
  const stdout = await runSqliteJson(dbPath, `PRAGMA table_info(${tableName});`, sqliteBinary);
  const columns = JSON.parse(stdout.trim() || '[]') as Array<Record<string, unknown>>;
  if (columns.some((column) => column.name === columnName)) return;
  await runSqlite(dbPath, `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`, sqliteBinary);
}

async function deleteArtifact(dbPath: string, namespace: string, id: string, sqliteBinary: string): Promise<void> {
  await runSqlite(dbPath, [
    'DELETE FROM artifacts',
    `WHERE namespace = ${sqlString(namespace)} AND id = ${sqlString(id)};`,
  ].join(' '), sqliteBinary);
}

async function runSqlite(dbPath: string, sql: string, sqliteBinary: string): Promise<string> {
  const { stdout } = await execFileAsync(sqliteBinary, [dbPath, sql], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

async function runSqliteJson(dbPath: string, sql: string, sqliteBinary: string): Promise<string> {
  const { stdout } = await execFileAsync(sqliteBinary, ['-json', dbPath, sql], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

function sqliteAvailable(sqliteBinary: string): boolean {
  const result = spawnSync(sqliteBinary, ['--version'], { stdio: 'ignore' });
  return result.status === 0;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNullable(value: string | undefined): string {
  return value ? sqlString(value) : 'NULL';
}

function normalizeStorageName(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(trimmed)) {
    throw new Error(`${label} must match /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/`);
  }
  return trimmed;
}

function normalizeRequiredStorageName(value: unknown, label: string): string {
  if (value === undefined || value === null || value === '') throw new Error(`${label} is required`);
  return normalizeStorageName(value, label);
}

function normalizeObjectKey(value: unknown): string {
  if (typeof value !== 'string') throw new Error('object key must be a string');
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/.test(trimmed)) {
    throw new Error('object key must match /^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/');
  }
  return trimmed;
}

function composedArtifactProviderId(
  objectStore: ObjectStorePort,
  manifestStore: ArtifactManifestStorePort,
): string {
  return `${objectStore.providerId ?? 'object-store'}+${manifestStore.providerId ?? 'manifest-store'}`;
}

async function probeStore(
  store: ObjectStorePort | ArtifactManifestStorePort,
  input: { resourceId: string; kind: string },
): Promise<ProviderProbeResult> {
  if (!store.probe) {
    return {
      status: 'available',
      providerId: store.providerId,
      evidence: [{ kind: 'provider_probe', message: `${store.providerId ?? input.kind}: probe not implemented` }],
    };
  }
  try {
    return await store.probe(input);
  } catch (error) {
    return {
      status: 'stubbed',
      providerId: store.providerId,
      evidence: [{ kind: 'provider_probe', message: error instanceof Error ? error.message : String(error) }],
    };
  }
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function parseSource(value: unknown): ArtifactSource {
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as ArtifactSource : {};
  } catch {
    return {};
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
