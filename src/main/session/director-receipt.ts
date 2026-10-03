import { inputDeliveryReceipt } from './input.js';
import { confirmDirectorInstruction, pendingDirectorInstruction } from './director-authority.js';

/**
 * Reuse the outbox's exact delivery evidence. Director never interprets page text, model-authored
 * fields or timing guesses as authorization.
 */
export async function refreshDirectorReceipt(sessionId: string | null | undefined): Promise<void> {
  const inputId = pendingDirectorInstruction(sessionId);
  if (!sessionId || !inputId) return;
  const deliveredAt = await inputDeliveryReceipt(sessionId, inputId);
  if (deliveredAt !== null) confirmDirectorInstruction(sessionId, inputId, deliveredAt);
}
