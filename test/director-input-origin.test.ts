import { beforeEach, expect, it, vi } from 'vitest';
import type { InputArgs, InputEntry } from '../src/main/session/input.js';

const state = vi.hoisted(() => ({
  rows: [] as InputEntry[]
}));

vi.mock('../src/main/connection.js', () => ({
  connect: vi.fn(),
  getStatus: () => ({ state: 'connected', detail: '' }),
  onStatusChange: () => () => {}
}));
vi.mock('../src/main/bridge.js', () => ({ startBridge: vi.fn(async () => 8765) }));
vi.mock('../src/main/browser-startup.js', () => ({
  wakeBrowserUrl: vi.fn(async () => undefined),
  resetBrowserStartupForTests: vi.fn()
}));
vi.mock('../src/main/config.js', () => ({ getConfig: () => ({ ui: { backgroundChats: false } }) }));
vi.mock('../src/main/session/input.js', () => ({
  enqueueInput: vi.fn(async (input: InputArgs): Promise<InputEntry> => {
    const row = {
      ...input,
      sessionId: input.sessionId ?? input.id,
      state: 'queued',
      owner: null,
      createdAt: 100,
      conversationId: input.sessionId ? 'chat-a' : null,
      transportIntent: 'tool'
    } as InputEntry;
    state.rows.push(row);
    return row;
  }),
  cancelInput: vi.fn(async () => false),
  listInputs: async () => state.rows,
  noteInputStartupError: vi.fn(async () => null)
}));

import { sendDesktopInput, sendUserDesktopInput, resetInputStartupForTests } from '../src/main/session/start-input.js';
import { directorMutationDecision, resetDirectorAuthorityForTests } from '../src/main/session/director-authority.js';

const input: InputArgs = {
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  sessionId: 'session-a',
  text: 'Do the next UKIKU task',
  mode: 'auto',
  dueAt: 0,
  model: null,
  reasoningEffort: null,
  delivery: 'tool',
  authoredSource: 'text'
};

beforeEach(() => {
  state.rows = [];
  resetInputStartupForTests();
  resetDirectorAuthorityForTests();
});

it('generic sends used by the Local control API do not mint Director authority', async () => {
  await sendDesktopInput(input);
  expect(directorMutationDecision('session-a')).toMatchObject({
    allowed: false,
    reason: 'missing_director_instruction'
  });
});

it('the explicit desktop UI send arms a pending Director lease', async () => {
  await sendUserDesktopInput(input);
  expect(directorMutationDecision('session-a')).toMatchObject({
    allowed: false,
    reason: 'director_instruction_pending_delivery',
    directorInputId: input.id
  });
});

it('generated authoredSource=none work cannot arm Director even through the UI wrapper', async () => {
  await sendUserDesktopInput({
    ...input,
    id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
    authoredSource: 'none'
  });
  expect(directorMutationDecision('session-a')).toMatchObject({
    allowed: false,
    reason: 'missing_director_instruction'
  });
});
