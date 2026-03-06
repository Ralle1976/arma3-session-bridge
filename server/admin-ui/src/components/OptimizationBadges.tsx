interface OptimizationBadgesProps {
  mtu?: number
  keepalive?: number
  serverTuning?: boolean
}

interface BadgeProps {
  label: string
  value: string
  active: boolean
  tooltip: string
}

function Badge({ label, value, active, tooltip }: BadgeProps) {
  return (
    <div
      title={tooltip}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium cursor-default select-none ${
        active
          ? 'bg-green-900/30 border-green-700/50 text-green-300'
          : 'bg-gray-800/50 border-gray-700/50 text-gray-500'
      }`}
    >
      <span className={`text-base ${active ? 'text-green-400' : 'text-gray-600'}`}>
        {active ? '✅' : '⏳'}
      </span>
      <div>
        <div className="text-xs text-gray-500 leading-none mb-0.5">{label}</div>
        <div className={active ? 'text-green-300' : 'text-gray-500'}>{value}</div>
      </div>
    </div>
  )
}

export default function OptimizationBadges({
  mtu = 1420,
  keepalive = 25,
  serverTuning = false,
}: OptimizationBadgesProps) {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Connection Optimizations
      </h3>
      <div className="flex flex-wrap gap-3">
        <Badge
          label="MTU"
          value={`${mtu} bytes`}
          active={mtu === 1420}
          tooltip="MTU 1420 reduces fragmentation for UDP gaming traffic"
        />
        <Badge
          label="PersistentKeepalive"
          value={`${keepalive}s`}
          active={keepalive > 0}
          tooltip="Keepalive packets prevent NAT timeout — critical for Arma 3 sessions"
        />
        <Badge
          label="Server UDP Tuning"
          value={serverTuning ? 'Active' : 'Pending'}
          active={serverTuning}
          tooltip="sysctl: rmem/wmem buffers enlarged for high-throughput UDP (net.core.rmem_max=26214400)"
        />
        <Badge
          label="Split-Tunnel"
          value="10.8.0.0/24"
          active={true}
          tooltip="Only VPN traffic is routed through the tunnel — game traffic stays direct"
        />
      </div>
    </div>
  )
}
