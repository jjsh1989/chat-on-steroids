# Director Handoff Protocol — next slice

This is the next design slice after the current-upstream Director port is green. It is not yet an
execution authority and must reuse the existing Projects, local sessions, Compact & Resume and
Local control API owners.

## Goal

Rotate long-running ChatGPT conversations without making the chat itself the durable project owner.

```text
Project / durable local session
        |
     Director
        |
      Chat A
        |
  structured handoff
        v
     Director
        |
  create/open Chat B
        |
        v
      Chat B
        |
   questions / gaps
        v
     Director
        |
   targeted questions
        v
      Chat A
        |
   clarifications
        v
     Director
        |
  enriched handoff v2
        v
      Chat B
        |
  HANDOFF_ACCEPTED
        |
  B active / A superseded
```

## Rules

- A and B exchange knowledge only through Director.
- Director reads and analyzes each side; it is not a blind message relay.
- A handoff can contain objective, current state, closed decisions, open questions, tests, files,
  Git state and next actions.
- B must be allowed to ask what is missing before accepting the handoff.
- Director may ask A targeted follow-up questions and enrich the handoff before returning to B.
- Cap clarification rounds (initial proposal: 3). Unresolved items become explicit OPEN QUESTIONs.
- The source chat is not retired until the successor is proven, receives the handoff and accepts it.
- Handoff text never grants authority. Director transfers authority out-of-band only after the
  successor identity and durable session/project lineage are verified.
- A local Director AI may eventually mediate this protocol, but it must operate under a human-owned
  capability envelope and cannot expand that envelope itself.

## Likely upstream building blocks

- Native ChatGPT Projects for project-local chat placement.
- Durable local sessions as the identity that survives chat replacement.
- Compact & Resume handoff storage/provenance.
- Local control API to start a new chat and stream its events.
- Trusted Chats / exact worker-to-Prime provenance.
- Current queued-message Send now / Steer for controlled mid-turn corrections.

Implementation should extend those owners rather than creating a parallel session, handoff or
browser-opening state machine.
