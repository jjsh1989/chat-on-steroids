/**
 * Process-local Director authority for consequential agent actions.
 *
 * A local desktop input is the only event in this module that can grant/renew authority.
 * External/browser observations can revoke that authority for subsequent mutations, but can
 * never grant it. Restart intentionally forgets grants and therefore fails closed until the
 * user sends another local instruction.
 *
 * This is deliberately semantic-free: it does not try to decide whether page text is a prompt
 * injection. It enforces provenance. A blocked transition can later be reviewed as an injection
 * candidate without allowing attacker-controlled text to rewrite the policy itself.
 */

export type DirectorAuthorityReason = 'missing_director_instruction' | 'untrusted_external_content';

export interface DirectorAuthorityDecision {
  allowed: boolean;
  reason: DirectorAuthorityReason | null;
  directorInputId: string | null;
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
  authorizedAt: number | null;
  taintedAt: number | null;
  sources: string[];
}

interface AuthorityState {
  directorInputId: string | null;
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

function stateFor(sessionId: string): AuthorityState {
  return authority.get(sessionId) ?? {
    directorInputId: null,
    authorizedAt: null,
    taintedAt: null,
    sources: []
  };
}

/** A user-authored instruction accepted by the local desktop client grants a fresh lease. */
export function noteDirectorInstruction(sessionId: string | null | undefined, inputId: string, at = Date.now()): void {
  if (!sessionId) return;
  authority.set(sessionId, {
    directorInputId: clean(inputId, 80),
    authorizedAt: at,
    taintedAt: null,
    sources: []
  });
}

/** External observations may inform reasoning, but they revoke mutation authority until renewed. */
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

/** Only a fresh Director lease with no later untrusted observation may authorize mutation. */
export function directorMutationDecision(sessionId: string | null | undefined): DirectorAuthorityDecision {
  if (!sessionId) {
    return { allowed: false, reason: 'missing_director_instruction', directorInputId: null, authorizedAt: null, taintedAt: null, sources: [] };
  }
  const current = stateFor(sessionId);
  if (!current.directorInputId || current.authorizedAt === null) {
    return { allowed: false, reason: 'missing_director_instruction', ...current };
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
