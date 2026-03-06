import type { Peer } from '../api/peers'

/**
 * Escapes a single CSV cell value.
 */
function escapeCell(value: string): string {
  const escaped = value.replace(/"/g, '""')
  return `"${escaped}"`
}

/**
 * Converts an array of rows (string arrays) to a CSV string.
 */
function rowsToCSV(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCell).join(',')).join('\n')
}

/**
 * Triggers a browser download of CSV data.
 */
function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Exports the peer list as a CSV file.
 */
export function exportPeersToCSV(peers: Peer[]): void {
  const headers = ['ID', 'Name', 'Tunnel IP', 'Allowed IPs', 'Enabled', 'Created At', 'Last Seen', 'Last Handshake']
  const rows = peers.map((p) => [
    p.id,
    p.name,
    p.tunnel_ip,
    p.allowed_ips,
    p.enabled ? 'Yes' : 'No',
    p.created_at,
    p.last_seen ?? '',
    p.last_handshake ?? '',
  ])

  const csv = rowsToCSV([headers, ...rows])
  const date = new Date().toISOString().slice(0, 10)
  downloadCSV(csv, `peers-export-${date}.csv`)
}

/**
 * Generic CSV exporter — pass headers + rows of strings.
 */
export function exportGenericCSV(
  filename: string,
  headers: string[],
  rows: string[][],
): void {
  const csv = rowsToCSV([headers, ...rows])
  downloadCSV(csv, filename)
}
