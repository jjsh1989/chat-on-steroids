import { listInputs } from '../session/input.js';
import { confirmDirectorInstruction, pendingDirectorInstruction } from './director-authority.js';

/**
 * Promote one pending Director instruction from the outbox's existing exact delivery evidence.
 * This is the only runtime definition of a usable Director receipt: browser actions and other
 * write interlocks must share it rather than inventing parallel authority rules.
 */
export async function refreshDirectorReceipt(sessionId: string | null | undefined): Promise<boolean> {
  const inputId = pendingDirectorInstruction(sessionId);
  if (!sessionId || !inputId) return false;
  const receipt = (await listInputs()).find(row => row.id === inputId &&
    (row.sessionId === sessionId || row.deliveredSessionId === sessionId) &&
    row.purpose !== 'decision' && row.authoredSource !== 'none' &&
    row.state === 'sent' && Number.isFinite(row.deliveredAt));
  return receipt?.deliveredAt !== undefined
    ? confirmDirectorInstruction(sessionId, inputId, receipt.deliveredAt)
    : false;
}
