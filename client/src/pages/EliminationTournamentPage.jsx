import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

/**
 * EliminationTournamentPage (scaffold)
 * ------------------------------------------------------------
 * URL: /elimination-tournaments/:id
 * - No data fetching yet.
 * - Tabs: Overview | Rounds | Participants
 * - Back button to Elimination Tournaments list.
 *
 * Next steps (separate, single-file edits):
 * 1) Wire route in App.jsx to point /elimination-tournaments/:id → this page.
 * 2) Hook up Supabase read for tournament header (name/status).
 * 3) Add live rounds + participants queries and UI.
 */
export default function EliminationTournamentPage() {
  const { id } = useParams(); // tournament id from URL
  const navigate = useNavigate();
  const [tab, setTab] = useState("overview");

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "rounds", label: "Rounds" },
    { key: "participants", label: "Participants" },
  ];

  return (
    <div className="min-h-screen w-full bg-gray-50 dark:bg-gray-900">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-8">
        {/* Header */}
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/elimination-tournaments")}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            ← Back
          </button>
          <div className="flex-1">
            {/* Title will later be the tournament name from Supabase */}
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
              Elimination Tournament
            </h1>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              ID: <span className="font-mono">{id}</span>
            </p>
          </div>
          {/* Status badge placeholder (will bind to real data later) */}
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-800 dark:bg-gray-700 dark:text-gray-200">
            Live
          </span>
        </div>

        {/* Tabs */}
        <div className="mb-4 flex items-center gap-2 overflow-x-auto">
          {tabs.map((t) => {
            const isActive = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={[
                  "whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition",
                  isActive
                    ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                    : "bg-white text-gray-700 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700",
                ].join(" ")}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Divider */}
        <div className="mb-6 h-px w-full bg-gray-200 dark:bg-gray-700" />

        {/* Tab content (placeholders for now) */}
        {tab === "overview" && (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <InfoCard title="Rules">
              <ul className="list-disc pl-4 text-sm text-gray-700 dark:text-gray-200">
                <li>All players face the same mystery player each round.</li>
                <li>Round ends when everyone played or time expires.</li>
                <li>Lowest score(s) eliminated. Tie → no one eliminated.</li>
                <li>Continues until a single winner remains.</li>
              </ul>
            </InfoCard>
            <InfoCard title="Settings">
              <p className="text-sm text-gray-700 dark:text-gray-200">
                Difficulty, filters, and time limit will appear here once we load real data.
              </p>
            </InfoCard>
          </section>
        )}

        {tab === "rounds" && (
          <section className="grid grid-cols-1 gap-4">
            <PlaceholderPanel
              title="No rounds yet"
              subtitle="When the first round is created, you'll see it here."
            />
          </section>
        )}

        {tab === "participants" && (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <PlaceholderPanel
              title="No participants to show"
              subtitle="Participants will appear here once we load real data."
            />
          </section>
        )}
      </div>
    </div>
  );
}

function InfoCard({ title, children }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function PlaceholderPanel({ title, subtitle }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm">{subtitle}</p>
    </div>
  );
}
