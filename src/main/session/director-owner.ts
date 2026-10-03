import { workerPrimeOwner } from '../agents.js';
import { findSessionByConversation } from './store.js';

/**
 * Resolve the local session whose human authority a caller may spend.
 *
 * Ordinary/resumed chats spend their own durable local session. App-created workers never mint
 * independent authority: they inherit only the exact owning Prime's Director lease. If that
 * owner cannot be proven, fail closed instead of falling back to the worker or an active chat.
 */
export async function directorAuthoritySessionId(
  sessionId: string | null | undefined,
  conversationId: string | null | undefined
): Promise<string | null> {
  if (!sessionId) return null;
  if (!conversationId) return sessionId;
  const worker = workerPrimeOwner(conversationId);
  if (!worker.owned) return sessionId;
  if (!worker.primeConversationId) return null;
  const prime = await findSessionByConversation(worker.primeConversationId, { requireUnique: true });
  return prime?.id ?? null;
}
