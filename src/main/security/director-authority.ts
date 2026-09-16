/**
 * Process-local Director authority for consequential agent actions.
 *
 * A local desktop input is the only event in this module that may become authority, but local
 * admission alone is deliberately insufficient. The accepted input remains pending until the
 * existing outbox proves ChatGPT received that exact input. External/browser observations can
 * revoke confirmed authority for subsequent mutations, but can never grant it. Restart forgets
 * all grants and therefore fails closed until a fresh local instruction is delivered again.
 *
 * This is deliberately semantic-free: it does not try to decide whether page text is a prompt
 * injection. It enforces provenance. A blocked transition can later be reviewed as an injection
 * candidate without allowing attacker-controlled text to rewrite the policy itself.
 */

export type DirectorAuthorityReason =
  | 'missing_director_instruction'
  | 'director_instruction_pending_delivery'
  | 'untrusted_external_content';

export interface DirectorAuthorityDecision {
  allowed: boolean;
  reason: DirectorAuthorityReason | null;
  directorInputId: string | null;
  acceptedAt: number | null;
  authorizedAt: number | null;
  taintedAt: number | null;
  sources: string[];
}

export interface DirectorSecurityEvent {
  id: number;
  sessionId: string;
  tool: string;
  reason: DirectorAuthorityReason;
  at: number;
  directorInputId: string | null;
  acceptedAt: number | null;
  authorizedAt: number | null;
  taintedAt: number | null;
  sources: string[];
}

interface AuthorityState {
  directorInputId: string | null;
  acceptedAt: number | null;
  authorizedAt: number | null;
  taintedAt: number | null;
  sources: string[];
}

const authority = new Map<string, AuthorityState>();
const journal: DirectorSecurityEvent[] = [];
const MAX_SOURCES = 16;
const MAX_JOURNAL = 500;
let nextEventId = 1;

function clean(value: string, max = 160): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function emptyState(): AuthorityState {
  return {
    directorInputId: null,
    acceptedAt: null,
    authorizedAt: null,
    taintedAt: null,
    sources: []
  };
}

function stateFor(sessionId: string): AuthorityState {
  return authority.get(sessionId) ?? emptyState();
}

/**
 * A user-authored instruction accepted by the local desktop client becomes a pending candidate.
 * It also revokes any older grant immediately: a still-running old turn cannot keep spending the
 * previous roadmap while a user correction is waiting to reach ChatGPT.
 */
export function noteDirectorInstruction(sessionId: string | null | undefined, inputId: string, at = Date.now()): void {
  if (!sessionId) return;
  authority.set(sessionId, {
    directorInputId: clean(inputId, 80),
    acceptedAt: at,
    authorizedAt: null,
    taintedAt: null,
    sources: []
  });
}

/** The pending local input id, if this session is waiting for exact delivery proof. */
export function pendingDirectorInstruction(sessionId: string | null | undefined): string | null {
  if (!sessionId) return null;
  const current = stateFor(sessionId);
  return current.directorInputId && current.authorizedAt === null ? current.directorInputId : null;
}

/**
 * Promote only the exact pending local input after the existing outbox proves receipt. A stale
 * receipt cannot resurrect an older instruction after the user has already sent a replacement.
 */
export function confirmDirectorInstruction(
  sessionId: string | null | undefined,
  inputId: string,
  deliveredAt = Date.now()
): boolean {
  if (!sessionId) return false;
  const current = stateFor(sessionId);
  const normalized = clean(inputId, 80);
  if (!normalized || current.directorInputId !== normalized || current.authorizedAt !== null) return false;
  authority.set(sessionId, {
    ...current,
    authorizedAt: deliveredAt,
    taintedAt: null,
    sources: []
  });
  return true;
}

/** External observations may inform reasoning, but they revoke confirmed mutation authority. */
export function noteUntrustedExternalContent(
  sessionId: string | null | undefined,
  source: string,
  at = Date.now()
): void {
  if (!sessionId) return;
  const current = stateFor(sessionId);
  const normalized = clean(source);
  const sources = normalized && !current.sources.includes(normalized)
    ? [...current.sources, normalized].slice(-MAX_SOURCES)
    : current.sources;
  authority.set(sessionId, {
    ...current,
    taintedAt: current.taintedAt ?? at,
    sources
  });
}

/** Only a delivered Director lease with no later untrusted observation may authorize mutation. */
export function directorMutationDecision(sessionId: string | null | undefined): DirectorAuthorityDecision {
  if (!sessionId) {
    return { allowed: false, reason: 'missing_director_instruction', ...emptyState() };
  }
  const current = stateFor(sessionId);
  if (!current.directorInputId) {
    return { allowed: false, reason: 'missing_director_instruction', ...current };
  }
  if (current.authorizedAt === null) {
    return { allowed: false, reason: 'director_instruction_pending_delivery', ...current };
  }
  if (current.taintedAt !== null && current.taintedAt >= current.authorizedAt) {
    return { allowed: false, reason: 'untrusted_external_content', ...current };
  }
  return { allowed: true, reason: null, ...current };
}

/**
 * Bounded metadata-only quarantine. Raw page text is intentionally not accepted here: an
 * attacker cannot persist instructions merely by triggering the defensive journal.
 */
export function noteBlockedDirectorMutation(
  sessionId: string | null | undefined,
  tool: string,
  decision: DirectorAuthorityDecision,
  at = Date.now()
): void {
  if (!sessionId || !decision.reason) return;
  journal.push({
    id: nextEventId++,
    sessionId,
    tool: clean(tool, 100),
    reason: decision.reason,
    at,
    directorInputId: decision.directorInputId,
    acceptedAt: decision.acceptedAt,
    authorizedAt: decision.authorizedAt,
    taintedAt: decision.taintedAt,
    sources: [...decision.sources]
  });
  if (journal.length > MAX_JOURNAL) journal.splice(0, journal.length - MAX_JOURNAL);
}

/** Read-only projection for a future Security Journal UI and regression-corpus review. */
export function directorSecurityJournal(): DirectorSecurityEvent[] {
  return journal.map(event => ({ ...event, sources: [...event.sources] }));
}

export function resetDirectorAuthorityForTests(): void {
  authority.clear();
  journal.length = 0;
  nextEventId = 1;
}
