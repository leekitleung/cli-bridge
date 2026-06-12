// v2.5 — Workspace apply store (Approach A: scratch dir, no git).
//
// Manages isolated apply directories under a dedicated apply root.
// Each apply gets its own subdirectory. Strict path containment, caps,
// atomic staging → publish, reversible discard.
// v2.5 ADR-0010: metadata-only pre-apply baseline manifest capture.
//
// No git, no child_process, no spawn. Pure Node fs/path.

import { randomUUID, createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Types ────────────────────────────────────────────────────────

export interface ApplyCaps {
  maxFiles: number;
  maxTotalBytes: number;
}

export const DEFAULT_APPLY_CAPS: ApplyCaps = {
  maxFiles: 200,
  maxTotalBytes: 5 * 1024 * 1024, // 5 MB
};

// v2.5 read-only presentation (ADR-0009): conservative per-file preview byte cap.
export const DEFAULT_PREVIEW_BYTE_CAP = 64 * 1024; // 64 KB

export type ApplyStatus = 'pending' | 'applied' | 'failed' | 'discarded';

export interface ApplyRequest {
  applyId: string;
  projectKey: string;
  teamId: string;
  slotId: string;
  planStepId: string;
  proposedFiles: string[];
  isolatedDirId?: string;
  isolatedDirPath?: string;
  status: ApplyStatus;
  caps: ApplyCaps;
  actor?: string;
  createdAt: number;
  confirmedAt?: number;
  fileCount?: number;
  byteTotal?: number;
  /** v2.5 ADR-0010: metadata-only pre-apply baseline manifest (no raw content). */
  baselineManifest?: BaselineManifest;
}

// ── v2.5 Read-only presentation (ADR-0009) ───────────────────────
//
// Strictly read-only projections over an existing ApplyRequest. No mutation,
// no pre-apply baseline, no diff/classification. Manifest deliberately omits
// `isolatedDirPath` (an absolute host path) and exposes only `isolatedDirId`.

export interface ApplyManifest {
  applyId: string;
  projectKey: string;
  teamId: string;
  slotId: string;
  planStepId: string;
  isolatedDirId?: string;
  status: ApplyStatus;
  fileCount?: number;
  byteTotal?: number;
  caps: ApplyCaps;
  actor?: string;
  createdAt: number;
  confirmedAt?: number;
  /** v2.5 ADR-0010: metadata-only baseline summary (no entries, no content). */
  baselineManifest?: Omit<BaselineManifest, 'entries'>;
}

/** Read-only manifest projection. Never exposes `isolatedDirPath` or content. */
export function toApplyManifest(req: ApplyRequest): ApplyManifest {
  return {
    applyId: req.applyId,
    projectKey: req.projectKey,
    teamId: req.teamId,
    slotId: req.slotId,
    planStepId: req.planStepId,
    isolatedDirId: req.isolatedDirId,
    status: req.status,
    fileCount: req.fileCount,
    byteTotal: req.byteTotal,
    caps: { ...req.caps },
    actor: req.actor,
    createdAt: req.createdAt,
    confirmedAt: req.confirmedAt,
    baselineManifest: req.baselineManifest
      ? { capturedAt: req.baselineManifest.capturedAt, rootRef: req.baselineManifest.rootRef, fileCount: req.baselineManifest.fileCount, readableCount: req.baselineManifest.readableCount, missingCount: req.baselineManifest.missingCount, unreadableCount: req.baselineManifest.unreadableCount, byteTotal: req.baselineManifest.byteTotal }
      : undefined,
  };
}

// Fail-closed result codes mapped to HTTP status by the route layer:
//   not-found → 404, not-applied → 409, invalid-path → 400, file-not-found → 404.
export type ReadFailCode = 'not-found' | 'not-applied' | 'invalid-path' | 'file-not-found';

export type ListAppliedFilesResult =
  | { ok: true; files: { path: string; size: number }[] }
  | { ok: false; code: ReadFailCode; error: string };

export type ReadFilePreviewResult =
  | { ok: true; path: string; size: number; truncated: boolean; content: string }
  | { ok: false; code: ReadFailCode; error: string };

// ── Path containment ─────────────────────────────────────────────

const ESCAPE_SEGMENTS = ['..'];
const FORBIDDEN_PREFIXES = [/^[a-zA-Z]:/, /^\\\\/, /^\/\//]; // drive letters, UNC, protocol-like

/** Normalize and validate a single path. Returns null if invalid/escaping. */
function validatePath(raw: string): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  if (path.isAbsolute(raw)) return null;
  // Reject any path component that is ..
  for (const seg of raw.replace(/\\/g, '/').split('/')) {
    if (seg === '..' || seg === '') return null;
    for (const prefix of FORBIDDEN_PREFIXES) {
      if (prefix.test(seg)) return null;
    }
  }
  // Normalize and re-check
  const normalized = raw.replace(/\\/g, '/');
  for (const seg of normalized.split('/')) {
    if (seg === '..') return null;
  }
  // Check raw for double-backslash or UNC patterns
  if (raw.includes('\\\\') || raw.includes('\\..') || raw.includes('\\/')) return null;
  return normalized;
}

/** Check all paths pass containment; returns validated list or null on first failure. */
export function validateAllPaths(rawPaths: string[]): string[] | null {
  const result: string[] = [];
  for (const p of rawPaths) {
    const validated = validatePath(p);
    if (!validated) return null;
    result.push(validated);
  }
  return result;
}

// ── Store ────────────────────────────────────────────────────────

// ── v2.5 Pre-apply baseline manifest capture (ADR-0010) ─────────
//
// Metadata-only: records path/exists/readable/size/sha256/errorKind.
// Never stores raw baseline content or absolute host paths.

export interface BaselineManifestEntry {
  path: string;
  exists: boolean;
  readable: boolean;
  size?: number;
  sha256?: string;
  errorKind?: 'missing' | 'unreadable' | 'not-file' | 'cap-exceeded' | 'path-escape';
}

export interface BaselineManifest {
  capturedAt: number;
  rootRef: string;
  fileCount: number;
  readableCount: number;
  missingCount: number;
  unreadableCount: number;
  byteTotal: number;
  entries: BaselineManifestEntry[];
}

export interface BaselineCaps {
  maxFiles: number;
  maxTotalBytes: number;
}

export const DEFAULT_BASELINE_CAPS: BaselineCaps = {
  maxFiles: 200,
  maxTotalBytes: 5 * 1024 * 1024, // 5 MB
};

export class WorkspaceApplyStore {
  readonly applyRoot: string;
  private readonly requests = new Map<string, ApplyRequest>();
  private caps: ApplyCaps;
  /** v2.5 ADR-0010: trusted root for pre-apply baseline capture. Absent = disabled. */
  readonly baselineRoot?: string;
  readonly baselineCaps: BaselineCaps;
  /** v2.5 ADR-0010: baseline capture opt-in. Default false. */
  readonly baselineCaptureEnabled: boolean;

  constructor(applyRoot: string, opts?: {
    caps?: ApplyCaps;
    baselineRoot?: string;
    baselineCaps?: BaselineCaps;
    baselineCaptureEnabled?: boolean;
  }) {
    this.applyRoot = path.resolve(applyRoot);
    this.caps = opts?.caps ?? { ...DEFAULT_APPLY_CAPS };
    this.baselineRoot = opts?.baselineRoot ? path.resolve(opts.baselineRoot) : undefined;
    this.baselineCaps = opts?.baselineCaps ?? { ...DEFAULT_BASELINE_CAPS };
    this.baselineCaptureEnabled = opts?.baselineCaptureEnabled ?? false;
  }

  // ── Request lifecycle ──────────────────────────────────────────

  createRequest(params: {
    projectKey: string;
    teamId: string;
    slotId: string;
    planStepId: string;
    proposedFiles: string[];
    actor?: string;
  }): { request: ApplyRequest; error?: undefined } | { request?: undefined; error: string } {
    const existing = Array.from(this.requests.values()).find(
      r => r.slotId === params.slotId && r.planStepId === params.planStepId && r.status !== 'discarded'
    );
    if (existing) return { error: 'An active apply request already exists for this artifact' };

    const applyId = randomUUID();
    const request: ApplyRequest = {
      applyId,
      projectKey: params.projectKey,
      teamId: params.teamId,
      slotId: params.slotId,
      planStepId: params.planStepId,
      proposedFiles: [...params.proposedFiles],
      status: 'pending',
      caps: { ...this.caps },
      actor: params.actor,
      createdAt: Date.now(),
    };
    this.requests.set(applyId, request);
    return { request };
  }

  getRequest(applyId: string): ApplyRequest | undefined {
    return this.requests.get(applyId);
  }

  listByProject(projectKey: string): ApplyRequest[] {
    return Array.from(this.requests.values()).filter(r => r.projectKey === projectKey);
  }

  listByTeam(projectKey: string, teamId: string): ApplyRequest[] {
    return Array.from(this.requests.values()).filter(r => r.projectKey === projectKey && r.teamId === teamId);
  }

  // ── Confirm (gated write) ──────────────────────────────────────

  confirmApply(params: {
    applyId: string;
    files: Record<string, string>;
    actor?: string;
  }): { ok: true; request: ApplyRequest } | { ok: false; error: string } {
    const req = this.requests.get(params.applyId);
    if (!req) return { ok: false, error: 'Apply request not found' };
    if (req.status !== 'pending') return { ok: false, error: `Apply request is ${req.status}, not pending` };

    // ── Input validation: every file value must be a string ──────
    const rawFiles = params.files;
    if (rawFiles === null || typeof rawFiles !== 'object' || Array.isArray(rawFiles)) {
      return { ok: false, error: 'files must be a plain object mapping paths to content strings' };
    }
    for (const [k, v] of Object.entries(rawFiles)) {
      if (typeof v !== 'string') {
        return { ok: false, error: `File "${k}" content must be a string` };
      }
    }

    const fileKeys = Object.keys(params.files);
    const proposedSet = new Set(req.proposedFiles);
    if (fileKeys.length !== req.proposedFiles.length) {
      return { ok: false, error: 'File list does not match artifact proposedFiles' };
    }
    for (const k of fileKeys) {
      if (!proposedSet.has(k)) return { ok: false, error: `File "${k}" not in artifact proposedFiles` };
    }

    // Path containment check.
    const validated = validateAllPaths(fileKeys);
    if (!validated) return { ok: false, error: 'Path containment failed: invalid or escaping path' };

    // Caps check.
    if (validated.length > req.caps.maxFiles) {
      return { ok: false, error: `File count ${validated.length} exceeds cap ${req.caps.maxFiles}` };
    }
    let totalBytes = 0;
    for (const k of fileKeys) {
      totalBytes += Buffer.byteLength(params.files[k], 'utf8');
    }
    if (totalBytes > req.caps.maxTotalBytes) {
      return { ok: false, error: `Total size ${totalBytes} exceeds cap ${req.caps.maxTotalBytes}` };
    }

    // ── v2.5 ADR-0010: Pre-apply baseline manifest capture ──────
    // Must happen BEFORE any isolated directory write.
    if (this.baselineCaptureEnabled) {
      if (!this.baselineRoot) {
        return { ok: false, error: 'Baseline capture is enabled but no trusted root is configured' };
      }
      const captureResult = this.captureBaseline(req.proposedFiles);
      if (!captureResult.ok) {
        return { ok: false, error: 'Baseline capture failed: ' + captureResult.error };
      }
      req.baselineManifest = captureResult.manifest;
    }

    // Generate isolated dir.
    const isolatedDirId = randomUUID();
    const stagingDir = path.join(this.applyRoot, '.staging-' + isolatedDirId);
    const targetDir = path.join(this.applyRoot, isolatedDirId);

    try {
      fs.mkdirSync(this.applyRoot, { recursive: true });
      fs.mkdirSync(stagingDir, { recursive: true });

      for (const [p, content] of Object.entries(params.files)) {
        const idx = fileKeys.indexOf(p);
        const rel = validated[idx];
        const resolvedPath = path.resolve(stagingDir, rel);
        // Double-check containment.
        const resolvedNorm = resolvedPath.replace(/\\/g, '/');
        const stagingNorm = path.resolve(stagingDir).replace(/\\/g, '/');
        if (!resolvedNorm.startsWith(stagingNorm + '/') && resolvedNorm !== stagingNorm) {
          this.cleanup(stagingDir);
          return { ok: false, error: `Path containment violation: ${p}` };
        }
        fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
        fs.writeFileSync(resolvedPath, content, 'utf8');
      }

      fs.renameSync(stagingDir, targetDir);

      req.isolatedDirId = isolatedDirId;
      req.isolatedDirPath = targetDir;
      req.status = 'applied';
      req.confirmedAt = Date.now();
      req.actor = params.actor ?? req.actor;
      req.fileCount = validated.length;
      req.byteTotal = totalBytes;
      this.requests.set(params.applyId, req);

      return { ok: true, request: req };
    } catch (err: unknown) {
      this.cleanup(stagingDir);
      req.status = 'failed';
      this.requests.set(params.applyId, req);
      return { ok: false, error: `Apply write failed: ${(err as Error)?.message ?? 'unknown'}` };
    }
  }

  // ── v2.5 ADR-0010: baseline capture ──────────────────────────
  // Metadata-only: path/exists/readable/size/sha256/errorKind.
  // No raw content. Fail-closed on unreadable/non-regular/cap-exceed/path-escape.
  // Missing proposed files are NOT failures (exists:false, errorKind:'missing').

  private captureBaseline(proposedFiles: string[]): { ok: true; manifest: BaselineManifest } | { ok: false; error: string } {
    const root = this.baselineRoot!;
    const entries: BaselineManifestEntry[] = [];
    let readableCount = 0;
    let missingCount = 0;
    let unreadableCount = 0;
    let byteTotal = 0;
    const fileCount = proposedFiles.length;

    // Caps: file count check.
    if (fileCount > this.baselineCaps.maxFiles) {
      return { ok: false, error: `File count ${fileCount} exceeds baseline cap ${this.baselineCaps.maxFiles}` };
    }

    for (const relPath of proposedFiles) {
      // Path containment + validation.
      const validated = validateAllPaths([relPath]);
      if (!validated) {
        entries.push({ path: relPath, exists: false, readable: false, errorKind: 'path-escape' });
        unreadableCount++;
        continue;
      }
      const resolved = path.resolve(root, validated[0]);
      // Double-check containment.
      const resolvedNorm = resolved.replace(/\\/g, '/');
      const rootNorm = root.replace(/\\/g, '/');
      if (!resolvedNorm.startsWith(rootNorm + '/') && resolvedNorm !== rootNorm) {
        entries.push({ path: relPath, exists: false, readable: false, errorKind: 'path-escape' });
        unreadableCount++;
        continue;
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(resolved);
      } catch {
        // Missing file: not a failure, record metadata.
        entries.push({ path: relPath, exists: false, readable: false, errorKind: 'missing' });
        missingCount++;
        continue;
      }

      if (!stat.isFile()) {
        // Non-regular file → fail-closed (no write).
        return { ok: false, error: `Path "${relPath}" is not a regular file (baseline capture requires regular files only)` };
      }

      let content: Buffer;
      try {
        content = fs.readFileSync(resolved);
      } catch {
        // Unreadable: fail-closed.
        return { ok: false, error: `Cannot read file "${relPath}" (permission denied or locked)` };
      }

      // Caps: byte total check (cumulative across all readable files).
      byteTotal += content.byteLength;
      if (byteTotal > this.baselineCaps.maxTotalBytes) {
        return { ok: false, error: `Baseline total bytes ${byteTotal} exceeds cap ${this.baselineCaps.maxTotalBytes}` };
      }

      const sha256 = createHash('sha256').update(content).digest('hex');
      entries.push({
        path: relPath,
        exists: true,
        readable: true,
        size: stat.size,
        sha256,
      });
      readableCount++;
    }

    return {
      ok: true,
      manifest: {
        capturedAt: Date.now(),
        rootRef: 'runtime-baseline-root',
        fileCount,
        readableCount,
        missingCount,
        unreadableCount,
        byteTotal,
        entries,
      },
    };
  }

  // ── Discard (reversible) ───────────────────────────────────────

  discard(applyId: string): { ok: true; request: ApplyRequest } | { ok: false; error: string } {
    const req = this.requests.get(applyId);
    if (!req) return { ok: false, error: 'Apply request not found' };
    if (req.status === 'discarded') return { ok: false, error: 'Already discarded' };

    if (req.isolatedDirPath) {
      this.cleanup(req.isolatedDirPath);
    }
    req.status = 'discarded';
    this.requests.set(applyId, req);
    return { ok: true, request: req };
  }

  // ── Helpers ────────────────────────────────────────────────────

  private cleanup(dir: string): void {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch { /* best-effort */ }
  }

  // ── v2.5 Read-only presentation (ADR-0009) ────────────────────
  //
  // Pure read-only fs helpers over an existing applied isolated directory.
  // No mutation, no spawn, no git, no baseline capture, no diff.

  /**
   * List the repository-relative paths and byte sizes of the files written
   * into the isolated directory for an applied request. Read-only.
   */
  listAppliedFiles(applyId: string): ListAppliedFilesResult {
    const req = this.requests.get(applyId);
    if (!req) return { ok: false, code: 'not-found', error: 'Apply request not found' };
    if (req.status !== 'applied' || !req.isolatedDirPath) {
      return { ok: false, code: 'not-applied', error: `Apply request is ${req.status}, not applied` };
    }
    const root = path.resolve(req.isolatedDirPath);
    const files: { path: string; size: number }[] = [];
    const walk = (dir: string): void => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(abs);
        } else if (entry.isFile()) {
          const rel = path.relative(root, abs).replace(/\\/g, '/');
          files.push({ path: rel, size: fs.statSync(abs).size });
        }
      }
    };
    try {
      walk(root);
    } catch {
      return { ok: false, code: 'not-found', error: 'Isolated directory not readable' };
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { ok: true, files };
  }

  /**
   * Read a size-capped preview of a single file within the isolated directory.
   * Path is validated with the same containment logic as apply (`validateAllPaths`)
   * and double-checked to resolve inside the isolated root. Read-only; performs
   * no redaction (the route layer redacts before returning).
   */
  readFilePreview(applyId: string, relPath: string, cap = DEFAULT_PREVIEW_BYTE_CAP): ReadFilePreviewResult {
    const req = this.requests.get(applyId);
    if (!req) return { ok: false, code: 'not-found', error: 'Apply request not found' };
    if (req.status !== 'applied' || !req.isolatedDirPath) {
      return { ok: false, code: 'not-applied', error: `Apply request is ${req.status}, not applied` };
    }
    const validatedList = validateAllPaths([relPath]);
    if (!validatedList) return { ok: false, code: 'invalid-path', error: 'Invalid or escaping path' };
    const validated = validatedList[0];

    const root = path.resolve(req.isolatedDirPath);
    const resolved = path.resolve(root, validated);
    // Double-check containment after resolution (defense in depth).
    const resolvedNorm = resolved.replace(/\\/g, '/');
    const rootNorm = root.replace(/\\/g, '/');
    if (!resolvedNorm.startsWith(rootNorm + '/') && resolvedNorm !== rootNorm) {
      return { ok: false, code: 'invalid-path', error: 'Path escapes the isolated directory' };
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      return { ok: false, code: 'file-not-found', error: 'File not found in isolated directory' };
    }
    if (!stat.isFile()) return { ok: false, code: 'file-not-found', error: 'Not a file' };

    const buf = fs.readFileSync(resolved);
    let truncated = false;
    let contentBuf = buf;
    if (buf.byteLength > cap) {
      contentBuf = buf.subarray(0, cap);
      truncated = true;
    }
    return { ok: true, path: validated, size: stat.size, truncated, content: contentBuf.toString('utf8') };
  }

  getCaps(): ApplyCaps {
    return { ...this.caps };
  }
}
