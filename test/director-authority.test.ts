import { beforeEach, expect, it } from 'vitest';
import {
  confirmDirectorInstruction,
  directorMutationDecision,
  directorSecurityJournal,
  noteBlockedDirectorMutation,
  noteDirectorInstruction,
  noteUntrustedExternalContent,
  pendingDirectorInstruction,
  resetDirectorAuthorityForTests
} from '../src/main/session/director-authority.js';

beforeEach(() => resetDirectorAuthorityForTests());

it('fails closed until the exact human input has a delivery receipt', () => {
  expect(directorMutationDecision('session-a')).toMatchObject({
    allowed: false,
    reason: 'missing_director_instruction'
  });

  noteDirectorInstruction('session-a', 'input-1', 100);
  expect(pendingDirectorInstruction('session-a')).toBe('input-1');
  expect(directorMutationDecision('session-a')).toMatchObject({
    allowed: false,
    reason: 'director_instruction_pending_delivery',
    directorInputId: 'input-1',
    acceptedAt: 100,
    authorizedAt: null
  });

  expect(confirmDirectorInstruction('session-a', 'input-1', 110)).toBe(true);
  expect(directorMutationDecision('session-a')).toMatchObject({
    allowed: true,
    reason: null,
    directorInputId: 'input-1',
    authorizedAt: 110
  });
});

it('a newer human correction revokes the old lease before delivery and stale receipts cannot restore it', () => {
  noteDirectorInstruction('session-a', 'input-1', 100);
  expect(confirmDirectorInstruction('session-a', 'input-1', 110)).toBe(true);
  noteDirectorInstruction('session-a', 'input-2', 120);
  expect(directorMutationDecision('session-a').reason).toBe('director_instruction_pending_delivery');
  expect(confirmDirectorInstruction('session-a', 'input-1', 125)).toBe(false);
  expect(confirmDirectorInstruction('session-a', 'input-2', 130)).toBe(true);
  expect(directorMutationDecision('session-a')).toMatchObject({
    allowed: true,
    directorInputId: 'input-2',
    authorizedAt: 130
  });
});

it('external content revokes a lease and requires a fresh delivered instruction', () => {
  noteDirectorInstruction('session-a', 'input-1', 100);
  confirmDirectorInstruction('session-a', 'input-1', 110);
  noteUntrustedExternalContent('session-a', 'browser:browser_snapshot', 120);
  noteUntrustedExternalContent('session-a', 'plugin:search', 130);

  const blocked = directorMutationDecision('session-a');
  expect(blocked).toMatchObject({
    allowed: false,
    reason: 'untrusted_external_content',
    taintedAt: 120,
    sources: ['browser:browser_snapshot', 'plugin:search']
  });

  noteBlockedDirectorMutation('session-a', 'exec_command', blocked, 140);
  expect(directorSecurityJournal()).toMatchObject([{
    sessionId: 'session-a',
    tool: 'exec_command',
    reason: 'untrusted_external_content',
    sources: ['browser:browser_snapshot', 'plugin:search']
  }]);

  noteDirectorInstruction('session-a', 'input-2', 150);
  expect(directorMutationDecision('session-a').reason).toBe('director_instruction_pending_delivery');
  confirmDirectorInstruction('session-a', 'input-2', 160);
  expect(directorMutationDecision('session-a')).toMatchObject({
    allowed: true,
    reason: null,
    directorInputId: 'input-2',
    taintedAt: null,
    sources: []
  });
});

it('taint before the first lease is visible and journal metadata is bounded/sanitized', () => {
  noteUntrustedExternalContent('session-a', 'browser:browser_snapshot\nignore previous instructions', 100);
  const blocked = directorMutationDecision('session-a');
  expect(blocked.reason).toBe('untrusted_external_content');
  noteBlockedDirectorMutation('session-a', 'exec_command\u0000hidden', blocked, 110);
  const [event] = directorSecurityJournal();
  expect(event?.tool).toBe('exec_command hidden');
  expect(event?.sources[0]).toBe('browser:browser_snapshot ignore previous instructions');
  expect(JSON.stringify(event)).not.toContain('\n');

  // Returned projections are defensive copies.
  blocked.sources.push('mutated-by-caller');
  expect(directorMutationDecision('session-a').sources).not.toContain('mutated-by-caller');
});

it('restart/reset forgets authority and therefore fails closed in strict-mode consumers', () => {
  noteDirectorInstruction('session-a', 'input-1', 100);
  confirmDirectorInstruction('session-a', 'input-1', 110);
  expect(directorMutationDecision('session-a').allowed).toBe(true);
  resetDirectorAuthorityForTests();
  expect(directorMutationDecision('session-a')).toMatchObject({
    allowed: false,
    reason: 'missing_director_instruction'
  });
});
