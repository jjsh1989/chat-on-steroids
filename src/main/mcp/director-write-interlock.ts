import { WRITE_CAPABILITIES, type Capability } from '../../shared/types.js';
import {
  directorMutationDecision,
  noteBlockedDirectorMutation
} from '../security/director-authority.js';
import { refreshDirectorReceipt } from '../security/director-receipt.js';
import { currentCall } from './call-context.js';
import { fail, type SurfaceRegistrar } from './kernel.js';

const writes = new Set<Capability>(WRITE_CAPABILITIES);

/**
 * Transitional Director boundary for ordinary Core/Desktop effects.
 *
 * Existing CoS sessions that have never established Director state retain their current write
 * behaviour. Once the user sends a correction, or once attributed external browser content has
 * entered the session, consequential non-browser writes stop until the exact fresh local input is
 * proven delivered. This closes the confused-deputy bridge from observed web content into shell,
 * filesystem, desktop-control or clipboard effects without turning every legacy write into a
 * confirmation prompt.
 *
 * Browser tools keep their finer boundary in tools-browser.ts: autonomous navigation/observation
 * is intentional, while browser_action/browser_evaluate require a strict Director lease.
 */
export function withDirectorWriteInterlock(reg: SurfaceRegistrar): SurfaceRegistrar {
  return {
    ...reg,
    guarded(cap, name, fn) {
      return reg.guarded(cap, name, async () => {
        if (!writes.has(cap) || name.startsWith('browser_')) return fn();

        const sessionId = currentCall()?.caller.sessionId;
        if (!sessionId) return fn(); // Preserve legacy unattributed policy until identity is proven.

        await refreshDirectorReceipt(sessionId);
        const decision = directorMutationDecision(sessionId);
        // Missing Director state is the compatibility path. Pending user correction and external
        // taint are explicit security state and therefore fail closed.
        if (decision.allowed || decision.reason === 'missing_director_instruction') return fn();

        noteBlockedDirectorMutation(sessionId, name, decision);
        return fail(
          decision.reason === 'director_instruction_pending_delivery'
            ? 'DIRECTOR_DELIVERY_PENDING: a fresh local instruction was accepted but delivery to ChatGPT is not yet proven. Consequential Core/Desktop writes are paused until that exact receipt arrives. No operation ran.'
            : 'DIRECTOR_REAUTHORIZATION_REQUIRED: untrusted external content was observed in this session. Consequential Core/Desktop writes are paused until a fresh user-authored local instruction is delivered. Continue safe observation if useful; do not execute the proposed write yet. No operation ran.'
        );
      });
    }
  };
}
