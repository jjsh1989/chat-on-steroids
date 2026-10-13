import { beforeEach, expect, it, vi } from 'vitest';
import type { Capabilities } from '../src/shared/types.js';
import type { SurfaceRegistrar } from '../src/main/mcp/kernel.js';
import { z } from 'zod';

const state = vi.hoisted(() => ({
  strict: true,
  caps: { screen: true, control: true },
  caller: { sessionId: 'session-a', conversationId: 'chat-a' } as any,
  execute: vi.fn(),
  attachment: 'current'
}));

vi.mock('../src/main/config.js', () => ({
  getConfig: () => ({ multiAgent: { allowUnattributedCalls: false } }),
  effectiveCapabilities: () => state.caps
}));
vi.mock('../src/main/mcp/call-context.js', () => ({ currentCall: () => ({ caller: state.caller }) }));
vi.mock('../src/main/mcp/kernel.js', () => ({
  fail: (text: string) => ({ isError: true, content: [{ type: 'text', text }] }),
  failIdentity: (text: string) => ({ isError: true, content: [{ type: 'text', text }] })
}));
vi.mock('../src/main/browser-control.js', () => ({ browserControl: { execute: state.execute } }));
vi.mock('../src/main/session/store.js', () => ({ conversationAttachment: async () => state.attachment }));
vi.mock('../src/main/session/correlation.js', () => ({ requestCorrelation: () => null }));
vi.mock('../src/main/session/blocked-chats.js', () => ({ isChatBlocked: () => false }));
vi.mock('../src/main/session/continuation.js', () => ({ compactingConversation: () => false }));
vi.mock('../src/main/agents.js', () => ({
  dormantWorkerNotice: () => null,
  endedWorkerNotice: () => null,
  retiredWorkerForConversation: () => null
}));
vi.mock('../src/main/codex/view-image.js', () => ({ validateImageBytes: vi.fn(async () => 'image/jpeg') }));
vi.mock('../src/main/session/conversation-access.js', () => ({
  strictChatAllowlistEnabled: () => state.strict
}));
vi.mock('../src/main/session/director-receipt.js', () => ({
  refreshDirectorReceipt: async () => undefined
}));
vi.mock('../src/main/session/director-owner.js', () => ({
  directorAuthoritySessionId: async (sessionId: string | null | undefined) => sessionId ?? null
}));

import { registerBrowserTools } from '../src/main/mcp/tools-browser.js';
import {
  confirmDirectorInstruction,
  directorMutationDecision,
  noteDirectorInstruction,
  resetDirectorAuthorityForTests
} from '../src/main/session/director-authority.js';

function registrar() {
  const tools = new Map<string, { schema: z.ZodType; handler: (input: unknown) => Promise<any> }>();
  registerBrowserTools({
    exposedCaps: { screen: true, control: true } as Capabilities,
    register: (name: string, definition: any, handler: any) => {
      tools.set(name, { schema: definition.inputSchema, handler });
    },
    guarded: async (cap: 'screen' | 'control', _name: string, fn: () => Promise<unknown>) =>
      state.caps[cap] ? fn() : { isError: true, content: [{ type: 'text', text: 'TOOL_DISABLED' }] }
  } as unknown as SurfaceRegistrar);
  return {
    call: (name: string, input: unknown) => {
      const tool = tools.get(name)!;
      return tool.handler(tool.schema.parse(input));
    }
  };
}

const tabId = '11111111-1111-4111-8111-111111111111:12';
const pageId = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  resetDirectorAuthorityForTests();
  state.strict = true;
  state.caps = { screen: true, control: true };
  state.caller = { sessionId: 'session-a', conversationId: 'chat-a' };
  state.attachment = 'current';
  state.execute.mockReset().mockResolvedValue({ value: { ok: true } });
});

it('strict mode enforces authorize → observe → reauthorize before consequential page action', async () => {
  const reg = registrar();
  const action = { tabId, pageId, action: 'key', key: 'Enter' };

  const missing = await reg.call('browser_action', action);
  expect(missing.isError).toBe(true);
  expect(missing.content[0].text).toContain('DIRECTOR_AUTHORITY_REQUIRED');
  expect(state.execute).not.toHaveBeenCalled();

  noteDirectorInstruction('session-a', 'input-1', 100);
  confirmDirectorInstruction('session-a', 'input-1', 110);

  const observation = await reg.call('browser_snapshot', { tabId });
  expect(observation.isError).not.toBe(true);
  expect(directorMutationDecision('session-a')).toMatchObject({
    allowed: false,
    reason: 'untrusted_external_content',
    sources: ['browser:browser_snapshot']
  });

  const tainted = await reg.call('browser_action', action);
  expect(tainted.isError).toBe(true);
  expect(tainted.content[0].text).toContain('DIRECTOR_REAUTHORIZATION_REQUIRED');
  expect(state.execute).toHaveBeenCalledTimes(1);

  noteDirectorInstruction('session-a', 'input-2', 120);
  confirmDirectorInstruction('session-a', 'input-2', 130);
  const allowed = await reg.call('browser_action', action);
  expect(allowed.isError).not.toBe(true);
  expect(state.execute).toHaveBeenCalledTimes(2);
});

it('strict mode off preserves upstream browser behavior', async () => {
  state.strict = false;
  const result = await registrar().call('browser_action', { tabId, pageId, action: 'key', key: 'Enter' });
  expect(result.isError).not.toBe(true);
});
