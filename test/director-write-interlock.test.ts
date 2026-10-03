import { beforeEach, expect, it, vi } from 'vitest';
import type { SurfaceRegistrar, ToolResult } from '../src/main/mcp/kernel.js';

const state = vi.hoisted(() => ({
  strict: true,
  caller: { sessionId: 'session-a', conversationId: 'chat-a', requestId: 'request-a' } as any,
  proofs: new Map<string, { sessionId: string; conversationId: string }>()
}));

vi.mock('../src/main/mcp/call-context.js', () => ({ currentCall: () => ({ caller: state.caller }) }));
vi.mock('../src/main/session/correlation.js', () => ({
  requestCorrelation: (id: string) => state.proofs.get(id) ?? null
}));
vi.mock('../src/main/session/conversation-access.js', () => ({
  strictChatAllowlistEnabled: () => state.strict
}));
vi.mock('../src/main/session/director-receipt.js', () => ({
  refreshDirectorReceipt: async () => undefined
}));
vi.mock('../src/main/session/director-owner.js',()=>({directorAuthoritySessionId:async(sessionId:string)=>sessionId ?? null}));
vi.mock('../src/main/mcp/kernel.js', () => ({
  failIdentity: (text: string) => ({ isError: true, content: [{ type: 'text', text }] })
}));

import { withDirectorWriteInterlock } from '../src/main/mcp/director-write-interlock.js';
import {
  confirmDirectorInstruction,
  directorMutationDecision,
  noteDirectorInstruction,
  resetDirectorAuthorityForTests
} from '../src/main/session/director-authority.js';

const ok = (): ToolResult => ({ content: [{ type: 'text', text: 'ok' }] });

function registrar(): SurfaceRegistrar {
  return {
    guarded: async (_cap: any, _name: string, fn: () => Promise<ToolResult>) => fn()
  } as unknown as SurfaceRegistrar;
}

beforeEach(() => {
  resetDirectorAuthorityForTests();
  state.strict = true;
  state.caller = { sessionId: 'session-a', conversationId: 'chat-a', requestId: 'request-a' };
  state.proofs.clear();
});

it('preserves upstream behavior when strict trusted-chat mode is off', async () => {
  state.strict = false;
  const reg = withDirectorWriteInterlock(registrar());
  expect((await reg.guarded('command', 'exec_command', async () => ok())).isError).not.toBe(true);
});

it('requires a delivered Director lease for strict-mode Core/Desktop writes', async () => {
  const reg = withDirectorWriteInterlock(registrar());
  const missing = await reg.guarded('command', 'exec_command', async () => ok());
  expect(missing.isError).toBe(true);
  expect(missing.content[0]?.type === 'text' ? missing.content[0].text : '').toContain('DIRECTOR_AUTHORITY_REQUIRED');

  noteDirectorInstruction('session-a', 'input-1', 100);
  const pending = await reg.guarded('edit', 'apply_patch', async () => ok());
  expect(pending.isError).toBe(true);
  expect(pending.content[0]?.type === 'text' ? pending.content[0].text : '').toContain('DIRECTOR_DELIVERY_PENDING');

  confirmDirectorInstruction('session-a', 'input-1', 110);
  expect((await reg.guarded('edit', 'apply_patch', async () => ok())).isError).not.toBe(true);
});

it('screen and clipboard observations revoke the next strict-mode mutation, local file reads do not', async () => {
  const reg = withDirectorWriteInterlock(registrar());
  noteDirectorInstruction('session-a', 'input-1', 100);
  confirmDirectorInstruction('session-a', 'input-1', 110);

  await reg.guarded('read', 'read', async () => ok());
  expect(directorMutationDecision('session-a').allowed).toBe(true);

  await reg.guarded('screen', 'computer', async () => ok());
  expect(directorMutationDecision('session-a')).toMatchObject({
    allowed: false,
    reason: 'untrusted_external_content',
    sources: ['external:computer']
  });

  const blocked = await reg.guarded('command', 'exec_command', async () => ok());
  expect(blocked.isError).toBe(true);
  expect(blocked.content[0]?.type === 'text' ? blocked.content[0].text : '').toContain('DIRECTOR_REAUTHORIZATION_REQUIRED');

  noteDirectorInstruction('session-a', 'input-2', 120);
  confirmDirectorInstruction('session-a', 'input-2', 130);
  await reg.guarded('clipboardRead', 'clipboard_read', async () => ok());
  expect(directorMutationDecision('session-a').reason).toBe('untrusted_external_content');
});

it('leaves browser-specific writes to the browser boundary rather than double-gating them', async () => {
  const reg = withDirectorWriteInterlock(registrar());
  const result = await reg.guarded('control', 'browser_action', async () => ok());
  expect(result.isError).not.toBe(true);
});

it('fails closed when strict-mode mutation identity cannot prove a local session', async () => {
  state.caller = { requestId: 'request-unproven' };
  const reg = withDirectorWriteInterlock(registrar());
  const result = await reg.guarded('command', 'exec_command', async () => ok());
  expect(result.isError).toBe(true);
  expect(result.content[0]?.type === 'text' ? result.content[0].text : '').toContain('DIRECTOR_IDENTITY_REQUIRED');
});
