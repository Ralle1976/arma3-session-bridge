import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listPeers, deletePeer, downloadConfig, type Peer } from '../api/peers'
import AddPeerModal from '../components/AddPeerModal'

function StatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
        enabled
          ? 'bg-green-900/40 text-green-400 border border-green-800/50'
          : 'bg-gray-800 text-gray-500 border border-gray-700'
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          enabled ? 'bg-green-400 animate-pulse' : 'bg-gray-600'
        }`}
      />
      {enabled ? 'Active' : 'Inactive'}
    </span>
  )
}

function truncateKey(key: string, len = 24): string {
  return key.length > len ? `${key.slice(0, len)}…` : key
}

export default function PeersPage() {
  const [showAddModal, setShowAddModal] = useState(false)
  const queryClient = useQueryClient()

  const { data: peers, isLoading, isError } = useQuery<Peer[]>({
    queryKey: ['peers'],
    queryFn: listPeers,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePeer(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['peers'] })
    },
  })

  function handleDelete(peer: Peer) {
    if (!window.confirm(`Delete peer "${peer.name}"? This action cannot be undone.`)) return
    deleteMutation.mutate(peer.id)
  }

  function handleDownload(peer: Peer) {
    void downloadConfig(peer.id, peer.name)
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Peers</h1>
          <p className="text-gray-500 text-sm mt-1">WireGuard peer management</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="btn-primary flex items-center gap-2"
        >
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
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            Failed to load peers
          </div>
        )}

        {!isLoading && !isError && (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-800/40">
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Tunnel IP
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Public Key
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Created
                </th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60">
              {peers && peers.length > 0 ? (
                peers.map((peer) => (
                  <tr key={peer.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-200">{peer.name}</p>
                    </td>
                    <td className="px-6 py-4 font-mono text-sm text-gray-400">
                      {peer.tunnel_ip}
                    </td>
                    <td className="px-6 py-4 font-mono text-sm text-gray-500" title={peer.public_key}>
                      {truncateKey(peer.public_key)}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge enabled={peer.enabled} />
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {peer.created_at
                        ? new Date(peer.created_at).toLocaleDateString()
                        : '—'}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* Download .conf */}
                        <button
                          onClick={() => handleDownload(peer)}
                          title="Download .conf"
                          aria-label={`Download config for ${peer.name}`}
                          className="text-sm text-blue-400 hover:text-blue-300 transition-colors px-2 py-1 rounded-md hover:bg-gray-800"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                            />
                          </svg>
                        </button>

                        {/* Delete */}
                        <button
                          onClick={() => handleDelete(peer)}
                          disabled={deleteMutation.isPending}
                          title="Delete peer"
                          aria-label={`Delete peer ${peer.name}`}
                          className="text-sm text-red-500 hover:text-red-400 transition-colors px-2 py-1 rounded-md hover:bg-red-900/20 disabled:opacity-50"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center text-gray-600">
                    <svg
                      className="w-10 h-10 mx-auto mb-3 text-gray-800"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                    No peers configured yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Peer Modal */}
      {showAddModal && <AddPeerModal onClose={() => setShowAddModal(false)} />}
    </div>
  )
}
