import { useCallback, useEffect, useState } from "react";
import { Logo } from "../components/layout/Logo";
import type { AdminBoardDetail, AdminBoardSummary, GlobalStats } from "../lib/types";
import {
  deleteAdminBoard,
  fetchAdminBoardDetail,
  fetchAdminBoards,
  fetchAdminStats,
  verifyAdminToken,
} from "../lib/api";

const STORAGE_KEY = "admin_token";

// --- Sub-components ---

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-surface border border-border rounded-lg px-4 py-3">
      <div className="text-2xl font-bold font-display">{value}</div>
      <div className="text-xs text-muted mt-0.5">{label}</div>
    </div>
  );
}

function BoardDetailPanel({
  detail,
  onDelete,
  onClose,
}: {
  detail: AdminBoardDetail;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
      <div className="flex items-start justify-between">
        <h3 className="font-display text-lg font-semibold">{detail.title}</h3>
        <button
          onClick={onClose}
          className="text-muted hover:text-ink transition-colors text-lg leading-none"
        >
          &times;
        </button>
      </div>

      <dl className="text-sm space-y-2">
        <div className="flex justify-between">
          <dt className="text-muted">ID</dt>
          <dd className="font-mono text-xs">{detail.id}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Created</dt>
          <dd>{new Date(detail.created_at).toLocaleString()}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Blurred</dt>
          <dd>{detail.is_blurred ? "Yes" : "No"}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Online</dt>
          <dd>{detail.online_participants}</dd>
        </div>
        <div>
          <dt className="text-muted mb-1">Facilitator token</dt>
          <dd className="font-mono text-xs bg-canvas rounded px-2 py-1 break-all border border-border">
            {detail.facilitator_token}
          </dd>
        </div>
        <div>
          <dt className="text-muted mb-1">Columns</dt>
          <dd>
            <ul className="space-y-1">
              {detail.columns.map((col) => (
                <li key={col.id} className="flex justify-between text-xs">
                  <span>{col.name}</span>
                  <span className="text-muted">
                    {col.ticket_count} ticket{col.ticket_count !== 1 ? "s" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>

      <div className="flex gap-2 pt-2">
        <a
          href={`/board/${detail.id}`}
          className="flex-1 text-center text-sm bg-accent text-white py-1.5 rounded-lg hover:bg-accent-hover transition-colors"
        >
          Open board
        </a>
        <button
          onClick={onDelete}
          className="flex-1 text-sm bg-red-600 text-white py-1.5 rounded-lg hover:bg-red-700 transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function DeleteConfirmDialog({
  boardTitle,
  onConfirm,
  onCancel,
}: {
  boardTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface border border-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-lg space-y-4">
        <h3 className="font-display text-lg font-semibold">Delete board?</h3>
        <p className="text-sm text-muted">
          This will permanently delete <strong className="text-ink">{boardTitle}</strong> and all
          its tickets and votes. This cannot be undone.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 text-sm border border-border py-2 rounded-lg hover:bg-canvas transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 text-sm bg-red-600 text-white py-2 rounded-lg hover:bg-red-700 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Main component ---

export default function Admin() {
  const [token, setToken] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);

  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [boards, setBoards] = useState<AdminBoardSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminBoardDetail | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminBoardSummary | null>(null);
  const [loadingData, setLoadingData] = useState(false);

  const getToken = useCallback(() => {
    return sessionStorage.getItem(STORAGE_KEY) ?? "";
  }, []);

  const loadDashboard = useCallback(async (t: string) => {
    setLoadingData(true);
    try {
      const [s, b] = await Promise.all([fetchAdminStats(t), fetchAdminBoards(t)]);
      setStats(s);
      setBoards(b);
    } catch {
      // Token may have expired
      sessionStorage.removeItem(STORAGE_KEY);
      setAuthenticated(false);
    } finally {
      setLoadingData(false);
    }
  }, []);

  // Auto-verify stored token on mount
  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      verifyAdminToken(stored)
        .then(() => {
          setAuthenticated(true);
          loadDashboard(stored);
        })
        .catch(() => {
          sessionStorage.removeItem(STORAGE_KEY);
        })
        .finally(() => setInitializing(false));
    } else {
      setInitializing(false);
    }
  }, [loadDashboard]);

  // Load detail when selection changes
  useEffect(() => {
    if (!selectedId || !authenticated) {
      setDetail(null);
      return;
    }
    fetchAdminBoardDetail(getToken(), selectedId)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [selectedId, authenticated, getToken]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      await verifyAdminToken(token);
      sessionStorage.setItem(STORAGE_KEY, token);
      setAuthenticated(true);
      loadDashboard(token);
    } catch {
      setLoginError("Invalid admin token");
    } finally {
      setLoginLoading(false);
    }
  }

  function handleLogout() {
    sessionStorage.removeItem(STORAGE_KEY);
    setAuthenticated(false);
    setStats(null);
    setBoards([]);
    setSelectedId(null);
    setDetail(null);
    setToken("");
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteAdminBoard(getToken(), deleteTarget.id);
      setDeleteTarget(null);
      if (selectedId === deleteTarget.id) {
        setSelectedId(null);
        setDetail(null);
      }
      loadDashboard(getToken());
    } catch {
      // Refresh anyway
      loadDashboard(getToken());
      setDeleteTarget(null);
    }
  }

  if (initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted">Loading...</p>
      </div>
    );
  }

  // --- Login view ---
  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <Logo className="text-4xl text-accent" />
            <p className="mt-2 text-muted text-sm">Admin access</p>
          </div>

          <form
            onSubmit={handleLogin}
            className="bg-surface rounded-2xl shadow-sm border border-border p-6 space-y-4"
          >
            <div>
              <label htmlFor="admin-token" className="block text-sm font-medium mb-1.5">
                Admin token
              </label>
              <input
                id="admin-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Enter admin token"
                className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 bg-canvas"
                autoFocus
              />
            </div>

            {loginError && <p className="text-sm text-red-600">{loginError}</p>}

            <button
              type="submit"
              disabled={loginLoading || !token.trim()}
              className="w-full bg-accent text-white font-medium py-2 rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50 text-sm"
            >
              {loginLoading ? "Verifying..." : "Log in"}
            </button>
          </form>

          <p className="text-center mt-4">
            <a href="/" className="text-xs text-muted hover:text-ink transition-colors">
              Back to home
            </a>
          </p>
        </div>
      </div>
    );
  }

  // --- Dashboard view ---
  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-border bg-surface/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo className="text-xl text-accent" />
            <span className="text-xs font-medium bg-accent/10 text-accent px-2 py-0.5 rounded-full">
              Admin
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="text-xs text-muted hover:text-ink transition-colors"
          >
            Log out
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard label="Boards" value={stats.board_count} />
            <StatCard label="Tickets" value={stats.ticket_count} />
            <StatCard label="Votes" value={stats.vote_count} />
            <StatCard label="Online" value={stats.online_participants} />
          </div>
        )}

        <div className="flex gap-6">
          {/* Board table */}
          <div className="flex-1 min-w-0">
            <div className="bg-surface border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h2 className="font-display font-semibold text-sm">
                  Boards ({boards.length})
                </h2>
                <button
                  onClick={() => loadDashboard(getToken())}
                  disabled={loadingData}
                  className="text-xs text-muted hover:text-ink transition-colors disabled:opacity-50"
                >
                  {loadingData ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              {boards.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted">No boards yet</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted border-b border-border">
                        <th className="px-4 py-2 font-medium">Title</th>
                        <th className="px-4 py-2 font-medium">Cols</th>
                        <th className="px-4 py-2 font-medium">Tickets</th>
                        <th className="px-4 py-2 font-medium">Votes</th>
                        <th className="px-4 py-2 font-medium">Online</th>
                        <th className="px-4 py-2 font-medium">Created</th>
                        <th className="px-4 py-2 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {boards.map((b) => (
                        <tr
                          key={b.id}
                          onClick={() => setSelectedId(selectedId === b.id ? null : b.id)}
                          className={`border-b border-border last:border-b-0 cursor-pointer transition-colors ${
                            selectedId === b.id
                              ? "bg-accent/5"
                              : "hover:bg-canvas"
                          }`}
                        >
                          <td className="px-4 py-2.5 font-medium truncate max-w-[200px]">
                            {b.title}
                            {b.is_blurred && (
                              <span className="ml-1.5 text-xs text-muted" title="Blurred">
                                blur
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-muted">{b.column_count}</td>
                          <td className="px-4 py-2.5 text-muted">{b.ticket_count}</td>
                          <td className="px-4 py-2.5 text-muted">{b.vote_count}</td>
                          <td className="px-4 py-2.5 text-muted">{b.online_participants}</td>
                          <td className="px-4 py-2.5 text-muted text-xs">
                            {new Date(b.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-2.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTarget(b);
                              }}
                              className="text-xs text-red-500 hover:text-red-700 transition-colors"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Detail panel */}
          {detail && selectedId && (
            <div className="w-80 shrink-0 hidden lg:block sticky top-20 self-start">
              <BoardDetailPanel
                detail={detail}
                onClose={() => {
                  setSelectedId(null);
                  setDetail(null);
                }}
                onDelete={() => {
                  const board = boards.find((b) => b.id === selectedId);
                  if (board) setDeleteTarget(board);
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      {deleteTarget && (
        <DeleteConfirmDialog
          boardTitle={deleteTarget.title}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
