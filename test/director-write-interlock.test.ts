import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SurfaceRegistrar, ToolResult } from '../src/main/mcp/kernel.js';

const state = vi.hoisted(() => ({
  caller: { sessionId: 'session-a', conversationId: 'chat-a' } as { sessionId: string; conversationId: string } | null,
  refresh: vi.fn(async () => false)
}));
vi.mock('../src/main/mcp/call-context.js', () => ({ currentCall: () => state.caller ? { caller: state.caller } : null }));
vi.mock('../src/main/security/director-receipt.js', () => ({ refreshDirectorReceipt: state.refresh }));

import { withDirectorWriteInterlock } from '../src/main/mcp/director-write-interlock.js';
import {
  confirmDirectorInstruction,
  directorSecurityJournal,
  noteDirectorInstruction,
  noteUntrustedExternalContent,
  resetDirectorAuthorityForTests
} from '../src/main/security/director-authority.js';

function registrar(): SurfaceRegistrar {
  return {
    guarded: async (_cap, _name, fn) => fn()
  } as unknown as SurfaceRegistrar;
}
function ok(): ToolResult { return { content: [{ type: 'text', text: 'ran' }] }; }

beforeEach(() => {
  resetDirectorAuthorityForTests();
  state.caller = { sessionId: 'session-a', conversationId: 'chat-a' };
  state.refresh.mockClear().mockResolvedValue(false);
});

describe('Director cross-tool write interlock', () => {
  it('preserves legacy writes when the session has no Director or external-taint state', async () => {
    const effect = vi.fn(async () => ok());
    const result = await withDirectorWriteInterlock(registrar()).guarded('edit', 'apply_patch', effect);
    expect(result.isError).not.toBe(true);
    expect(effect).toHaveBeenCalledOnce();
    expect(state.refresh).toHaveBeenCalledWith('session-a');
  });

  it('does not apply the write interlock to ordinary reads', async () => {
    noteUntrustedExternalContent('session-a', 'browser:browser_snapshot', 100);
    const effect = vi.fn(async () => ok());
    const result = await withDirectorWriteInterlock(registrar()).guarded('read', 'read_file', effect);
    expect(result.isError).not.toBe(true);
    expect(effect).toHaveBeenCalledOnce();
    expect(state.refresh).not.toHaveBeenCalled();
  });

  it('blocks shell/filesystem/Desktop writes after attributed external observation even without an earlier lease', async () => {
    noteUntrustedExternalContent('session-a', 'browser:browser_snapshot', 100);
    const effect = vi.fn(async () => ok());
    const result = await withDirectorWriteInterlock(registrar()).guarded('command', 'exec_command', effect);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.type === 'text' ? result.content[0].text : '').toContain('DIRECTOR_REAUTHORIZATION_REQUIRED');
    expect(effect).not.toHaveBeenCalled();
    expect(directorSecurityJournal()).toMatchObject([{
      sessionId: 'session-a',
      tool: 'exec_command',
      reason: 'untrusted_external_content',
      sources: ['browser:browser_snapshot']
    }]);
  });

  it('revokes ordinary writes immediately while a newer local correction is pending delivery', async () => {
    noteDirectorInstruction('session-a', 'input-2', 100);
    const effect = vi.fn(async () => ok());
    const result = await withDirectorWriteInterlock(registrar()).guarded('clipboardWrite', 'clipboard_write', effect);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.type === 'text' ? result.content[0].text : '').toContain('DIRECTOR_DELIVERY_PENDING');
    expect(effect).not.toHaveBeenCalled();
  });

  it('allows the write again after the exact pending Director instruction is proven delivered', async () => {
    noteDirectorInstruction('session-a', 'input-2', 100);
    expect(confirmDirectorInstruction('session-a', 'input-2', 110)).toBe(true);
    const effect = vi.fn(async () => ok());
    const result = await withDirectorWriteInterlock(registrar()).guarded('create', 'write_file', effect);
    expect(result.isError).not.toBe(true);
    expect(effect).toHaveBeenCalledOnce();
  });

  it('leaves browser tools to their stricter browser-specific Director policy', async () => {
    noteUntrustedExternalContent('session-a', 'browser:browser_snapshot', 100);
    const effect = vi.fn(async () => ok());
    const result = await withDirectorWriteInterlock(registrar()).guarded('control', 'browser_action', effect);
    expect(result.isError).not.toBe(true);
    expect(effect).toHaveBeenCalledOnce();
    expect(state.refresh).not.toHaveBeenCalled();
  });

  it('does not invent authority for unattributed calls', async () => {
    state.caller = null;
    const effect = vi.fn(async () => ok());
    const result = await withDirectorWriteInterlock(registrar()).guarded('edit', 'apply_patch', effect);
    expect(result.isError).not.toBe(true);
    expect(effect).toHaveBeenCalledOnce();
    expect(state.refresh).not.toHaveBeenCalled();
  });
});
