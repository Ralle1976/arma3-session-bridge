/**
 * vpnErrorCatalog.ts — Error taxonomy for VPN diagnostic steps
 *
 * Maps DiagStep IDs + statuses to user-facing guidance with:
 *  - i18n key references (resolved in DiagnosePanel via t())
 *  - Primary + secondary action recommendations
 *  - Confidence rating (how likely this fix will resolve the issue)
 */

export type DiagStepStatus = 'pass' | 'fail' | 'warn' | 'skip'

export type RecoveryConfidence = 'high' | 'medium' | 'low'

export interface GuidanceEntry {
  /** i18n key for the short title shown in guided recovery panel */
  titleKey: string
  /** i18n key for the longer explanation message */
  messageKey: string
  /** Primary fix action string matching fix_action in DiagStep / handleFix */
  primaryAction: string | null
  /** i18n key for the primary action button label */
  primaryActionLabelKey: string | null
  /** Optional secondary fix action (shown as link/tertiary button) */
  secondaryAction: string | null
  /** i18n key for the secondary action button label */
  secondaryActionLabelKey: string | null
  /** How confident we are that the primary action will resolve this */
  confidence: RecoveryConfidence
  /** Sort priority for the guided recovery queue — lower = shown first */
  priority: number
}

/** Fallback guidance when no specific entry matches */
export const UNKNOWN_GUIDANCE: GuidanceEntry = {
  titleKey:               'errCatalog_unknown_title',
  messageKey:             'errCatalog_unknown_message',
  primaryAction:          'reconnect',
  primaryActionLabelKey:  'diag_fix_reconnect',
  secondaryAction:        null,
  secondaryActionLabelKey: null,
  confidence:             'low',
  priority:               99,
}

/**
 * Catalog entries keyed by `${stepId}:${status}`.
 * Entries for 'fail' are most important; 'warn' entries are optional guidance.
 * 'pass' and 'skip' entries are intentionally omitted (no guidance needed).
 */
const CATALOG: Record<string, GuidanceEntry> = {

  // ── api_reachable ──────────────────────────────────────────────────────────
  'api_reachable:fail': {
    titleKey:               'errCatalog_apiReachable_fail_title',
    messageKey:             'errCatalog_apiReachable_fail_message',
    primaryAction:          'reconnect',
    primaryActionLabelKey:  'diag_fix_reconnect',
    secondaryAction:        'reregister',
    secondaryActionLabelKey: 'diag_fix_reregister',
    confidence:             'medium',
    priority:               1,
  },
  'api_reachable:warn': {
    titleKey:               'errCatalog_apiReachable_warn_title',
    messageKey:             'errCatalog_apiReachable_warn_message',
    primaryAction:          'reconnect',
    primaryActionLabelKey:  'diag_fix_reconnect',
    secondaryAction:        null,
    secondaryActionLabelKey: null,
    confidence:             'medium',
    priority:               5,
  },

  // ── wg_installed ──────────────────────────────────────────────────────────
  'wg_installed:fail': {
    titleKey:               'errCatalog_wgInstalled_fail_title',
    messageKey:             'errCatalog_wgInstalled_fail_message',
    primaryAction:          'install_wg',
    primaryActionLabelKey:  'diag_fix_install',
    secondaryAction:        null,
    secondaryActionLabelKey: null,
    confidence:             'high',
    priority:               2,
  },

  // ── tunnel_active ─────────────────────────────────────────────────────────
  'tunnel_active:fail': {
    titleKey:               'errCatalog_tunnelActive_fail_title',
    messageKey:             'errCatalog_tunnelActive_fail_message',
    primaryAction:          'reconnect',
    primaryActionLabelKey:  'diag_fix_reconnect',
    secondaryAction:        'fix_firewall',
    secondaryActionLabelKey: 'diag_fix_firewall',
    confidence:             'high',
    priority:               1,
  },
  'tunnel_active:warn': {
    titleKey:               'errCatalog_tunnelActive_warn_title',
    messageKey:             'errCatalog_tunnelActive_warn_message',
    primaryAction:          'reconnect',
    primaryActionLabelKey:  'diag_fix_reconnect',
    secondaryAction:        null,
    secondaryActionLabelKey: null,
    confidence:             'medium',
    priority:               3,
  },

  // ── gateway_ping ─────────────────────────────────────────────────────────
  'gateway_ping:fail': {
    titleKey:               'errCatalog_gatewayPing_fail_title',
    messageKey:             'errCatalog_gatewayPing_fail_message',
    primaryAction:          'fix_firewall',
    primaryActionLabelKey:  'diag_fix_firewall',
    secondaryAction:        'reconnect',
    secondaryActionLabelKey: 'diag_fix_reconnect',
    confidence:             'high',
    priority:               2,
  },
  'gateway_ping:warn': {
    titleKey:               'errCatalog_gatewayPing_warn_title',
    messageKey:             'errCatalog_gatewayPing_warn_message',
    primaryAction:          'fix_firewall',
    primaryActionLabelKey:  'diag_fix_firewall',
    secondaryAction:        null,
    secondaryActionLabelKey: null,
    confidence:             'medium',
    priority:               4,
  },

  // ── firewall_rules ────────────────────────────────────────────────────────
  'firewall_rules:fail': {
    titleKey:               'errCatalog_firewallRules_fail_title',
    messageKey:             'errCatalog_firewallRules_fail_message',
    primaryAction:          'fix_firewall',
    primaryActionLabelKey:  'diag_fix_firewall',
    secondaryAction:        null,
    secondaryActionLabelKey: null,
    confidence:             'high',
    priority:               2,
  },
  'firewall_rules:warn': {
    titleKey:               'errCatalog_firewallRules_warn_title',
    messageKey:             'errCatalog_firewallRules_warn_message',
    primaryAction:          'fix_firewall',
    primaryActionLabelKey:  'diag_fix_firewall',
    secondaryAction:        null,
    secondaryActionLabelKey: null,
    confidence:             'high',
    priority:               3,
  },

  // ── peer_registered ──────────────────────────────────────────────────────
  'peer_registered:fail': {
    titleKey:               'errCatalog_peerRegistered_fail_title',
    messageKey:             'errCatalog_peerRegistered_fail_message',
    primaryAction:          'reregister',
    primaryActionLabelKey:  'diag_fix_reregister',
    secondaryAction:        null,
    secondaryActionLabelKey: null,
    confidence:             'high',
    priority:               1,
  },

  // ── server_reachable ──────────────────────────────────────────────────────
  'server_reachable:fail': {
    titleKey:               'errCatalog_serverReachable_fail_title',
    messageKey:             'errCatalog_serverReachable_fail_message',
    primaryAction:          'reconnect',
    primaryActionLabelKey:  'diag_fix_reconnect',
    secondaryAction:        'fix_firewall',
    secondaryActionLabelKey: 'diag_fix_firewall',
    confidence:             'medium',
    priority:               2,
  },
  'server_reachable:warn': {
    titleKey:               'errCatalog_serverReachable_warn_title',
    messageKey:             'errCatalog_serverReachable_warn_message',
    primaryAction:          'reconnect',
    primaryActionLabelKey:  'diag_fix_reconnect',
    secondaryAction:        null,
    secondaryActionLabelKey: null,
    confidence:             'low',
    priority:               6,
  },

  // ── dns_resolution ────────────────────────────────────────────────────────
  'dns_resolution:fail': {
    titleKey:               'errCatalog_dnsResolution_fail_title',
    messageKey:             'errCatalog_dnsResolution_fail_message',
    primaryAction:          'reconnect',
    primaryActionLabelKey:  'diag_fix_reconnect',
    secondaryAction:        null,
    secondaryActionLabelKey: null,
    confidence:             'low',
    priority:               3,
  },

  // ── wg_config_valid ───────────────────────────────────────────────────────
  'wg_config_valid:fail': {
    titleKey:               'errCatalog_wgConfigValid_fail_title',
    messageKey:             'errCatalog_wgConfigValid_fail_message',
    primaryAction:          'reregister',
    primaryActionLabelKey:  'diag_fix_reregister',
    secondaryAction:        null,
    secondaryActionLabelKey: null,
    confidence:             'high',
    priority:               1,
  },
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Look up guidance for a diagnostic step result.
 *
 * @param stepId   - The `id` field from DiagStep (e.g. 'tunnel_active')
 * @param status   - The `status` field from DiagStep
 * @returns        GuidanceEntry or UNKNOWN_GUIDANCE if no match
 *
 * @example
 * const entry = mapDiagStepToGuidance({ id: 'server_reachable', status: 'fail' })
 * // entry.titleKey, entry.primaryAction, entry.confidence, entry.secondaryAction
 */
export function mapDiagStepToGuidance(step: {
  id: string
  status: DiagStepStatus
}): GuidanceEntry {
  const key = `${step.id}:${step.status}`
  return CATALOG[key] ?? UNKNOWN_GUIDANCE
}

/**
 * Build a prioritised list of guidance entries for all failing/warning steps.
 * Returns entries sorted by priority (ascending — lower = more critical).
 *
 * @param steps  Array of DiagStep objects from DeepDiagnoseResult
 * @returns      Deduplicated, sorted GuidanceEntry array (only fail/warn)
 */
export function buildRecoveryQueue(steps: Array<{
  id: string
  status: DiagStepStatus
}>): GuidanceEntry[] {
  const seen = new Set<string>()
  const queue: GuidanceEntry[] = []

  for (const step of steps) {
    if (step.status !== 'fail' && step.status !== 'warn') continue
    const entry = mapDiagStepToGuidance(step)
    // Deduplicate by primaryAction — don't show same fix twice
    const dedupeKey = entry.primaryAction ?? entry.titleKey
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey)
      queue.push(entry)
    }
  }

  return queue.sort((a, b) => a.priority - b.priority)
}
