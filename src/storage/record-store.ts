import { execFile, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { paths } from '../config/paths';
import type { RecordStorePort } from '../providers/ports';
import type { ResourceOverride } from '../resources/catalog';

const execFileAsync = promisify(execFile);

export type RuntimeRecordData = Record<string, unknown>;

export interface RuntimeRecord {
  namespace: string;
  tableName: string;
  id: string;
  data: RuntimeRecordData;
  metadata: RuntimeRecordData;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeRecordUpsertInput {
  namespace: string;
  tableName: string;
  id: string;
  data: RuntimeRecordData;
  metadata?: RuntimeRecordData;
}

export interface RuntimeRecordGetInput {
  namespace: string;
  tableName: string;
  id: string;
}

export interface RuntimeRecordQueryInput {
  namespace: string;
  tableName: string;
  limit?: number;
}

export type RuntimeRecordDeleteInput = RuntimeRecordGetInput;

export interface SqliteRecordStoreOptions {
  recordDbPath?: string;
  sqliteBinary?: string;
  now?: () => Date;
  providerId?: string;
}

export function createSqliteRecordStore(options: SqliteRecordStoreOptions = {}): RecordStorePort {
  const recordDbPath = options.recordDbPath ?? paths.recordStoreDb;
  const sqliteBinary = options.sqliteBinary ?? 'sqlite3';
  const now = options.now ?? (() => new Date());
  const providerId = options.providerId ?? 'local-sqlite-record';

  return {
    providerId,

    async probe() {
      const recordDir = dirname(recordDbPath);
      const sqliteReady = sqliteAvailable(sqliteBinary);
      const dirReady = existsSync(recordDir);
      return {
        status: dirReady && sqliteReady ? 'available' : 'stubbed',
        providerId,
        evidence: [{
          kind: 'provider_probe',
          message: dirReady && sqliteReady
            ? `recordDbPath=${recordDbPath}`
            : `record readiness failed: dir=${dirReady ? 'ok' : 'missing'} sqlite=${sqliteReady ? 'ok' : 'missing'}`,
        }],
      };
    },

    async upsert(input) {
      await ensureRecordStore(recordDbPath, sqliteBinary);
      const namespace = normalizeRequiredStorageName(input.namespace, 'namespace');
      const tableName = normalizeRequiredStorageName(input.tableName, 'tableName');
      const id = normalizeRequiredStorageName(input.id, 'id');
      const data = normalizeJsonObject(input.data, 'data');
      const metadata = normalizeOptionalJsonObject(input.metadata, 'metadata');
      const existing = await maybeGetRecord(recordDbPath, sqliteBinary, { namespace, tableName, id });
      const timestamp = now().toISOString();
      const record: RuntimeRecord = {
        namespace,
        tableName,
        id,
        data,
        metadata,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      await upsertRecord(recordDbPath, sqliteBinary, record);
      return record;
    },

    async get(input) {
      await ensureRecordStore(recordDbPath, sqliteBinary);
      return getRecord(recordDbPath, sqliteBinary, {
        namespace: normalizeRequiredStorageName(input.namespace, 'namespace'),
        tableName: normalizeRequiredStorageName(input.tableName, 'tableName'),
        id: normalizeRequiredStorageName(input.id, 'id'),
      });
    },

    async query(input) {
      await ensureRecordStore(recordDbPath, sqliteBinary);
      return queryRecords(recordDbPath, sqliteBinary, {
        namespace: normalizeRequiredStorageName(input.namespace, 'namespace'),
        tableName: normalizeRequiredStorageName(input.tableName, 'tableName'),
        limit: normalizeLimit(input.limit),
      });
    },

    async delete(input) {
      await ensureRecordStore(recordDbPath, sqliteBinary);
      const lookup = {
        namespace: normalizeRequiredStorageName(input.namespace, 'namespace'),
        tableName: normalizeRequiredStorageName(input.tableName, 'tableName'),
        id: normalizeRequiredStorageName(input.id, 'id'),
      };
      const record = await getRecord(recordDbPath, sqliteBinary, lookup);
      await deleteRecord(recordDbPath, sqliteBinary, lookup);
      return record;
    },
  };
}

export function localRecordStoreResourceOverride(
  options: Pick<SqliteRecordStoreOptions, 'recordDbPath' | 'sqliteBinary'> = {},
): ResourceOverride | undefined {
  const recordDbPath = options.recordDbPath ?? paths.recordStoreDb;
  const sqliteBinary = options.sqliteBinary ?? 'sqlite3';
  if (!existsSync(dirname(recordDbPath)) || !sqliteAvailable(sqliteBinary)) return undefined;
  return {
    id: 'storage.record_store',
    status: 'available',
    provider: 'local-sqlite-record',
  };
}

async function ensureRecordStore(dbPath: string, sqliteBinary: string): Promise<void> {
  await mkdir(dirname(dbPath), { recursive: true, mode: 0o700 });
  await runSqlite(dbPath, [
    'CREATE TABLE IF NOT EXISTS records (',
    'namespace TEXT NOT NULL,',
    'table_name TEXT NOT NULL,',
    'id TEXT NOT NULL,',
    'data_json TEXT NOT NULL,',
    'metadata_json TEXT NOT NULL,',
    'created_at TEXT NOT NULL,',
    'updated_at TEXT NOT NULL,',
    'PRIMARY KEY (namespace, table_name, id)',
    ');',
  ].join(' '), sqliteBinary);
  await chmod(dbPath, 0o600).catch((error: unknown) => {
    if (!isNotFound(error)) throw error;
  });
}

async function upsertRecord(dbPath: string, sqliteBinary: string, record: RuntimeRecord): Promise<void> {
  await runSqlite(dbPath, [
    'INSERT INTO records',
    '(namespace, table_name, id, data_json, metadata_json, created_at, updated_at)',
    'VALUES (',
    [
      sqlString(record.namespace),
      sqlString(record.tableName),
      sqlString(record.id),
      sqlString(JSON.stringify(record.data)),
      sqlString(JSON.stringify(record.metadata)),
      sqlString(record.createdAt),
      sqlString(record.updatedAt),
    ].join(', '),
    ')',
    'ON CONFLICT(namespace, table_name, id) DO UPDATE SET',
    'data_json = excluded.data_json,',
    'metadata_json = excluded.metadata_json,',
    'updated_at = excluded.updated_at;',
  ].join(' '), sqliteBinary);
}

async function getRecord(
  dbPath: string,
  sqliteBinary: string,
  input: RuntimeRecordGetInput,
): Promise<RuntimeRecord> {
  const record = await maybeGetRecord(dbPath, sqliteBinary, input);
  if (!record) throw new Error(`record not found: ${input.namespace}/${input.tableName}/${input.id}`);
  return record;
}

async function maybeGetRecord(
  dbPath: string,
  sqliteBinary: string,
  input: RuntimeRecordGetInput,
): Promise<RuntimeRecord | undefined> {
  const stdout = await runSqliteJson(dbPath, [
    'SELECT namespace, table_name AS tableName, id, data_json AS dataJson, metadata_json AS metadataJson,',
    'created_at AS createdAt, updated_at AS updatedAt',
    'FROM records',
    `WHERE namespace = ${sqlString(input.namespace)} AND table_name = ${sqlString(input.tableName)} AND id = ${sqlString(input.id)}`,
    'LIMIT 1;',
  ].join(' '), sqliteBinary);
  const rows = JSON.parse(stdout.trim() || '[]') as Array<Record<string, unknown>>;
  return rows[0] ? rowToRecord(rows[0]) : undefined;
}

async function queryRecords(
  dbPath: string,
  sqliteBinary: string,
  input: RuntimeRecordQueryInput,
): Promise<RuntimeRecord[]> {
  const stdout = await runSqliteJson(dbPath, [
    'SELECT namespace, table_name AS tableName, id, data_json AS dataJson, metadata_json AS metadataJson,',
    'created_at AS createdAt, updated_at AS updatedAt',
    'FROM records',
    `WHERE namespace = ${sqlString(input.namespace)} AND table_name = ${sqlString(input.tableName)}`,
    'ORDER BY created_at ASC, id ASC',
    `LIMIT ${normalizeLimit(input.limit)};`,
  ].join(' '), sqliteBinary);
  const rows = JSON.parse(stdout.trim() || '[]') as Array<Record<string, unknown>>;
  return rows.map(rowToRecord);
}

async function deleteRecord(
  dbPath: string,
  sqliteBinary: string,
  input: RuntimeRecordGetInput,
): Promise<void> {
  await runSqlite(dbPath, [
    'DELETE FROM records',
    `WHERE namespace = ${sqlString(input.namespace)} AND table_name = ${sqlString(input.tableName)} AND id = ${sqlString(input.id)};`,
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

function rowToRecord(row: Record<string, unknown>): RuntimeRecord {
  return {
    namespace: stringField(row.namespace),
    tableName: stringField(row.tableName),
    id: stringField(row.id),
    data: parseJsonObject(row.dataJson),
    metadata: parseJsonObject(row.metadataJson),
    createdAt: stringField(row.createdAt),
    updatedAt: stringField(row.updatedAt),
  };
}

function normalizeRequiredStorageName(value: unknown, label: string): string {
  if (value === undefined || value === null || value === '') throw new Error(`${label} is required`);
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(trimmed)) {
    throw new Error(`${label} must match /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/`);
  }
  return trimmed;
}

function normalizeJsonObject(value: unknown, label: string): RuntimeRecordData {
  if (value === undefined) throw new Error(`${label} is required`);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as RuntimeRecordData;
}

function normalizeOptionalJsonObject(value: unknown, label: string): RuntimeRecordData {
  if (value === undefined) return {};
  return normalizeJsonObject(value, label);
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return 100;
  if (!Number.isFinite(value) || value < 0) throw new Error('limit must be a finite number greater than or equal to 0');
  return Math.min(Math.floor(value), 1000);
}

function parseJsonObject(value: unknown): RuntimeRecordData {
  if (typeof value !== 'string') return {};
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as RuntimeRecordData : {};
}

function sqliteAvailable(sqliteBinary: string): boolean {
  const result = spawnSync(sqliteBinary, ['--version'], { stdio: 'ignore' });
  return result.status === 0;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
