import { useQuery } from '@tanstack/react-query'
import apiClient from '../api/client'

interface Peer {
  id: string
  name: string
  public_key: string
  allowed_ips: string
  last_handshake?: string
  enabled: boolean
}

function StatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
      enabled
        ? 'bg-green-900/40 text-green-400 border border-green-800/50'
        : 'bg-gray-800 text-gray-500 border border-gray-700'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${enabled ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
      {enabled ? 'Active' : 'Inactive'}
    </span>
  )
}

export default function PeersPage() {
  const { data: peers, isLoading, isError } = useQuery<Peer[]>({
    queryKey: ['peers'],
    queryFn: async () => {
      const res = await apiClient.get<Peer[]>('/peers')
      return res.data
    },
  })

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Peers</h1>
          <p className="text-gray-500 text-sm mt-1">WireGuard peer management</p>
        </div>
        <button className="btn-primary flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Peer
        </button>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        {isLoading && (
          <div className="flex items-center justify-center py-16 text-gray-500">
            <svg className="animate-spin w-6 h-6 mr-3" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading peers…
          </div>
        )}

        {isError && (
          <div className="flex items-center justify-center py-16 text-red-400">
            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            Failed to load peers
          </div>
        )}

        {!isLoading && !isError && (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-800/40">
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Allowed IPs</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Last Handshake</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60">
              {peers && peers.length > 0 ? (
                peers.map((peer) => (
                  <tr key={peer.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-200">{peer.name}</p>
                      <p className="text-xs text-gray-600 font-mono truncate max-w-[200px]">{peer.public_key}</p>
                    </td>
                    <td className="px-6 py-4 font-mono text-sm text-gray-400">{peer.allowed_ips}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {peer.last_handshake ? new Date(peer.last_handshake).toLocaleString() : 'Never'}
                    </td>
                    <td className="px-6 py-4"><StatusBadge enabled={peer.enabled} /></td>
                    <td className="px-6 py-4 text-right">
                      <button className="text-sm text-gray-400 hover:text-gray-200 transition-colors px-3 py-1 rounded-md hover:bg-gray-800">
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center text-gray-600">
                    <svg className="w-10 h-10 mx-auto mb-3 text-gray-800" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    No peers configured yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
