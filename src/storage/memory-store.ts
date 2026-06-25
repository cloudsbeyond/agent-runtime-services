import { execFile, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { paths } from '../config/paths';
import type { MemoryStorePort } from '../providers/ports';
import type { ResourceOverride } from '../resources/catalog';

const execFileAsync = promisify(execFile);

export type RuntimeMemoryJson = Record<string, unknown>;

export interface RuntimeMemoryReference {
  kind: string;
  id: string;
}

export interface RuntimeMemoryEvidenceRef extends RuntimeMemoryReference {
  range?: RuntimeMemoryJson;
}

export interface RuntimeMemoryEvent {
  namespace: string;
  id: string;
  source: RuntimeMemoryJson;
  actor: RuntimeMemoryJson;
  payload: RuntimeMemoryJson;
  artifact?: RuntimeMemoryReference;
  metadata: RuntimeMemoryJson;
  policy: RuntimeMemoryJson;
  occurredAt: string;
  appendedAt: string;
  contentHash: string;
}

export interface RuntimeMemoryEventAppendInput {
  namespace: string;
  id?: string;
  source: RuntimeMemoryJson;
  actor?: RuntimeMemoryJson;
  payload?: RuntimeMemoryJson;
  artifact?: RuntimeMemoryReference;
  metadata?: RuntimeMemoryJson;
  policy?: RuntimeMemoryJson;
  occurredAt?: string;
}

export interface RuntimeMemoryEventGetInput {
  namespace: string;
  id: string;
}

export interface RuntimeMemoryEventListInput {
  namespace: string;
  limit?: number;
}

export type RuntimeMemoryClaimStatus = 'unverified' | 'active' | 'superseded' | 'rejected' | 'stale';

export interface RuntimeMemoryClaim {
  namespace: string;
  id: string;
  kind: string;
  subject: RuntimeMemoryJson;
  statement: string;
  evidence: RuntimeMemoryEvidenceRef[];
  confidence: number;
  status: RuntimeMemoryClaimStatus;
  freshness: string;
  owner: RuntimeMemoryJson;
  policy: RuntimeMemoryJson;
  metadata: RuntimeMemoryJson;
  supersedes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeMemoryClaimUpsertInput {
  namespace: string;
  id: string;
  kind: string;
  subject: RuntimeMemoryJson;
  statement: string;
  evidence: RuntimeMemoryEvidenceRef[];
  confidence: number;
  status?: RuntimeMemoryClaimStatus;
  freshness?: string;
  owner?: RuntimeMemoryJson;
  policy?: RuntimeMemoryJson;
  metadata?: RuntimeMemoryJson;
  supersedes?: string[];
}

export interface RuntimeMemoryClaimGetInput {
  namespace: string;
  id: string;
}

export interface RuntimeMemoryClaimQueryInput {
  namespace: string;
  kind?: string;
  status?: RuntimeMemoryClaimStatus;
  limit?: number;
}

export interface RuntimeMemoryRelation {
  namespace: string;
  id: string;
  type: string;
  from: RuntimeMemoryReference;
  to: RuntimeMemoryReference;
  evidence: RuntimeMemoryEvidenceRef[];
  metadata: RuntimeMemoryJson;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeMemoryRelationUpsertInput {
  namespace: string;
  id: string;
  type: string;
  from: RuntimeMemoryReference;
  to: RuntimeMemoryReference;
  evidence?: RuntimeMemoryEvidenceRef[];
  metadata?: RuntimeMemoryJson;
}

export interface RuntimeMemoryRelationQueryInput {
  namespace: string;
  from?: RuntimeMemoryReference;
  to?: RuntimeMemoryReference;
  type?: string;
  limit?: number;
}

export interface SqliteMemoryStoreOptions {
  memoryDbPath?: string;
  sqliteBinary?: string;
  now?: () => Date;
  providerId?: string;
}

export function createSqliteMemoryStore(options: SqliteMemoryStoreOptions = {}): MemoryStorePort {
  const memoryDbPath = options.memoryDbPath ?? paths.memoryStoreDb;
  const sqliteBinary = options.sqliteBinary ?? 'sqlite3';
  const now = options.now ?? (() => new Date());
  const providerId = options.providerId ?? 'local-sqlite-memory';

  return {
    providerId,

    async probe() {
      const memoryDir = dirname(memoryDbPath);
      const sqliteReady = sqliteAvailable(sqliteBinary);
      const dirReady = existsSync(memoryDir);
      return {
        status: dirReady && sqliteReady ? 'available' : 'stubbed',
        providerId,
        evidence: [{
          kind: 'provider_probe',
          message: dirReady && sqliteReady
            ? `memoryDbPath=${memoryDbPath}`
            : `memory readiness failed: dir=${dirReady ? 'ok' : 'missing'} sqlite=${sqliteReady ? 'ok' : 'missing'}`,
        }],
      };
    },

    async appendEvent(input) {
      await ensureMemoryStore(memoryDbPath, sqliteBinary);
      const namespace = normalizeRequiredStorageName(input.namespace, 'namespace');
      const id = input.id ? normalizeRequiredStorageName(input.id, 'id') : generatedId('event', now());
      const source = normalizeEventSource(input.source);
      const occurredAt = normalizeOptionalDateString(input.occurredAt, 'occurredAt') ?? now().toISOString();
      const event: RuntimeMemoryEvent = {
        namespace,
        id,
        source,
        actor: normalizeOptionalJsonObject(input.actor, 'actor'),
        payload: normalizeOptionalJsonObject(input.payload, 'payload'),
        ...(input.artifact ? { artifact: normalizeReference(input.artifact, 'artifact') } : {}),
        metadata: normalizeOptionalJsonObject(input.metadata, 'metadata'),
        policy: normalizeOptionalJsonObject(input.policy, 'policy'),
        occurredAt,
        appendedAt: now().toISOString(),
        contentHash: '',
      };
      event.contentHash = createHash('sha256').update(stableJson({
        source: event.source,
        actor: event.actor,
        payload: event.payload,
        artifact: event.artifact,
        metadata: event.metadata,
        policy: event.policy,
        occurredAt: event.occurredAt,
      })).digest('hex');
      await insertEvent(memoryDbPath, sqliteBinary, event);
      return event;
    },

    async getEvent(input) {
      await ensureMemoryStore(memoryDbPath, sqliteBinary);
      return getEvent(memoryDbPath, sqliteBinary, {
        namespace: normalizeRequiredStorageName(input.namespace, 'namespace'),
        id: normalizeRequiredStorageName(input.id, 'id'),
      });
    },

    async listEvents(input) {
      await ensureMemoryStore(memoryDbPath, sqliteBinary);
      return listEvents(memoryDbPath, sqliteBinary, {
        namespace: normalizeRequiredStorageName(input.namespace, 'namespace'),
        limit: normalizeLimit(input.limit),
      });
    },

    async upsertClaim(input) {
      await ensureMemoryStore(memoryDbPath, sqliteBinary);
      const namespace = normalizeRequiredStorageName(input.namespace, 'namespace');
      const id = normalizeRequiredStorageName(input.id, 'id');
      const existing = await maybeGetClaim(memoryDbPath, sqliteBinary, { namespace, id });
      const timestamp = now().toISOString();
      const claim: RuntimeMemoryClaim = {
        namespace,
        id,
        kind: normalizeRequiredStorageName(input.kind, 'kind'),
        subject: normalizeJsonObject(input.subject, 'subject'),
        statement: normalizeRequiredString(input.statement, 'statement'),
        evidence: normalizeEvidenceRefs(input.evidence),
        confidence: normalizeConfidence(input.confidence),
        status: normalizeClaimStatusInput(input.status),
        freshness: normalizeOptionalString(input.freshness, 'freshness') ?? 'active',
        owner: normalizeOptionalJsonObject(input.owner, 'owner'),
        policy: normalizeOptionalJsonObject(input.policy, 'policy'),
        metadata: normalizeOptionalJsonObject(input.metadata, 'metadata'),
        supersedes: normalizeStringArray(input.supersedes, 'supersedes'),
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      await upsertClaim(memoryDbPath, sqliteBinary, claim);
      return claim;
    },

    async getClaim(input) {
      await ensureMemoryStore(memoryDbPath, sqliteBinary);
      return getClaim(memoryDbPath, sqliteBinary, {
        namespace: normalizeRequiredStorageName(input.namespace, 'namespace'),
        id: normalizeRequiredStorageName(input.id, 'id'),
      });
    },

    async queryClaims(input) {
      await ensureMemoryStore(memoryDbPath, sqliteBinary);
      return queryClaims(memoryDbPath, sqliteBinary, {
        namespace: normalizeRequiredStorageName(input.namespace, 'namespace'),
        ...(input.kind !== undefined ? { kind: normalizeRequiredStorageName(input.kind, 'kind') } : {}),
        ...(input.status !== undefined ? { status: normalizeClaimStatusInput(input.status) } : {}),
        limit: normalizeLimit(input.limit),
      });
    },

    async upsertRelation(input) {
      await ensureMemoryStore(memoryDbPath, sqliteBinary);
      const namespace = normalizeRequiredStorageName(input.namespace, 'namespace');
      const id = normalizeRequiredStorageName(input.id, 'id');
      const existing = await maybeGetRelation(memoryDbPath, sqliteBinary, { namespace, id });
      const timestamp = now().toISOString();
      const relation: RuntimeMemoryRelation = {
        namespace,
        id,
        type: normalizeRequiredStorageName(input.type, 'type'),
        from: normalizeReference(input.from, 'from'),
        to: normalizeReference(input.to, 'to'),
        evidence: normalizeEvidenceRefs(input.evidence ?? []),
        metadata: normalizeOptionalJsonObject(input.metadata, 'metadata'),
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      await upsertRelation(memoryDbPath, sqliteBinary, relation);
      return relation;
    },

    async queryRelations(input) {
      await ensureMemoryStore(memoryDbPath, sqliteBinary);
      return queryRelations(memoryDbPath, sqliteBinary, {
        namespace: normalizeRequiredStorageName(input.namespace, 'namespace'),
        ...(input.from !== undefined ? { from: normalizeReference(input.from, 'from') } : {}),
        ...(input.to !== undefined ? { to: normalizeReference(input.to, 'to') } : {}),
        ...(input.type !== undefined ? { type: normalizeRequiredStorageName(input.type, 'type') } : {}),
        limit: normalizeLimit(input.limit),
      });
    },
  };
}

export function localMemoryStoreResourceOverride(
  options: Pick<SqliteMemoryStoreOptions, 'memoryDbPath' | 'sqliteBinary'> = {},
): ResourceOverride | undefined {
  const memoryDbPath = options.memoryDbPath ?? paths.memoryStoreDb;
  const sqliteBinary = options.sqliteBinary ?? 'sqlite3';
  if (!existsSync(dirname(memoryDbPath)) || !sqliteAvailable(sqliteBinary)) return undefined;
  return {
    id: 'storage.memory_store',
    status: 'available',
    provider: 'local-sqlite-memory',
  };
}

async function ensureMemoryStore(dbPath: string, sqliteBinary: string): Promise<void> {
  await mkdir(dirname(dbPath), { recursive: true, mode: 0o700 });
  await runSqlite(dbPath, [
    'CREATE TABLE IF NOT EXISTS memory_events (',
    'namespace TEXT NOT NULL,',
    'id TEXT NOT NULL,',
    'source_json TEXT NOT NULL,',
    'actor_json TEXT NOT NULL,',
    'payload_json TEXT NOT NULL,',
    'artifact_json TEXT,',
    'metadata_json TEXT NOT NULL,',
    'policy_json TEXT NOT NULL,',
    'occurred_at TEXT NOT NULL,',
    'appended_at TEXT NOT NULL,',
    'content_hash TEXT NOT NULL,',
    'PRIMARY KEY (namespace, id)',
    ');',
    'CREATE TABLE IF NOT EXISTS memory_claims (',
    'namespace TEXT NOT NULL,',
    'id TEXT NOT NULL,',
    'kind TEXT NOT NULL,',
    'subject_json TEXT NOT NULL,',
    'statement TEXT NOT NULL,',
    'evidence_json TEXT NOT NULL,',
    'confidence REAL NOT NULL,',
    'status TEXT NOT NULL,',
    'freshness TEXT NOT NULL,',
    'owner_json TEXT NOT NULL,',
    'policy_json TEXT NOT NULL,',
    'metadata_json TEXT NOT NULL,',
    'supersedes_json TEXT NOT NULL,',
    'created_at TEXT NOT NULL,',
    'updated_at TEXT NOT NULL,',
    'PRIMARY KEY (namespace, id)',
    ');',
    'CREATE TABLE IF NOT EXISTS memory_relations (',
    'namespace TEXT NOT NULL,',
    'id TEXT NOT NULL,',
    'type TEXT NOT NULL,',
    'from_json TEXT NOT NULL,',
    'from_kind TEXT NOT NULL,',
    'from_id TEXT NOT NULL,',
    'to_json TEXT NOT NULL,',
    'to_kind TEXT NOT NULL,',
    'to_id TEXT NOT NULL,',
    'evidence_json TEXT NOT NULL,',
    'metadata_json TEXT NOT NULL,',
    'created_at TEXT NOT NULL,',
    'updated_at TEXT NOT NULL,',
    'PRIMARY KEY (namespace, id)',
    ');',
  ].join(' '), sqliteBinary);
  await chmod(dbPath, 0o600).catch((error: unknown) => {
    if (!isNotFound(error)) throw error;
  });
}

async function insertEvent(dbPath: string, sqliteBinary: string, event: RuntimeMemoryEvent): Promise<void> {
  await runSqlite(dbPath, [
    'INSERT INTO memory_events',
    '(namespace, id, source_json, actor_json, payload_json, artifact_json, metadata_json, policy_json, occurred_at, appended_at, content_hash)',
    'VALUES (',
    [
      sqlString(event.namespace),
      sqlString(event.id),
      sqlString(JSON.stringify(event.source)),
      sqlString(JSON.stringify(event.actor)),
      sqlString(JSON.stringify(event.payload)),
      sqlNullable(event.artifact ? JSON.stringify(event.artifact) : undefined),
      sqlString(JSON.stringify(event.metadata)),
      sqlString(JSON.stringify(event.policy)),
      sqlString(event.occurredAt),
      sqlString(event.appendedAt),
      sqlString(event.contentHash),
    ].join(', '),
    ');',
  ].join(' '), sqliteBinary);
}

async function getEvent(dbPath: string, sqliteBinary: string, input: RuntimeMemoryEventGetInput): Promise<RuntimeMemoryEvent> {
  const stdout = await runSqliteJson(dbPath, [
    'SELECT namespace, id, source_json AS sourceJson, actor_json AS actorJson, payload_json AS payloadJson,',
    'artifact_json AS artifactJson, metadata_json AS metadataJson, policy_json AS policyJson,',
    'occurred_at AS occurredAt, appended_at AS appendedAt, content_hash AS contentHash',
    'FROM memory_events',
    `WHERE namespace = ${sqlString(input.namespace)} AND id = ${sqlString(input.id)}`,
    'LIMIT 1;',
  ].join(' '), sqliteBinary);
  const rows = JSON.parse(stdout.trim() || '[]') as Array<Record<string, unknown>>;
  if (!rows[0]) throw new Error(`memory event not found: ${input.namespace}/${input.id}`);
  return rowToEvent(rows[0]);
}

async function listEvents(dbPath: string, sqliteBinary: string, input: RuntimeMemoryEventListInput): Promise<RuntimeMemoryEvent[]> {
  const stdout = await runSqliteJson(dbPath, [
    'SELECT namespace, id, source_json AS sourceJson, actor_json AS actorJson, payload_json AS payloadJson,',
    'artifact_json AS artifactJson, metadata_json AS metadataJson, policy_json AS policyJson,',
    'occurred_at AS occurredAt, appended_at AS appendedAt, content_hash AS contentHash',
    'FROM memory_events',
    `WHERE namespace = ${sqlString(input.namespace)}`,
    'ORDER BY rowid ASC',
    `LIMIT ${normalizeLimit(input.limit)};`,
  ].join(' '), sqliteBinary);
  const rows = JSON.parse(stdout.trim() || '[]') as Array<Record<string, unknown>>;
  return rows.map(rowToEvent);
}

async function upsertClaim(dbPath: string, sqliteBinary: string, claim: RuntimeMemoryClaim): Promise<void> {
  await runSqlite(dbPath, [
    'INSERT INTO memory_claims',
    '(namespace, id, kind, subject_json, statement, evidence_json, confidence, status, freshness, owner_json, policy_json, metadata_json, supersedes_json, created_at, updated_at)',
    'VALUES (',
    [
      sqlString(claim.namespace),
      sqlString(claim.id),
      sqlString(claim.kind),
      sqlString(JSON.stringify(claim.subject)),
      sqlString(claim.statement),
      sqlString(JSON.stringify(claim.evidence)),
      String(claim.confidence),
      sqlString(claim.status),
      sqlString(claim.freshness),
      sqlString(JSON.stringify(claim.owner)),
      sqlString(JSON.stringify(claim.policy)),
      sqlString(JSON.stringify(claim.metadata)),
      sqlString(JSON.stringify(claim.supersedes)),
      sqlString(claim.createdAt),
      sqlString(claim.updatedAt),
    ].join(', '),
    ')',
    'ON CONFLICT(namespace, id) DO UPDATE SET',
    'kind = excluded.kind,',
    'subject_json = excluded.subject_json,',
    'statement = excluded.statement,',
    'evidence_json = excluded.evidence_json,',
    'confidence = excluded.confidence,',
    'status = excluded.status,',
    'freshness = excluded.freshness,',
    'owner_json = excluded.owner_json,',
    'policy_json = excluded.policy_json,',
    'metadata_json = excluded.metadata_json,',
    'supersedes_json = excluded.supersedes_json,',
    'updated_at = excluded.updated_at;',
  ].join(' '), sqliteBinary);
}

async function getClaim(dbPath: string, sqliteBinary: string, input: RuntimeMemoryClaimGetInput): Promise<RuntimeMemoryClaim> {
  const claim = await maybeGetClaim(dbPath, sqliteBinary, input);
  if (!claim) throw new Error(`memory claim not found: ${input.namespace}/${input.id}`);
  return claim;
}

async function maybeGetClaim(dbPath: string, sqliteBinary: string, input: RuntimeMemoryClaimGetInput): Promise<RuntimeMemoryClaim | undefined> {
  const stdout = await runSqliteJson(dbPath, claimSelectSql([
    `namespace = ${sqlString(input.namespace)}`,
    `id = ${sqlString(input.id)}`,
  ], 'LIMIT 1'), sqliteBinary);
  const rows = JSON.parse(stdout.trim() || '[]') as Array<Record<string, unknown>>;
  return rows[0] ? rowToClaim(rows[0]) : undefined;
}

async function queryClaims(dbPath: string, sqliteBinary: string, input: RuntimeMemoryClaimQueryInput): Promise<RuntimeMemoryClaim[]> {
  const predicates = [`namespace = ${sqlString(input.namespace)}`];
  if (input.kind) predicates.push(`kind = ${sqlString(input.kind)}`);
  if (input.status) predicates.push(`status = ${sqlString(input.status)}`);
  const stdout = await runSqliteJson(dbPath, claimSelectSql(predicates, `ORDER BY created_at ASC, id ASC LIMIT ${normalizeLimit(input.limit)}`), sqliteBinary);
  const rows = JSON.parse(stdout.trim() || '[]') as Array<Record<string, unknown>>;
  return rows.map(rowToClaim);
}

function claimSelectSql(predicates: string[], suffix: string): string {
  return [
    'SELECT namespace, id, kind, subject_json AS subjectJson, statement, evidence_json AS evidenceJson, confidence,',
    'status, freshness, owner_json AS ownerJson, policy_json AS policyJson, metadata_json AS metadataJson,',
    'supersedes_json AS supersedesJson, created_at AS createdAt, updated_at AS updatedAt',
    'FROM memory_claims',
    `WHERE ${predicates.join(' AND ')}`,
    `${suffix};`,
  ].join(' ');
}

async function upsertRelation(dbPath: string, sqliteBinary: string, relation: RuntimeMemoryRelation): Promise<void> {
  await runSqlite(dbPath, [
    'INSERT INTO memory_relations',
    '(namespace, id, type, from_json, from_kind, from_id, to_json, to_kind, to_id, evidence_json, metadata_json, created_at, updated_at)',
    'VALUES (',
    [
      sqlString(relation.namespace),
      sqlString(relation.id),
      sqlString(relation.type),
      sqlString(JSON.stringify(relation.from)),
      sqlString(relation.from.kind),
      sqlString(relation.from.id),
      sqlString(JSON.stringify(relation.to)),
      sqlString(relation.to.kind),
      sqlString(relation.to.id),
      sqlString(JSON.stringify(relation.evidence)),
      sqlString(JSON.stringify(relation.metadata)),
      sqlString(relation.createdAt),
      sqlString(relation.updatedAt),
    ].join(', '),
    ')',
    'ON CONFLICT(namespace, id) DO UPDATE SET',
    'type = excluded.type,',
    'from_json = excluded.from_json,',
    'from_kind = excluded.from_kind,',
    'from_id = excluded.from_id,',
    'to_json = excluded.to_json,',
    'to_kind = excluded.to_kind,',
    'to_id = excluded.to_id,',
    'evidence_json = excluded.evidence_json,',
    'metadata_json = excluded.metadata_json,',
    'updated_at = excluded.updated_at;',
  ].join(' '), sqliteBinary);
}

async function maybeGetRelation(
  dbPath: string,
  sqliteBinary: string,
  input: { namespace: string; id: string },
): Promise<RuntimeMemoryRelation | undefined> {
  const stdout = await runSqliteJson(dbPath, relationSelectSql([
    `namespace = ${sqlString(input.namespace)}`,
    `id = ${sqlString(input.id)}`,
  ], 'LIMIT 1'), sqliteBinary);
  const rows = JSON.parse(stdout.trim() || '[]') as Array<Record<string, unknown>>;
  return rows[0] ? rowToRelation(rows[0]) : undefined;
}

async function queryRelations(dbPath: string, sqliteBinary: string, input: RuntimeMemoryRelationQueryInput): Promise<RuntimeMemoryRelation[]> {
  const predicates = [`namespace = ${sqlString(input.namespace)}`];
  if (input.type) predicates.push(`type = ${sqlString(input.type)}`);
  if (input.from) {
    predicates.push(`from_kind = ${sqlString(input.from.kind)}`);
    predicates.push(`from_id = ${sqlString(input.from.id)}`);
  }
  if (input.to) {
    predicates.push(`to_kind = ${sqlString(input.to.kind)}`);
    predicates.push(`to_id = ${sqlString(input.to.id)}`);
  }
  const stdout = await runSqliteJson(
    dbPath,
    relationSelectSql(predicates, `ORDER BY created_at ASC, id ASC LIMIT ${normalizeLimit(input.limit)}`),
    sqliteBinary,
  );
  const rows = JSON.parse(stdout.trim() || '[]') as Array<Record<string, unknown>>;
  return rows.map(rowToRelation);
}

function relationSelectSql(predicates: string[], suffix: string): string {
  return [
    'SELECT namespace, id, type, from_json AS fromJson, to_json AS toJson, evidence_json AS evidenceJson,',
    'metadata_json AS metadataJson, created_at AS createdAt, updated_at AS updatedAt',
    'FROM memory_relations',
    `WHERE ${predicates.join(' AND ')}`,
    `${suffix};`,
  ].join(' ');
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

function rowToEvent(row: Record<string, unknown>): RuntimeMemoryEvent {
  const artifact = parseOptionalJsonObject(row.artifactJson);
  return {
    namespace: stringField(row.namespace),
    id: stringField(row.id),
    source: parseJsonObject(row.sourceJson),
    actor: parseJsonObject(row.actorJson),
    payload: parseJsonObject(row.payloadJson),
    ...(artifact ? { artifact: artifact as unknown as RuntimeMemoryReference } : {}),
    metadata: parseJsonObject(row.metadataJson),
    policy: parseJsonObject(row.policyJson),
    occurredAt: stringField(row.occurredAt),
    appendedAt: stringField(row.appendedAt),
    contentHash: stringField(row.contentHash),
  };
}

function rowToClaim(row: Record<string, unknown>): RuntimeMemoryClaim {
  return {
    namespace: stringField(row.namespace),
    id: stringField(row.id),
    kind: stringField(row.kind),
    subject: parseJsonObject(row.subjectJson),
    statement: stringField(row.statement),
    evidence: parseJsonArray(row.evidenceJson) as RuntimeMemoryEvidenceRef[],
    confidence: numberField(row.confidence),
    status: memoryClaimStatus(row.status),
    freshness: stringField(row.freshness),
    owner: parseJsonObject(row.ownerJson),
    policy: parseJsonObject(row.policyJson),
    metadata: parseJsonObject(row.metadataJson),
    supersedes: parseJsonArray(row.supersedesJson).filter((item): item is string => typeof item === 'string'),
    createdAt: stringField(row.createdAt),
    updatedAt: stringField(row.updatedAt),
  };
}

function rowToRelation(row: Record<string, unknown>): RuntimeMemoryRelation {
  return {
    namespace: stringField(row.namespace),
    id: stringField(row.id),
    type: stringField(row.type),
    from: parseJsonObject(row.fromJson) as unknown as RuntimeMemoryReference,
    to: parseJsonObject(row.toJson) as unknown as RuntimeMemoryReference,
    evidence: parseJsonArray(row.evidenceJson) as RuntimeMemoryEvidenceRef[],
    metadata: parseJsonObject(row.metadataJson),
    createdAt: stringField(row.createdAt),
    updatedAt: stringField(row.updatedAt),
  };
}

function normalizeRequiredStorageName(value: unknown, label: string): string {
  if (value === undefined || value === null || value === '') throw new Error(`${label} is required`);
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(trimmed)) {
    throw new Error(`${label} must match /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/`);
  }
  return trimmed;
}

function normalizeRequiredString(value: unknown, label: string): string {
  if (value === undefined || value === null || value === '') throw new Error(`${label} is required`);
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  if (!value.trim()) throw new Error(`${label} is required`);
  return value;
}

function normalizeOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return normalizeRequiredString(value, label);
}

function normalizeJsonObject(value: unknown, label: string): RuntimeMemoryJson {
  if (value === undefined) throw new Error(`${label} is required`);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as RuntimeMemoryJson;
}

function normalizeOptionalJsonObject(value: unknown, label: string): RuntimeMemoryJson {
  if (value === undefined) return {};
  return normalizeJsonObject(value, label);
}

function normalizeReference(value: RuntimeMemoryReference | undefined, label: string, allowedExtraFields: string[] = []): RuntimeMemoryReference {
  if (!value || typeof value !== 'object') throw new Error(`${label} is required`);
  if ('namespace' in value) throw new Error(`${label}.namespace is not supported; use the top-level namespace`);
  for (const key of Object.keys(value)) {
    if (key !== 'kind' && key !== 'id' && !allowedExtraFields.includes(key)) {
      throw new Error(`${label}.${key} is not supported`);
    }
  }
  return {
    kind: normalizeRequiredStorageName(value.kind, `${label}.kind`),
    id: normalizeRequiredStorageName(value.id, `${label}.id`),
  };
}

function normalizeEventSource(value: unknown): RuntimeMemoryJson {
  const source = normalizeJsonObject(value, 'source');
  const kind = (source as { kind?: unknown }).kind;
  const ref = (source as { ref?: unknown }).ref;
  normalizeRequiredStorageName(kind, 'source.kind');
  normalizeRequiredString(ref, 'source.ref');
  return source;
}

function normalizeEvidenceRefs(value: RuntimeMemoryEvidenceRef[]): RuntimeMemoryEvidenceRef[] {
  if (!Array.isArray(value)) throw new Error('evidence must be an array');
  return value.map((item, index) => ({
    ...normalizeReference(item, `evidence[${index}]`, ['range']),
    ...(item.range ? { range: normalizeJsonObject(item.range, `evidence[${index}].range`) } : {}),
  }));
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('confidence must be between 0 and 1');
  return value;
}

function normalizeStringArray(value: string[] | undefined, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value;
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return 100;
  if (!Number.isFinite(value) || value < 0) throw new Error('limit must be a finite number greater than or equal to 0');
  return Math.min(Math.floor(value), 1000);
}

function normalizeOptionalDateString(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (!value.trim()) throw new Error(`${label} must be a valid date string`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date string`);
  return date.toISOString();
}

function generatedId(prefix: string, now: Date): string {
  return `${prefix}-${now.toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}

function parseJsonObject(value: unknown): RuntimeMemoryJson {
  if (typeof value !== 'string') return {};
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as RuntimeMemoryJson : {};
}

function parseOptionalJsonObject(value: unknown): RuntimeMemoryJson | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return parseJsonObject(value);
}

function parseJsonArray(value: unknown): unknown[] {
  if (typeof value !== 'string') return [];
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed : [];
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function memoryClaimStatus(value: unknown): RuntimeMemoryClaimStatus {
  if (
    value === 'unverified'
    || value === 'active'
    || value === 'superseded'
    || value === 'rejected'
    || value === 'stale'
  ) return value;
  return 'unverified';
}

function normalizeClaimStatusInput(value: RuntimeMemoryClaimStatus | undefined): RuntimeMemoryClaimStatus {
  if (value === undefined) return 'unverified';
  if (
    value === 'unverified'
    || value === 'active'
    || value === 'superseded'
    || value === 'rejected'
    || value === 'stale'
  ) return value;
  throw new Error('status must be one of unverified, active, superseded, rejected, stale');
}

function sqliteAvailable(sqliteBinary: string): boolean {
  const result = spawnSync(sqliteBinary, ['--version'], { stdio: 'ignore' });
  return result.status === 0;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNullable(value: string | undefined): string {
  return value === undefined ? 'NULL' : sqlString(value);
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}
