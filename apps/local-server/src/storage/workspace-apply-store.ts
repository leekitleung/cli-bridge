// v2.5 — Workspace apply store (Approach A: scratch dir, no git).
//
// Manages isolated apply directories under a dedicated apply root.
// Each apply gets its own subdirectory. Strict path containment, caps,
// atomic staging → publish, reversible discard.
//
// No git, no child_process, no spawn. Pure Node fs/path.

import { randomUUID } from 'node:crypto';
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
}

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

export class WorkspaceApplyStore {
  readonly applyRoot: string;
  private readonly requests = new Map<string, ApplyRequest>();
  private caps: ApplyCaps;

  constructor(applyRoot: string, caps?: ApplyCaps) {
    this.applyRoot = path.resolve(applyRoot);
    this.caps = caps ?? { ...DEFAULT_APPLY_CAPS };
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

  getCaps(): ApplyCaps {
    return { ...this.caps };
  }
}
