import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  owners: new Map<string, { owned: boolean; primeConversationId: string | null }>(),
  sessions: new Map<string, { id: string }>()
}));

vi.mock('../src/main/agents.js', () => ({
  workerPrimeOwner: (conversationId: string) => state.owners.get(conversationId) ?? { owned: false, primeConversationId: null }
}));
vi.mock('../src/main/session/store.js', () => ({
  findSessionByConversation: async (conversationId: string) => state.sessions.get(conversationId) ?? null
}));

import { directorAuthoritySessionId } from '../src/main/session/director-owner.js';

beforeEach(() => {
  state.owners.clear();
  state.sessions.clear();
});

it('ordinary and resumed chats spend their own local session authority', async () => {
  expect(await directorAuthoritySessionId('session-a', 'chat-a')).toBe('session-a');
});

it('workers spend only the exact owning Prime Director lease', async () => {
  state.owners.set('worker-chat', { owned: true, primeConversationId: 'prime-chat' });
  state.sessions.set('prime-chat', { id: 'prime-session' });
  expect(await directorAuthoritySessionId('worker-session', 'worker-chat')).toBe('prime-session');
});

it('fails closed when a worker Prime cannot be proven', async () => {
  state.owners.set('worker-chat', { owned: true, primeConversationId: null });
  expect(await directorAuthoritySessionId('worker-session', 'worker-chat')).toBeNull();

  state.owners.set('worker-chat', { owned: true, primeConversationId: 'missing-prime' });
  expect(await directorAuthoritySessionId('worker-session', 'worker-chat')).toBeNull();
});
