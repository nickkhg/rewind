import { useState, useEffect, useRef, useCallback } from "react";
import { fetchTeams } from "../../lib/api";
import type { Team, TeamMember, ClientMessage } from "../../lib/types";

// --- Carnival color palette for wheel segments ---
const SEGMENT_COLORS = [
  "#1a0a2e", // deep indigo
  "#2d1b4e", // dark purple
  "#1e3a5f", // midnight blue
  "#0d2137", // navy
  "#2a1a3e", // plum
  "#1a2e4a", // dark slate blue
  "#3d1f56", // rich purple
  "#0f2d3d", // dark teal
] as const;

const GOLD = "#f0c040";
const GOLD_GLOW = "#f0c04080";
const NEON_RED = "#ff3366";

interface WheelEntry {
  id: string;
  name: string;
}

// --- Spinning Wheel Canvas ---

function SpinningWheel({
  entries,
  onResult,
  onBack,
  send,
  boardColumns,
}: {
  entries: WheelEntry[];
  onResult: (entry: WheelEntry) => void;
  onBack: () => void;
  send: (msg: ClientMessage) => void;
  boardColumns: { id: string; name: string }[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const [, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<WheelEntry | null>(null);
  const velocityRef = useRef(0);
  const rotationRef = useRef(0);

  const segmentAngle = (2 * Math.PI) / entries.length;

  // Draw the wheel
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, currentRotation: number) => {
      const size = ctx.canvas.width;
      const cx = size / 2;
      const cy = size / 2;
      const radius = size / 2 - 20;

      ctx.clearRect(0, 0, size, size);

      // Outer glow ring
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 8, 0, 2 * Math.PI);
      ctx.strokeStyle = GOLD_GLOW;
      ctx.lineWidth = 4;
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 20;
      ctx.stroke();
      ctx.restore();

      // Draw segments
      entries.forEach((entry, i) => {
        const startAngle = currentRotation + i * segmentAngle;
        const endAngle = startAngle + segmentAngle;

        // Segment fill
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, startAngle, endAngle);
        ctx.closePath();
        ctx.fillStyle = SEGMENT_COLORS[i % SEGMENT_COLORS.length];
        ctx.fill();

        // Segment border
        ctx.strokeStyle = GOLD + "40";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();

        // Text
        ctx.save();
        const textAngle = startAngle + segmentAngle / 2;
        const textRadius = radius * 0.62;
        ctx.translate(
          cx + Math.cos(textAngle) * textRadius,
          cy + Math.sin(textAngle) * textRadius
        );
        ctx.rotate(textAngle + Math.PI / 2);

        // Text styling
        const fontSize = Math.max(11, Math.min(16, 280 / entries.length));
        ctx.font = `600 ${fontSize}px "Plus Jakarta Sans", sans-serif`;
        ctx.fillStyle = "#e8e4df";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0,0,0,0.6)";
        ctx.shadowBlur = 4;

        // Truncate long names
        const maxWidth = radius * 0.55;
        let displayName = entry.name;
        while (ctx.measureText(displayName).width > maxWidth && displayName.length > 3) {
          displayName = displayName.slice(0, -2) + "\u2026";
        }
        ctx.fillText(displayName, 0, 0);
        ctx.restore();
      });

      // Center hub
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, 28, 0, 2 * Math.PI);
      const hubGrad = ctx.createRadialGradient(cx, cy, 5, cx, cy, 28);
      hubGrad.addColorStop(0, "#2d2a26");
      hubGrad.addColorStop(1, "#1a1816");
      ctx.fillStyle = hubGrad;
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 15;
      ctx.fill();
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // Hub icon (skull/crossbones for misfortune vibe)
      ctx.save();
      ctx.font = "18px serif";
      ctx.fillStyle = GOLD;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("\u2620", cx, cy);
      ctx.restore();

      // Pointer (top, pointing down)
      ctx.save();
      ctx.beginPath();
      const pointerX = cx;
      const pointerY = cy - radius + 5;
      ctx.moveTo(pointerX - 14, pointerY - 28);
      ctx.lineTo(pointerX + 14, pointerY - 28);
      ctx.lineTo(pointerX, pointerY);
      ctx.closePath();
      ctx.fillStyle = NEON_RED;
      ctx.shadowColor = NEON_RED;
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    },
    [entries, segmentAngle]
  );

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set up HiDPI
    const dpr = window.devicePixelRatio || 1;
    const displaySize = 380;
    canvas.width = displaySize * dpr;
    canvas.height = displaySize * dpr;
    canvas.style.width = `${displaySize}px`;
    canvas.style.height = `${displaySize}px`;
    ctx.scale(dpr, dpr);
    // Reset scale reference for draw
    canvas.width = displaySize;
    canvas.height = displaySize;

    draw(ctx, rotationRef.current);
  }, [draw]);

  // Animation tick
  useEffect(() => {
    if (!spinning) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const drawCtx: CanvasRenderingContext2D = ctx;

    let lastTime = performance.now();

    function tick(now: number) {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      // Decelerate with friction
      velocityRef.current *= Math.pow(0.985, dt * 60);

      // Stop when slow enough
      if (Math.abs(velocityRef.current) < 0.002) {
        velocityRef.current = 0;
        setSpinning(false);

        // Determine which segment is at the top (pointer is at -PI/2 from canvas perspective)
        const pointerAngle = -Math.PI / 2;
        const normalizedRotation =
          ((pointerAngle - rotationRef.current) % (2 * Math.PI) + 2 * Math.PI) %
          (2 * Math.PI);
        const segIndex = Math.floor(normalizedRotation / segmentAngle) % entries.length;
        const winner = entries[segIndex];
        setResult(winner);
        onResult(winner);
        return;
      }

      rotationRef.current += velocityRef.current * dt;
      setRotation(rotationRef.current);
      draw(drawCtx, rotationRef.current);
      animRef.current = requestAnimationFrame(tick);
    }

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [spinning, draw, entries, segmentAngle, onResult]);

  function handleSpin() {
    if (spinning) return;
    setResult(null);
    // Random velocity between 12 and 22 rad/s
    velocityRef.current = 12 + Math.random() * 10;
    setSpinning(true);
  }

  function handleAccept() {
    if (!result) return;
    // Add ticket to last column
    const lastColumn = boardColumns[boardColumns.length - 1];
    if (lastColumn) {
      send({
        type: "AddTicket",
        payload: {
          column_id: lastColumn.id,
          content: `\u{1F3B0} Next retro facilitator: ${result.name}`,
        },
      });
    }
  }

  function handleSpinAgain() {
    setResult(null);
    handleSpin();
  }

  return (
    <div className="flex flex-col items-center gap-5">
      {/* Wheel */}
      <div className="relative">
        <canvas ref={canvasRef} className="drop-shadow-2xl" />

        {/* Decorative pulsing dots around the rim */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            animation: spinning ? "wheel-glow 0.5s ease-in-out infinite alternate" : "none",
          }}
        >
          <div
            className="absolute inset-3 rounded-full"
            style={{
              boxShadow: spinning
                ? `0 0 30px ${GOLD_GLOW}, inset 0 0 30px ${GOLD_GLOW}`
                : "none",
              transition: "box-shadow 0.3s",
            }}
          />
        </div>
      </div>

      {/* Controls */}
      {!result ? (
        <button
          onClick={handleSpin}
          disabled={spinning}
          className="relative overflow-hidden px-10 py-3 rounded-full font-display text-lg font-bold tracking-wide transition-all duration-300"
          style={{
            background: spinning
              ? "linear-gradient(135deg, #2d1b4e, #1a0a2e)"
              : `linear-gradient(135deg, ${NEON_RED}, #cc2255)`,
            color: "#fff",
            boxShadow: spinning
              ? "none"
              : `0 0 20px ${NEON_RED}60, 0 4px 15px rgba(0,0,0,0.3)`,
            opacity: spinning ? 0.6 : 1,
            cursor: spinning ? "not-allowed" : "pointer",
            letterSpacing: "0.05em",
          }}
        >
          {spinning ? "Spinning..." : "SPIN"}
        </button>
      ) : (
        <div className="flex flex-col items-center gap-3 animate-fade-in">
          <div className="text-center">
            <p
              className="text-xs uppercase tracking-widest mb-1"
              style={{ color: GOLD }}
            >
              The wheel has spoken
            </p>
            <p
              className="font-display text-2xl font-bold"
              style={{
                color: "#fff",
                textShadow: `0 0 20px ${GOLD}80`,
              }}
            >
              {result.name}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleSpinAgain}
              className="px-5 py-2 rounded-full text-sm font-semibold transition-all duration-200"
              style={{
                background: "transparent",
                border: `1.5px solid ${GOLD}60`,
                color: GOLD,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = GOLD;
                e.currentTarget.style.boxShadow = `0 0 12px ${GOLD}40`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = `${GOLD}60`;
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              Spin again
            </button>
            <button
              onClick={handleAccept}
              className="px-5 py-2 rounded-full text-sm font-bold transition-all duration-200"
              style={{
                background: `linear-gradient(135deg, ${GOLD}, #d4a030)`,
                color: "#1a0a2e",
                boxShadow: `0 0 15px ${GOLD}50`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = `0 0 25px ${GOLD}80`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = `0 0 15px ${GOLD}50`;
              }}
            >
              Accept fate
            </button>
          </div>
        </div>
      )}

      <button
        onClick={onBack}
        className="text-xs transition-colors"
        style={{ color: "#7a736d" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "#e8e4df")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "#7a736d")}
      >
        &larr; Back to selection
      </button>
    </div>
  );
}

// --- Team/Member Selection ---

function MemberSelector({
  teams,
  onStart,
}: {
  teams: Team[];
  onStart: (entries: WheelEntry[]) => void;
}) {
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());

  const selectedTeam = teams.find((t) => t.id === selectedTeamId);

  function handleSelectTeam(team: Team) {
    setSelectedTeamId(team.id);
    // Select all members by default
    setSelectedMembers(new Set(team.members.map((m) => m.id)));
  }

  function toggleMember(member: TeamMember) {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(member.id)) {
        next.delete(member.id);
      } else {
        next.add(member.id);
      }
      return next;
    });
  }

  function handleStart() {
    if (!selectedTeam) return;
    const entries = selectedTeam.members
      .filter((m) => selectedMembers.has(m.id))
      .map((m) => ({ id: m.id, name: m.name }));
    if (entries.length >= 2) {
      onStart(entries);
    }
  }

  return (
    <div className="space-y-4 w-full max-w-sm">
      <h3
        className="font-display text-lg font-bold text-center tracking-wide"
        style={{ color: GOLD }}
      >
        Choose your victims
      </h3>

      {!selectedTeam ? (
        <div className="space-y-2">
          {teams.map((team) => (
            <button
              key={team.id}
              onClick={() => handleSelectTeam(team)}
              className="w-full text-left px-4 py-3 rounded-xl transition-all duration-200 group"
              style={{
                background: "rgba(45, 27, 78, 0.5)",
                border: "1px solid rgba(240, 192, 64, 0.15)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = `${GOLD}50`;
                e.currentTarget.style.boxShadow = `0 0 15px ${GOLD}15`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "rgba(240, 192, 64, 0.15)";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              <div className="font-semibold text-sm" style={{ color: "#e8e4df" }}>
                {team.name}
              </div>
              <div className="text-xs mt-0.5" style={{ color: "#7a736d" }}>
                {team.members.length} member{team.members.length !== 1 ? "s" : ""}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <button
            onClick={() => {
              setSelectedTeamId(null);
              setSelectedMembers(new Set());
            }}
            className="text-xs transition-colors"
            style={{ color: "#7a736d" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#e8e4df")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#7a736d")}
          >
            &larr; {selectedTeam.name}
          </button>

          <div className="space-y-1.5">
            {selectedTeam.members.map((member) => {
              const isSelected = selectedMembers.has(member.id);
              return (
                <button
                  key={member.id}
                  onClick={() => toggleMember(member)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-left text-sm transition-all duration-150"
                  style={{
                    background: isSelected
                      ? "rgba(240, 192, 64, 0.12)"
                      : "rgba(255,255,255,0.03)",
                    border: `1px solid ${isSelected ? GOLD + "40" : "rgba(255,255,255,0.06)"}`,
                    color: isSelected ? "#e8e4df" : "#7a736d",
                  }}
                >
                  <span
                    className="w-5 h-5 rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all"
                    style={{
                      background: isSelected ? GOLD : "transparent",
                      border: isSelected ? "none" : "1.5px solid #7a736d40",
                      color: isSelected ? "#1a0a2e" : "transparent",
                    }}
                  >
                    {isSelected ? "\u2713" : ""}
                  </span>
                  {member.name}
                </button>
              );
            })}
          </div>

          <button
            onClick={handleStart}
            disabled={selectedMembers.size < 2}
            className="w-full py-2.5 rounded-full font-display font-bold text-sm tracking-wide transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background:
                selectedMembers.size >= 2
                  ? `linear-gradient(135deg, ${NEON_RED}, #cc2255)`
                  : "rgba(255,255,255,0.05)",
              color: "#fff",
              boxShadow:
                selectedMembers.size >= 2
                  ? `0 0 20px ${NEON_RED}40`
                  : "none",
            }}
          >
            {selectedMembers.size < 2
              ? "Select at least 2"
              : `Spin with ${selectedMembers.size} people`}
          </button>
        </div>
      )}
    </div>
  );
}

// --- Main Modal ---

type ModalPhase = "select" | "wheel";

export function WheelOfMisfortuneButton({
  send,
  boardColumns,
}: {
  send: (msg: ClientMessage) => void;
  boardColumns: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<ModalPhase>("select");
  const [entries, setEntries] = useState<WheelEntry[]>([]);
  const [accepted, setAccepted] = useState(false);

  async function handleOpen() {
    setOpen(true);
    setPhase("select");
    setEntries([]);
    setAccepted(false);
    setLoading(true);
    try {
      const t = await fetchTeams();
      setTeams(t);
    } catch {
      setTeams([]);
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setOpen(false);
  }

  function handleStart(selected: WheelEntry[]) {
    setEntries(selected);
    setPhase("wheel");
  }

  if (!open) {
    return (
      <button
        onClick={handleOpen}
        className="fixed bottom-5 right-[4.25rem] z-30 flex items-center gap-2 px-4 py-2.5 rounded-full font-display text-sm font-bold transition-all duration-300 group"
        style={{
          background: "linear-gradient(135deg, #1a0a2e, #2d1b4e)",
          color: GOLD,
          border: `1.5px solid ${GOLD}30`,
          boxShadow: `0 4px 20px rgba(0,0,0,0.3), 0 0 15px ${GOLD}10`,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow = `0 4px 25px rgba(0,0,0,0.4), 0 0 25px ${GOLD}25`;
          e.currentTarget.style.borderColor = `${GOLD}60`;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = `0 4px 20px rgba(0,0,0,0.3), 0 0 15px ${GOLD}10`;
          e.currentTarget.style.borderColor = `${GOLD}30`;
        }}
      >
        <span className="text-lg leading-none">{"\u{1F3B0}"}</span>
        Wheel of Misfortune
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in"
      style={{ background: "rgba(0, 0, 0, 0.85)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      {/* Decorative background noise */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.5'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
          backgroundSize: "256px 256px",
        }}
      />

      <div
        className="relative flex flex-col items-center p-8 rounded-2xl max-w-lg w-full mx-4 animate-slide-up"
        style={{
          background: "linear-gradient(180deg, #120a1e 0%, #0d0815 100%)",
          border: `1px solid ${GOLD}15`,
          boxShadow: `0 25px 60px rgba(0,0,0,0.6), 0 0 40px ${GOLD}08`,
        }}
      >
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full transition-colors text-lg leading-none"
          style={{ color: "#7a736d" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#e8e4df")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#7a736d")}
        >
          &times;
        </button>

        {/* Title */}
        <h2
          className="font-display text-2xl font-bold tracking-wide mb-1"
          style={{
            color: GOLD,
            textShadow: `0 0 30px ${GOLD}40`,
          }}
        >
          Wheel of Misfortune
        </h2>
        <p className="text-xs mb-6" style={{ color: "#7a736d" }}>
          Who will run the next retro?
        </p>

        {loading ? (
          <div className="py-12 text-sm" style={{ color: "#7a736d" }}>
            Loading teams...
          </div>
        ) : teams.length === 0 ? (
          <div className="py-12 text-center space-y-2">
            <p className="text-sm" style={{ color: "#7a736d" }}>
              No teams configured yet.
            </p>
            <p className="text-xs" style={{ color: "#5a534d" }}>
              Ask a Rewind admin to create teams.
            </p>
          </div>
        ) : phase === "select" ? (
          <MemberSelector teams={teams} onStart={handleStart} />
        ) : (
          <SpinningWheel
            entries={entries}
            onResult={() => {}}
            onBack={() => setPhase("select")}
            send={(msg) => {
              send(msg);
              setAccepted(true);
              // Close after a brief delay so the user sees it worked
              setTimeout(() => setOpen(false), 800);
            }}
            boardColumns={boardColumns}
          />
        )}

        {accepted && (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-2xl animate-fade-in"
            style={{ background: "rgba(18, 10, 30, 0.95)" }}
          >
            <div className="text-center space-y-2">
              <p className="text-3xl">{"\u2705"}</p>
              <p className="font-display font-bold" style={{ color: GOLD }}>
                Ticket created!
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
