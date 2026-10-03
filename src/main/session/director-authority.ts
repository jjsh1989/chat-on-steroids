/**
 * Process-local Director authority layered on top of strict trusted-chat admission.
 *
 * Trusted Chats answers "which conversation may use local tools". Director answers a different
 * question: "does this exact session still have fresh human authority after external content was
 * observed?" Only an explicit user-authored desktop input can create a pending Director lease,
 * and only the outbox's exact delivery receipt can confirm it. External observations revoke a
 * confirmed lease but can never grant or expand one.
 *
 * The state is intentionally process-local for this prototype. Strict mode therefore fails closed
 * after restart until a fresh delivered local instruction establishes a new lease.
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

function copyState(state: AuthorityState): AuthorityState {
  return { ...state, sources: [...state.sources] };
}

function stateFor(sessionId: string): AuthorityState {
  return authority.get(sessionId) ?? emptyState();
}

/**
 * Explicit human input accepted by the desktop outbox becomes a pending candidate.
 * A newer input revokes any older lease immediately, even before delivery.
 */
export function noteDirectorInstruction(
  sessionId: string | null | undefined,
  inputId: string,
  acceptedAt = Date.now()
): void {
  if (!sessionId) return;
  const normalized = clean(inputId, 80);
  if (!normalized) return;
  const current = authority.get(sessionId);
  if (current?.directorInputId === normalized && current.acceptedAt !== null) return;
  authority.set(sessionId, {
    directorInputId: normalized,
    acceptedAt,
    authorizedAt: null,
    taintedAt: null,
    sources: []
  });
}

export function pendingDirectorInstruction(sessionId: string | null | undefined): string | null {
  if (!sessionId) return null;
  const current = stateFor(sessionId);
  return current.directorInputId && current.authorizedAt === null ? current.directorInputId : null;
}

/** Promote only the exact pending human input after the outbox proves delivery. */
export function confirmDirectorInstruction(
  sessionId: string | null | undefined,
  inputId: string,
  deliveredAt = Date.now()
): boolean {
  if (!sessionId) return false;
  const current = stateFor(sessionId);
  const normalized = clean(inputId, 80);
  if (!normalized || current.directorInputId !== normalized || current.authorizedAt !== null ||
      (current.acceptedAt !== null && deliveredAt < current.acceptedAt)) return false;
  authority.set(sessionId, {
    ...current,
    authorizedAt: deliveredAt,
    taintedAt: null,
    sources: []
  });
  return true;
}

/** External/browser/plugin observations inform reasoning but revoke mutation authority. */
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
    : [...current.sources];
  authority.set(sessionId, {
    ...current,
    taintedAt: current.taintedAt ?? at,
    sources
  });
}

/** Strict-mode mutation requires a delivered human lease newer than every external observation. */
export function directorMutationDecision(sessionId: string | null | undefined): DirectorAuthorityDecision {
  if (!sessionId) {
    return { allowed: false, reason: 'missing_director_instruction', ...emptyState() };
  }
  const current = stateFor(sessionId);
  if (current.directorInputId && current.authorizedAt === null) {
    return { allowed: false, reason: 'director_instruction_pending_delivery', ...copyState(current) };
  }
  if (current.taintedAt !== null && (current.authorizedAt === null || current.taintedAt >= current.authorizedAt)) {
    return { allowed: false, reason: 'untrusted_external_content', ...copyState(current) };
  }
  if (!current.directorInputId || current.authorizedAt === null) {
    return { allowed: false, reason: 'missing_director_instruction', ...copyState(current) };
  }
  return { allowed: true, reason: null, ...copyState(current) };
}

/** Metadata-only bounded journal; raw attacker-controlled content is never accepted here. */
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

export function directorSecurityJournal(): DirectorSecurityEvent[] {
  return journal.map(event => ({ ...event, sources: [...event.sources] }));
}

export function resetDirectorAuthorityForTests(): void {
  authority.clear();
  journal.length = 0;
  nextEventId = 1;
}
