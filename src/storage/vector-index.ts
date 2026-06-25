import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { Bool, Field, Float64, Utf8 } from 'apache-arrow';
import * as lancedb from '@lancedb/lancedb';
import { paths } from '../config/paths';
import type { ResourceOverride } from '../resources/catalog';

export interface VectorIndexMetadata {
  [key: string]: unknown;
}

export interface VectorIndexRecord {
  id: string;
  embedding: number[];
  content: string;
  metadata?: VectorIndexMetadata;
}

export type VectorMetadataFilterValue = string | number | boolean;

export interface VectorMetadataFilter {
  [key: string]: VectorMetadataFilterValue;
}

export interface VectorSearchFilter {
  metadata?: VectorMetadataFilter;
}

export interface VectorSearchResult extends VectorIndexRecord {
  score: number;
  createdAt: string;
  updatedAt: string;
  metadata: VectorIndexMetadata;
}

export interface VectorSearchOptions {
  limit?: number;
  tableName: string;
  filter?: VectorSearchFilter;
}

export interface VectorIndexOperationOptions {
  tableName: string;
}

export interface LocalVectorIndex {
  upsert(record: VectorIndexRecord, options: VectorIndexOperationOptions): Promise<void>;
  search(queryEmbedding: number[], options: VectorSearchOptions): Promise<VectorSearchResult[]>;
}

export interface LocalVectorIndexOptions {
  vectorDir?: string;
  now?: () => Date;
}

export function createVectorIndex(options: LocalVectorIndexOptions = {}): LocalVectorIndex {
  return createLanceDbVectorIndex(options);
}

export function createLanceDbVectorIndex(options: LocalVectorIndexOptions = {}): LocalVectorIndex {
  const vectorDir = options.vectorDir ?? paths.vectorDir;
  const now = options.now ?? (() => new Date());

  return {
    async upsert(record, operationOptions) {
      validateEmbedding(record.embedding);
      const tableName = tableNameForOperation(operationOptions);
      const timestamp = now().toISOString();
      const row = lanceRow(record, timestamp);
      const { table, created } = await openOrCreateLanceTable(vectorDir, tableName, row);
      if (created) return;
      await ensureMetadataFilterColumns(table, row);
      await table.delete(`id = ${sqlString(record.id)}`);
      await table.add([row]);
    },

    async search(queryEmbedding, options) {
      validateEmbedding(queryEmbedding);
      const tableName = tableNameForOperation(options);
      const filter = normalizeVectorSearchFilter(options.filter);
      const limit = normalizeLimit(options.limit);
      if (limit === 0) return [];
      const table = await openLanceTableIfExists(vectorDir, tableName);
      if (!table) return [];
      const query = table
        .vectorSearch(queryEmbedding)
        .column('vector')
        .distanceType('cosine');
      const where = filter ? await metadataFilterWhere(table, filter) : undefined;
      if (where === NO_FILTER_MATCH) return [];
      if (where) query.where(where);
      const rows = await query
        .limit(limit)
        .toArray();
      return rows.map(lanceSearchResult);
    },
  };
}

export function normalizeVectorSearchFilter(filter: VectorSearchFilter | undefined): VectorSearchFilter | undefined {
  if (filter === undefined) return undefined;
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) throw new Error('filter must be an object');
  const filterKeys = Object.keys(filter);
  const unsupported = filterKeys.filter((key) => key !== 'metadata');
  if (unsupported.length > 0) throw new Error(`filter only supports metadata; unsupported keys: ${unsupported.join(', ')}`);
  if (filter.metadata === undefined) return undefined;
  if (!filter.metadata || typeof filter.metadata !== 'object' || Array.isArray(filter.metadata)) {
    throw new Error('filter.metadata must be an object');
  }

  const metadata: VectorMetadataFilter = {};
  for (const [key, value] of Object.entries(filter.metadata)) {
    if (!key) throw new Error('filter.metadata keys must be non-empty');
    if (!isVectorMetadataFilterValue(value)) {
      throw new Error('filter.metadata values must be string, number, or boolean');
    }
    metadata[key] = value;
  }
  return Object.keys(metadata).length > 0 ? { metadata } : undefined;
}

const NO_FILTER_MATCH = Symbol('NO_FILTER_MATCH');

function tableNameForOperation(options: Partial<VectorIndexOperationOptions> | undefined): string {
  if (options?.tableName === undefined || options.tableName === null || options.tableName === '') throw new Error('tableName is required');
  return normalizeStorageName(options.tableName, 'tableName');
}

export function localVectorIndexResourceOverride(
  options: Pick<LocalVectorIndexOptions, 'vectorDir'> = {},
): ResourceOverride | undefined {
  const vectorDir = options.vectorDir ?? paths.vectorDir;
  if (!existsSync(vectorDir)) return undefined;
  const provider = lanceDbAvailable() ? 'local-lancedb' : 'local-vector-dir';
  return {
    id: 'storage.vector_index',
    status: 'available',
    provider,
  };
}

async function openOrCreateLanceTable(
  vectorDir: string,
  tableName: string,
  firstRow: Record<string, unknown>,
): Promise<{ table: lancedb.Table; created: boolean }> {
  await mkdir(vectorDir, { recursive: true, mode: 0o700 });
  const db = await lancedb.connect(vectorDir);
  const names = await db.tableNames();
  if (!names.includes(tableName)) {
    return {
      table: await db.createTable(tableName, [firstRow], { mode: 'create', existOk: true }),
      created: true,
    };
  }
  return {
    table: await db.openTable(tableName),
    created: false,
  };
}

async function openLanceTableIfExists(vectorDir: string, tableName: string): Promise<lancedb.Table | undefined> {
  if (!existsSync(vectorDir)) return undefined;
  const db = await lancedb.connect(vectorDir);
  const names = await db.tableNames();
  if (!names.includes(tableName)) return undefined;
  return db.openTable(tableName);
}

function lanceRow(record: VectorIndexRecord, timestamp: string): Record<string, unknown> {
  return {
    id: record.id,
    content: record.content,
    vector: record.embedding,
    metadata_json: JSON.stringify(record.metadata ?? {}),
    ...metadataFilterColumns(record.metadata),
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function lanceSearchResult(row: Record<string, unknown>): VectorSearchResult {
  const distance = typeof row._distance === 'number' ? row._distance : 1;
  return {
    id: stringField(row.id),
    content: stringField(row.content),
    embedding: numberArrayField(row.vector),
    metadata: parseMetadata(row.metadata_json),
    createdAt: stringField(row.created_at),
    updatedAt: stringField(row.updated_at),
    score: 1 - distance,
  };
}

function lanceDbAvailable(): boolean {
  return typeof lancedb.connect === 'function';
}

function isVectorMetadataFilterValue(value: unknown): value is VectorMetadataFilterValue {
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  return typeof value === 'number' && Number.isFinite(value);
}

function metadataFilterColumns(metadata: VectorIndexMetadata | undefined): Record<string, unknown> {
  if (!metadata) return {};
  const columns: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!isVectorMetadataFilterValue(value)) continue;
    columns[metadataColumnName(key, value)] = value;
  }
  return columns;
}

async function ensureMetadataFilterColumns(table: lancedb.Table, row: Record<string, unknown>): Promise<void> {
  const schema = await table.schema();
  const existing = new Set(schema.fields.map((field) => field.name));
  const fields: Field[] = [];
  for (const [name, value] of Object.entries(row)) {
    if (!name.startsWith('meta_') || existing.has(name)) continue;
    fields.push(new Field(name, metadataColumnType(value), true));
  }
  if (fields.length > 0) await table.addColumns(fields);
}

async function metadataFilterWhere(
  table: lancedb.Table,
  filter: VectorSearchFilter,
): Promise<string | typeof NO_FILTER_MATCH | undefined> {
  if (!filter.metadata) return undefined;
  const schema = await table.schema();
  const existing = new Set(schema.fields.map((field) => field.name));
  const predicates: string[] = [];
  for (const [key, value] of Object.entries(filter.metadata)) {
    const column = metadataColumnName(key, value);
    if (!existing.has(column)) return NO_FILTER_MATCH;
    predicates.push(`${column} = ${sqlLiteral(value)}`);
  }
  return predicates.length > 0 ? predicates.join(' AND ') : undefined;
}

function metadataColumnName(key: string, value: VectorMetadataFilterValue): string {
  const typeCode = typeof value === 'string' ? 's' : typeof value === 'number' ? 'n' : 'b';
  return `meta_${typeCode}_${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
}

function metadataColumnType(value: unknown): Utf8 | Float64 | Bool {
  if (typeof value === 'string') return new Utf8();
  if (typeof value === 'number') return new Float64();
  return new Bool();
}

function sqlLiteral(value: VectorMetadataFilterValue): string {
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function validateEmbedding(embedding: unknown): void {
  if (!Array.isArray(embedding) || embedding.length === 0 || embedding.some((value) => !Number.isFinite(value))) {
    throw new Error('embedding must contain finite numbers');
  }
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return 10;
  if (!Number.isFinite(value) || value < 0) throw new Error('limit must be a finite number greater than or equal to 0');
  if (value === 0) return 0;
  return Math.max(1, Math.floor(value));
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function normalizeStorageName(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(trimmed)) {
    throw new Error(`${label} must match /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/`);
  }
  return trimmed;
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberArrayField(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
  }
  if (
    ArrayBuffer.isView(value)
    && !(value instanceof DataView)
    && typeof (value as { length?: unknown }).length === 'number'
  ) {
    return Array.from(value as unknown as ArrayLike<number>).filter((item) => Number.isFinite(item));
  }
  if (isReadableVector(value)) {
    const numbers: number[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const item = value.get(index);
      if (typeof item === 'number' && Number.isFinite(item)) numbers.push(item);
    }
    return numbers;
  }
  return [];
}

function isReadableVector(value: unknown): value is { length: number; get(index: number): unknown } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { length?: unknown; get?: unknown };
  const length = candidate.length;
  return typeof length === 'number' && Number.isSafeInteger(length) && length >= 0 && typeof candidate.get === 'function';
}

function parseMetadata(value: unknown): VectorIndexMetadata {
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as VectorIndexMetadata : {};
  } catch {
    return {};
  }
}
