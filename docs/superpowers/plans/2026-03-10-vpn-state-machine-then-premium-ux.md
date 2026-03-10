# VPN State-Machine Hardening + Premium Support UX Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reliable, state-machine-driven VPN core first (Point 2), then layer premium user support and trust UX (Point 3) without regressions.

**Architecture:** Phase 2 introduces a single VPN lifecycle state machine as the control plane for connect/disconnect/reconnect/diagnose behavior, plus unified server-side connection-quality thresholds and deterministic timer coordination. Phase 3 consumes those stable state/events to deliver premium support UX: guided recovery, clear error taxonomy, and one-click support bundles.

**Tech Stack:** Rust (Tauri v2, boringtun, wintun, tokio), React + TypeScript, Python FastAPI, SQLite, GitHub Actions.

---

## Scope Check

Point 2 and Point 3 are two subsystems, but they are intentionally coupled and sequential (Phase 3 depends on Phase 2 contracts: state/event schema + threshold policy + fix-action IDs). This plan keeps both in one document with strict phase gates.

---

## File Structure Map (Lock Before Coding)

### Phase 2 (State-Machine Hardening)

- Create: `client/windows/src-tauri/src/vpn_state.rs`
  - Single source of truth for VPN lifecycle states, transitions, guards, backoff policy, and event payload structs.
- Modify: `client/windows/src-tauri/src/vpn.rs`
  - Replace ad-hoc `Mutex<Option<EmbeddedTunnel>>` orchestration with state-machine-owned orchestration API.
- Modify: `client/windows/src-tauri/src/lib.rs`
  - Route connect/disconnect/fix commands through state machine; gate heartbeat/reconnect loops by state; emit `vpn-state-changed` events.
- Modify: `client/windows/src-tauri/src/tunnel.rs`
  - Keep packet-plane logic; add small hooks only if needed for explicit state signals (no major refactor).
- Modify: `client/windows/src-tauri/tests/vpn_test.rs`
  - Add behavior tests around state transitions and reconnect guards.
- Modify: `client/windows/src/App.tsx`
  - Consume `vpn-state-changed` and render state-aware UI behavior.
- Create: `server/api/services/connection_quality.py`
  - Canonical threshold constants + quality helper function.
- Modify: `server/api/routers/peers.py`
  - Replace inline threshold logic with shared helper.
- Modify: `server/api/routers/admin.py`
  - Replace inline threshold logic with shared helper.
- Modify: `server/api/services/peer_status.py`
  - Align docs and make disconnect-state behavior deterministic (persist/reconcile strategy).
- Modify: `.github/workflows/build-windows.yml`
  - Add explicit test step(s) so builds fail on regressions.

### Phase 3 (Premium Support UX)

- Create: `client/windows/src/components/VpnStateTimeline.tsx`
  - Human-readable lifecycle timeline with transition history.
- Create: `client/windows/src/components/SupportBundleDialog.tsx`
  - UX for one-click support export and copy/share instructions.
- Modify: `client/windows/src/components/DiagnosePanel.tsx`
  - Guided recovery entrypoint, deterministic fix UX, richer explanation language.
- Modify: `client/windows/src/components/ConnectionInfoPanel.tsx`
  - Confidence/health score + clearer quality context labels.
- Modify: `client/windows/src/i18n/translations.ts`
  - New user-facing strings for state labels, guidance, support bundle messaging.
- Modify: `client/windows/src-tauri/src/lib.rs`
  - Add `export_support_bundle` command and safe redaction support.
- Create: `client/windows/src-tauri/src/support_bundle.rs`
  - Bundle assembly/redaction rules for diagnostics/log snapshots.
- Modify: `client/windows/src/App.tsx`
  - Wire new premium UX components.

---

## Chunk 1: Phase 2 - Reliability and State-Machine Foundation

### Task 1: Add Shared Server Connection Quality Policy

**Files:**
- Create: `server/api/services/connection_quality.py`
- Modify: `server/api/routers/peers.py`
- Modify: `server/api/routers/admin.py`
- Test: `server/api/tests/test_peers.py`

- [ ] **Step 1: Write failing tests for threshold consistency**

```python
# server/api/tests/test_peers.py

def test_connection_quality_policies_apply_expected_boundaries(client, admin_headers, peer_headers):
    # Arrange mocked wg dump with boundary values: 59, 60, 179, 180, 599, 600
    # Assert player-facing policy returns expected labels for peers route.
    # Assert operator-facing policy returns expected labels for admin route.
    # Assert both routes are deterministic and policy-driven (no inline magic numbers).
    assert peers_route_labels == ["good", "good", "good", "good", "warning", "warning"]
    assert admin_route_labels == ["good", "good", "warning", "warning", "offline", "offline"]
```

- [ ] **Step 2: Decide and freeze quality policy contract (no guessing)**

Document explicit policy intent before implementation:
- `PLAYER` policy for end-user quality labels (current peers behavior: good<=180, warning<=600)
- `ADMIN` policy for operator sensitivity (current admin behavior: good<=60, warning<=180)

If product decision is to fully unify values, write that decision in the plan PR and update tests accordingly.

- [ ] **Step 3: Run failing tests**

Run: `cd server/api && pytest tests/test_peers.py -k threshold -v`
Expected: FAIL because policy module and route wiring do not yet exist.

- [ ] **Step 4: Implement shared quality module**

```python
# server/api/services/connection_quality.py
from enum import Enum

class QualityPolicy(str, Enum):
    PLAYER = "player"
    ADMIN = "admin"

POLICY_THRESHOLDS = {
    QualityPolicy.PLAYER: (180, 600),
    QualityPolicy.ADMIN: (60, 180),
}

def classify_quality(last_handshake_ago: int | None, explicitly_disconnected: bool, policy: QualityPolicy) -> str:
    good_max, warn_max = POLICY_THRESHOLDS[policy]
    if explicitly_disconnected:
        return "offline"
    if last_handshake_ago is None or last_handshake_ago > warn_max:
        return "offline"
    if last_handshake_ago > good_max:
        return "warning"
    return "good"
```

- [ ] **Step 5: Replace inline threshold logic in both routers**

Run targeted edits in:
- `server/api/routers/peers.py`
- `server/api/routers/admin.py`

Expected behavior: both routes call `classify_quality(...)`.
- `peers.py` uses `QualityPolicy.PLAYER`
- `admin.py` uses `QualityPolicy.ADMIN`

- [ ] **Step 6: Re-run tests**

Run: `cd server/api && pytest tests/test_peers.py -v`
Expected: PASS, including new threshold-consistency test.

- [ ] **Step 7: Commit**

```bash
git add server/api/services/connection_quality.py server/api/routers/peers.py server/api/routers/admin.py server/api/tests/test_peers.py
git commit -m "fix(server): unify connection quality thresholds across peers and admin"
```

### Task 2: Introduce VPN State Machine Core in Rust

**Files:**
- Create: `client/windows/src-tauri/src/vpn_state.rs`
- Modify: `client/windows/src-tauri/src/vpn.rs`
- Test: `client/windows/src-tauri/tests/vpn_test.rs`

- [ ] **Step 1: Write failing state transition tests**

```rust
// client/windows/src-tauri/tests/vpn_test.rs
#[test]
fn state_machine_rejects_connect_when_already_connecting() {
    // Arrange machine in Connecting
    // Assert second connect request is ignored/rejected deterministically
}

#[test]
fn state_machine_enforces_disconnect_before_reconnect_path() {
    // Arrange Connected
    // Trigger reconnect intent
    // Assert transition order: Connected -> Reconnecting -> Connected|Error
}
```

- [ ] **Step 2: Run failing tests**

Run: `cd client/windows/src-tauri && cargo test --test vpn_test -- --nocapture`
Expected: FAIL because `vpn_state.rs` and transition API do not yet exist.

- [ ] **Step 3: Implement `vpn_state.rs` with explicit transitions**

```rust
pub enum VpnState {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
    Disconnecting,
    Error(String),
}

pub enum VpnIntent {
    Connect,
    Disconnect,
    Reconnect,
    Diagnose,
}

pub struct VpnStateMachine {
    state: VpnState,
    reconnect_attempt: u32,
}
```

Include transition guards and a pure transition function that is easy to test.

**Ownership decision (mandatory):**
- The state machine is the single owner of tunnel lifecycle orchestration.
- `vpn.rs` functions become thin wrappers over state-machine methods.
- Avoid dual source of truth between state tracker and `TUNNEL` store.

- [ ] **Step 4: Refactor `vpn.rs` to use machine-owned state**

Implement a wrapper API that keeps existing public behavior but delegates control flow to `VpnStateMachine`.

- [ ] **Step 5: Re-run tests**

Run: `cd client/windows/src-tauri && cargo test --test vpn_test -- --nocapture`
Expected: PASS for new transition tests and existing basic VPN tests.

- [ ] **Step 6: Commit**

```bash
git add client/windows/src-tauri/src/vpn_state.rs client/windows/src-tauri/src/vpn.rs client/windows/src-tauri/tests/vpn_test.rs
git commit -m "feat(client): add deterministic VPN state machine and transition guards"
```

### Task 3: Coordinate Reconnect + Heartbeat Timers Through State Machine

**Files:**
- Modify: `client/windows/src-tauri/src/lib.rs`
- Test: `client/windows/src-tauri/tests/vpn_test.rs`

- [ ] **Step 1: Write failing tests for timer gating semantics**

```rust
#[test]
fn heartbeat_only_runs_when_connected() {
    // Assert no heartbeat attempts from Disconnected/Connecting states
}

#[test]
fn reconnect_loop_skips_when_connecting_or_diagnosing() {
    // Assert reconnect guard prevents race while active connect/diagnose path exists
}
```

- [ ] **Step 2: Run failing tests**

Run: `cd client/windows/src-tauri && cargo test --test vpn_test -- --nocapture`
Expected: FAIL on missing timer-gate logic.

- [ ] **Step 3: Implement timer gating + backoff contract**

In `lib.rs` reconnect task and heartbeat task:
- Read state-machine state before action.
- Skip reconnect unless state is `Disconnected` or `Error`.
- Skip heartbeat unless `Connected`.
- Add jittered reconnect delay policy owned by state machine.

Async boundary rule:
- Keep transition mutation behind an async-safe lock (`tokio::sync::Mutex`) or equivalent.
- Provide cheap read-only state snapshots for hot paths to avoid blocking runtime threads.
- Never hold transition lock while doing network I/O.

- [ ] **Step 4: Emit normalized state events**

Emit a single schema event, e.g. `vpn-state-changed`, containing:
- `state`
- `reason`
- `attempt`
- `timestamp`

- [ ] **Step 5: Re-run tests**

Run: `cd client/windows/src-tauri && cargo test --test vpn_test -- --nocapture`
Expected: PASS with deterministic timer behavior.

- [ ] **Step 6: Commit**

```bash
git add client/windows/src-tauri/src/lib.rs client/windows/src-tauri/tests/vpn_test.rs
git commit -m "fix(client): gate reconnect and heartbeat loops with VPN state machine"
```

### Task 4: Add CI Test Gate for Client Reliability

**Files:**
- Modify: `.github/workflows/build-windows.yml`

- [ ] **Step 1: Add explicit test step before Tauri build**

```yaml
- name: Run Rust tests
  working-directory: client/windows/src-tauri
  run: cargo test --test vpn_test
```

- [ ] **Step 2: Run workflow lint check locally (if available) or dry review**

Run: `git diff .github/workflows/build-windows.yml`
Expected: workflow includes mandatory tests before packaging.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build-windows.yml
git commit -m "ci: run VPN regression tests before windows packaging"
```

### Task 5: Wire Frontend to State Events (Minimal, Phase-2 Gate)

**Files:**
- Modify: `client/windows/src/App.tsx`
- Modify: `client/windows/src/components/VpnStatusBar.tsx`
- Modify: `client/windows/package.json` (add `test` script if missing)
- Modify: `client/windows/vite.config.ts` (enable vitest config if missing)
- Create: `client/windows/src/__tests__/app.vpn-state.test.tsx`

- [ ] **Step 1: Write failing frontend test for vpn-state event mapping**

If frontend test harness does not exist, add minimal Vitest setup first.

Create failing test assertions for transitions:
- `Disconnected -> Connecting -> Connected`
- `Connected -> Reconnecting -> Connected`
- `Connected -> Error`

Assert UI labels and button states update on `vpn-state-changed` events.

- [ ] **Step 2: Subscribe to `vpn-state-changed` in `App.tsx`**

Use existing `listen(...)` pattern and map to UI labels without breaking existing `vpnStatus` UX.

- [ ] **Step 3: Surface richer state reason in status bar**

Update `VpnStatusBar` props/labels to show reconnect attempts and concise reason when degraded/error.

- [ ] **Step 4: Verify manually**

Run: `cd client/windows && npm run dev`
Expected: visible state transitions in UI without flicker.

- [ ] **Step 4b: Re-run automated frontend tests**

Run: `cd client/windows && npm run test -- --run`
Expected: PASS for new event-mapping test.

- [ ] **Step 5: Commit**

```bash
git add client/windows/src/App.tsx client/windows/src/components/VpnStatusBar.tsx
git commit -m "feat(ui): consume vpn-state-changed events for deterministic status rendering"
```

---

## Chunk 2: Phase 3 - Premium UX and Support Experience

### Task 6: Introduce User-Facing Error Taxonomy and Guidance Mapping

**Files:**
- Create: `client/windows/src/components/vpnErrorCatalog.ts`
- Modify: `client/windows/src/components/DiagnosePanel.tsx`
- Modify: `client/windows/src/i18n/translations.ts`
- Create: `client/windows/src/components/__tests__/vpnErrorCatalog.test.ts`

- [ ] **Step 1: Write failing mapping unit test**

```ts
// client/windows/src/components/__tests__/vpnErrorCatalog.test.ts
const entry = mapDiagStepToGuidance({ id: 'server_reachable', status: 'fail' })
expect(entry.titleKey).toBe('diagServerReachableFailTitle')
expect(entry.primaryAction).toBe('reconnect')
```

- [ ] **Step 2: Run check (tsc/build)**

Run: `cd client/windows && npm run build`
Expected: FAIL before catalog keys/mapping exist.

- [ ] **Step 3: Implement catalog + mapping**

`vpnErrorCatalog.ts` contains deterministic mapping from diagnose IDs + statuses to:
- concise user explanation
- confidence level
- primary action
- secondary action

- [ ] **Step 4: Integrate mapping into DiagnosePanel UI**

Replace raw technical strings with user-first explanations while preserving details in expandable sections.

- [ ] **Step 5: Re-run build**

Run: `cd client/windows && npm run build`
Expected: PASS with all new translation keys present.

- [ ] **Step 6: Commit**

```bash
git add client/windows/src/components/vpnErrorCatalog.ts client/windows/src/components/DiagnosePanel.tsx client/windows/src/i18n/translations.ts
git commit -m "feat(ux): add actionable VPN error taxonomy and guided messages"
```

### Task 7: Add Premium State Timeline Component

**Files:**
- Create: `client/windows/src/components/VpnStateTimeline.tsx`
- Modify: `client/windows/src/App.tsx`
- Create: `client/windows/src/components/__tests__/VpnStateTimeline.test.tsx`

- [ ] **Step 1: Write failing rendering test for timeline transitions**

Expected states shown in order for reconnect scenario with timestamps.

- [ ] **Step 2: Implement timeline component**

Render recent state transitions with timestamps and compact reason labels.

- [ ] **Step 3: Mount timeline in `App.tsx` near status/diagnose surfaces**

Use existing state and event stream from Phase 2.

- [ ] **Step 4: Verify build and runtime**

Run:
- `cd client/windows && npm run build`
- `cd client/windows && npm run dev`

Expected: timeline updates in real time without layout breakage.

- [ ] **Step 5: Commit**

```bash
git add client/windows/src/components/VpnStateTimeline.tsx client/windows/src/App.tsx
git commit -m "feat(ux): add VPN state timeline for trust and transparency"
```

### Task 8: Add One-Click Support Bundle (Redacted)

**Files:**
- Create: `client/windows/src-tauri/src/support_bundle.rs`
- Modify: `client/windows/src-tauri/src/lib.rs`
- Create: `client/windows/src/components/SupportBundleDialog.tsx`
- Modify: `client/windows/src/components/DiagnosePanel.tsx`

- [ ] **Step 1: Write failing backend test for bundle structure (Rust)**

```rust
#[test]
fn support_bundle_redacts_sensitive_fields() {
    // Ensure private key/token values are replaced or omitted.
}
```

- [ ] **Step 2: Run failing test**

Run: `cd client/windows/src-tauri && cargo test --lib support_bundle -- --nocapture`
Expected: FAIL before module/command exists.

- [ ] **Step 3: Implement support bundle module**

Bundle should include:
- latest diagnose result summary
- recent state timeline
- sanitized config snapshot
- app version + OS summary

Must redact secrets (`peer_token`, private key, auth headers).

- [ ] **Step 4: Expose Tauri command and integrate dialog UI**

Add command in `lib.rs`, wire dialog trigger in `DiagnosePanel.tsx`.

- [ ] **Step 5: Re-run tests and build**

Run:
- `cd client/windows/src-tauri && cargo test --lib -- --nocapture`
- `cd client/windows && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/windows/src-tauri/src/support_bundle.rs client/windows/src-tauri/src/lib.rs client/windows/src/components/SupportBundleDialog.tsx client/windows/src/components/DiagnosePanel.tsx
git commit -m "feat(support): add one-click redacted support bundle export"
```

### Task 9: Guided Recovery Flow (Deterministic Action Queue)

**Files:**
- Modify: `client/windows/src/components/DiagnosePanel.tsx`
- Modify: `client/windows/src/App.tsx`
- Modify: `client/windows/src/i18n/translations.ts`
- Create: `client/windows/src/components/__tests__/guidedRecoveryQueue.test.ts`

- [ ] **Step 1: Write failing queue-priority test for guided recovery**

Scenario: server unreachable + missing route + warning quality.
Expected: one recommended first action, then next action based on result.

- [ ] **Step 2: Implement guided recovery queue**

Queue actions by confidence/impact and lock UI while action in progress.

- [ ] **Step 3: Add explicit rollback/undo messaging where applicable**

If fix fails, user gets deterministic next step and no ambiguous state.

- [ ] **Step 4: Validate end-to-end UX manually**

Run: `cd client/windows && npm run dev`
Expected: coherent, stepwise recovery experience with clear progress.

- [ ] **Step 5: Commit**

```bash
git add client/windows/src/components/DiagnosePanel.tsx client/windows/src/App.tsx client/windows/src/i18n/translations.ts
git commit -m "feat(ux): add deterministic guided VPN recovery flow"
```

---

## Verification Matrix (Must Pass Before Merge)

- [ ] `cd server/api && pytest -v`
- [ ] `cd client/windows/src-tauri && cargo check --message-format=short`
- [ ] `cd client/windows/src-tauri && cargo test --test vpn_test`
- [ ] `cd client/windows && npm run build`
- [ ] Validate reconnect path from tray event (`tray-connect` / `tray-disconnect`) still works.
- [ ] Validate `deep_diagnose` still returns backward-compatible `fix_action` IDs.
- [ ] Validate `peers` and `admin` APIs return identical quality labels for same handshake ages.

---

## Rollout Order

1. Ship Phase 2 server threshold unification first.
2. Ship Phase 2 client state-machine and timer gating next.
3. Observe metrics/log stability for 24-48h.
4. Ship Phase 3 UX/support features behind a feature flag if needed.

---

## Risks and Guardrails

- Do not refactor packet-plane internals in `tunnel.rs` during Phase 2 unless tests force it.
- Freeze `fix_action` contract before Phase 3 to avoid UX breakages.
- Keep state machine transitions pure/testable; keep side effects in thin orchestration wrappers.
- Prefer additive UI changes; do not break existing FirstRunWizard flow.

---

## Notes for Implementers

- This plan intentionally favors deterministic behavior over optimistic retries.
- Keep commits small and atomic exactly as task boundaries define.
- If a task spills over, split into a new task with explicit failing test first.
