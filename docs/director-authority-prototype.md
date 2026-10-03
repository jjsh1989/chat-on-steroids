# Director authority prototype on modern upstream

Base: upstream `main` at `61d6bb31d3eff0b57394fd5ff42bc4ad4f019b6b` (2026-10-03), after
the official Spanish UI, strict trusted-chat allowlisting and command allow/deny policy landed.

## Invariant

> External content may inform reasoning, but it cannot grant authority, change the user's goal or
> expand local capabilities.

Director is additive to the existing owners:

1. **Trusted Chats** decides which exact ChatGPT conversation may use local tools.
2. **Capabilities / Read-only / approved roots** decide which local surfaces exist and what they may do.
3. **Command policy** decides which shell invocations are admissible.
4. **Director** decides whether a consequential mutation still has fresh human authority after
   external content was observed.

## Authority lifecycle

- Only an explicit human-authored desktop input can create a pending Director lease.
- Generated checkpoints, Goal/Loop continuation work and decision helpers cannot renew authority.
- A pending input revokes the previous lease immediately.
- The lease becomes active only when the existing durable outbox proves delivery of that exact
  input with its receipt.
- Browser observations, native screen/clipboard reads and plugin results revoke the active lease.
- In strict trusted-chat mode, Core/Desktop writes then fail until a fresh human instruction is
  delivered.
- `browser_action` and `browser_evaluate` always require an active Director lease while strict
  mode is on. Navigation/tab orchestration remains available for autonomous research.
- Workers never mint their own authority. They spend only the exact owning Prime's lease.

## Scope

This prototype is enabled only when upstream's **strict trusted-chat allowlist** is enabled. With
strict mode off, upstream behavior is unchanged.

The Security Journal is process-local and stores bounded metadata only: tool name, reason, timing
and bounded source labels. It never persists raw page/plugin text as a rule.

## Known limits

- Director state is process-local. Restart therefore requires a fresh human instruction before a
  strict-mode mutation; no stale lease is restored.
- Plugin results taint later local mutation authority, but plugin tools are not yet classified
  read-vs-write for a pre-call Director gate.
- Local project-file reads are not treated as external content in this slice.
- The lease proves fresh human provenance, not semantic task scope. A later task-scoped capability
  contract can narrow operations without replacing this provenance boundary.
