import React, { useState, useMemo, useEffect } from "react";
import Layout from "@theme/Layout";
import Heading from "@theme/Heading";
import Link from "@docusaurus/Link";

import styles from "./leaderboard.module.css";

// Supabase public config — safe to embed (RLS restricts to read-only)
const SUPABASE_URL = "https://sjdomynysdljkbemupqa.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_bV6CFNFnzxhQI0wlBx2J0A_5Vm5gFBp";

// Hardcoded dataset metadata (not stored in Supabase)
const DATASETS = [
  {
    id: "edtekla-dev-v1",
    name: "EDTeKLA Development Set v1",
    pair: "eng → crk",
    domain: "educational",
    size: 124,
    version: "1.0.0",
    source: "EDTeKLA project, University of Alberta",
    notes: "62 gold standard + 62 textbook entries. DO NOT TRAIN.",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a pair code like "en>crk" to a display string "EN → CRK".
 */
function formatPair(pair) {
  const [src, tgt] = pair.split(">");
  return `${src.toUpperCase()} → ${tgt.toUpperCase()}`;
}

/**
 * Format an ISO date string (YYYY-MM-DD) as "MMM D, YYYY".
 */
function formatDate(iso) {
  const date = new Date(iso + "T00:00:00"); // avoid timezone shift
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/**
 * Metric key → human label mapping.
 */
const METRIC_META = {
  chrF: { label: "chrF++", suffix: "", nullable: false },
  exactMatch: { label: "Exact Match", suffix: "%", nullable: false },
  fstAcceptance: { label: "FST Acceptance", suffix: "%", nullable: true },
};

/**
 * Format a metric value, handling null gracefully.
 * Returns "N/A" for null/undefined values.
 */
function formatMetric(value, suffix) {
  if (value == null) return "N/A";
  return `${value}${suffix}`;
}

/**
 * Format USD cost as a dollar string, e.g. 0.051 → "$0.051".
 */
function formatCost(cost) {
  if (cost == null) return null;
  return `$${cost.toFixed(3)}`;
}

/**
 * Format duration in seconds, e.g. 6.8 → "6.8s".
 */
function formatDuration(seconds) {
  if (seconds == null) return null;
  return `${seconds}s`;
}

/**
 * Condition groups for the filter UI.
 * Groups related conditions into categories so 18 conditions
 * don't overwhelm the pill bar.
 */
const CONDITION_GROUPS = [
  { key: "naive", label: "Naive" },
  { key: "coached", label: "Coached" },
  { key: "v3", label: "v3" },
  { key: "v4", label: "v4" },
  { key: "v5", label: "v5" },
  { key: "v6", label: "v6" },
  { key: "v7", label: "v7" },
  { key: "fst", label: "FST", isPrefix: true },
];

/**
 * Trust level → display config.
 */
const TRUST_META = {
  self: { label: "Self-benchmarked", className: styles.trustSelf },
  verified: { label: "GDS Verified", className: styles.trustVerified },
  community: { label: "Community Validated", className: styles.trustCommunity },
};

/**
 * Sortable column definitions.
 * `accessor` is a function that takes an entry and returns a sortable value.
 */
const SORT_COLUMNS = {
  method: { label: "Method", accessor: (e) => e.method },
  model: { label: "Model", accessor: (e) => e.model },
  chrF: { label: "chrF++", accessor: (e) => e.metrics.chrF ?? -Infinity },
  exactMatch: { label: "EM%", accessor: (e) => e.metrics.exactMatch ?? -Infinity },
  fstAcceptance: { label: "FST%", accessor: (e) => e.metrics.fstAcceptance ?? -Infinity },
  author: { label: "Author", accessor: (e) => e.author },
  date: { label: "Date", accessor: (e) => e.date },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Trust badge pill. */
function TrustBadge({ trust }) {
  const meta = TRUST_META[trust] || TRUST_META.self;
  return (
    <span className={`${styles.trustBadge} ${meta.className}`}>
      {meta.label}
    </span>
  );
}

/** Expanded row detail panel. */
function RowDetail({ entry }) {
  const dataset = DATASETS.find(
    (d) => d.id === entry.dataset,
  );

  return (
    <div className={styles.expandedInner}>
      {/* Metrics — handles null fstAcceptance gracefully */}
      {Object.entries(entry.metrics).map(([key, value]) => {
        const meta = METRIC_META[key];
        if (!meta) return null;
        return (
          <div className={styles.detailField} key={key}>
            <span className={styles.detailLabel}>{meta.label}</span>
            <span className={styles.detailValue}>
              {formatMetric(value, meta.suffix)}
            </span>
          </div>
        );
      })}

      {/* Condition */}
      <div className={styles.detailField}>
        <span className={styles.detailLabel}>Condition</span>
        <span className={styles.detailValue}>{entry.condition}</span>
      </div>

      {/* Method card — author-provided method description */}
      {entry.methodCard ? (
        <div className={styles.methodCardSection}>
          <div className={styles.methodCardHeader}>
            <span className={styles.classBadge}>{entry.methodCard.class}</span>
            <span className={styles.methodCardName}>{entry.methodCard.name}</span>
          </div>
          {entry.methodCard.description && (
            <p className={styles.methodCardDesc}>{entry.methodCard.description}</p>
          )}
          {entry.methodCard.tools_used?.length > 0 && (
            <div className={styles.toolTags}>
              {entry.methodCard.tools_used.map((tool, i) => (
                <span key={i} className={styles.toolTag}>{tool}</span>
              ))}
            </div>
          )}
          <div className={styles.methodCardMeta}>
            {entry.methodCard.author && (
              <span>By {entry.methodCard.author}</span>
            )}
            {entry.methodCard.open_source != null && (
              <span className={styles.ossBadge}>
                {entry.methodCard.open_source ? "Open Source" : "Closed Source"}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.detailField}>
          <span className={styles.detailLabel}>Method</span>
          <span className={styles.detailValue}>Harness-native configuration</span>
        </div>
      )}

      {/* Cost — only shown when the entry includes cost data */}
      {entry.cost_usd != null && (
        <div className={styles.detailField}>
          <span className={styles.detailLabel}>Cost</span>
          <span className={styles.detailValue}>
            {formatCost(entry.cost_usd)}
          </span>
        </div>
      )}

      {/* Duration — only shown when elapsed_seconds is available */}
      {entry.elapsed_seconds != null && (
        <div className={styles.detailField}>
          <span className={styles.detailLabel}>Duration</span>
          <span className={styles.detailValue}>
            {formatDuration(entry.elapsed_seconds)}
          </span>
        </div>
      )}

      {/* Dataset info */}
      {dataset && (
        <>
          <div className={styles.detailField}>
            <span className={styles.detailLabel}>Dataset</span>
            <span className={styles.detailValue}>{dataset.name}</span>
          </div>
          <div className={styles.detailField}>
            <span className={styles.detailLabel}>Domain</span>
            <span className={styles.detailValue}>{dataset.domain}</span>
          </div>
          <div className={styles.detailField}>
            <span className={styles.detailLabel}>Corpus Size</span>
            <span className={styles.detailValue}>{entry.corpusSize} pairs</span>
          </div>
        </>
      )}

      {/* Fingerprint — includes hash for pipeline traceability */}
      <div className={styles.detailField}>
        <span className={styles.detailLabel}>Fingerprint Type</span>
        <span className={`${styles.detailValue} ${styles.mono}`}>
          {entry.fingerprint.type}
        </span>
      </div>
      <div className={styles.detailField}>
        <span className={styles.detailLabel}>Repo</span>
        <span className={`${styles.detailValue} ${styles.mono}`}>
          {entry.fingerprint.repo}
        </span>
      </div>
      <div className={styles.detailField}>
        <span className={styles.detailLabel}>Commit</span>
        <span className={`${styles.detailValue} ${styles.mono}`}>
          {entry.fingerprint.commit}
        </span>
      </div>
      {entry.fingerprint.hash && (
        <div className={styles.detailField}>
          <span className={styles.detailLabel}>Hash</span>
          <span className={`${styles.detailValue} ${styles.mono}`}>
            {entry.fingerprint.hash}
          </span>
        </div>
      )}

      {/* Harness version */}
      <div className={styles.detailField}>
        <span className={styles.detailLabel}>Harness Version</span>
        <span className={`${styles.detailValue} ${styles.mono}`}>
          {entry.harnessVersion}
        </span>
      </div>

      {/* Full date */}
      <div className={styles.detailField}>
        <span className={styles.detailLabel}>Submission Date</span>
        <span className={styles.detailValue}>{entry.date}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function LeaderboardPage() {
  // ---- State ----
  const [activePair, setActivePair] = useState("all");
  const [activeCondition, setActiveCondition] = useState("all");
  const [activeMetric, setActiveMetric] = useState("chrF");
  const [sortKey, setSortKey] = useState("chrF");
  const [sortDir, setSortDir] = useState("desc");
  const [expandedIndex, setExpandedIndex] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  // Fetch leaderboard data from Supabase on mount
  useEffect(() => {
    async function fetchLeaderboard() {
      try {
        const resp = await fetch(
          `${SUPABASE_URL}/rest/v1/run_cards?select=*&order=chrf_plus_plus.desc.nullslast`,
          {
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            },
          }
        );
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        // Map Supabase rows to leaderboard entry shape
        const mapped = data.map((row) => ({
          method: row.condition?.includes("+") ? `fst-gate-${row.condition}` : `prompt-${row.condition}`,
          model: row.model_slug,
          condition: row.condition,
          pair: row.language_pair?.replace(">", " → ") || "?",
          dataset: row.dataset_id,
          metrics: {
            chrF: row.chrf_plus_plus,
            exactMatch: row.exact_match_rate,
            fstAcceptance: row.fst_acceptance_rate,
          },
          author: row.submitter,
          trust: row.trust,
          fingerprint: row.run_card?.fingerprint || {},
          harnessVersion: row.harness_version,
          runCardHash: row.id,
          corpusSize: row.corpus_size,
          date: row.run_timestamp?.split("T")[0] || row.submitted_at?.split("T")[0],
          cost_usd: row.total_cost_usd,
          elapsed_seconds: row.elapsed_seconds,
          // Full run card for the detail panel
          _runCard: row.run_card,
          // Method card — author-provided method description (embedded in run card)
          methodCard: row.run_card?.method_card || null,
        }));
        setEntries(mapped);
      } catch (err) {
        setFetchError(err.message);
        // Fall back to empty
        setEntries([]);
      } finally {
        setLoading(false);
      }
    }
    fetchLeaderboard();
  }, []);

  // ---- Derived data ----

  // Unique language pairs across all entries
  const pairs = useMemo(() => {
    const set = new Set(entries.map((e) => e.pair));
    return Array.from(set);
  }, [entries]);

  // Unique conditions across all entries, used to show only
  // condition pills that actually appear in the data
  const conditions = useMemo(() => {
    const set = new Set(entries.map((e) => e.condition));
    return Array.from(set);
  }, [entries]);

  // Which condition groups have at least one entry in the data?
  const availableConditionGroups = useMemo(() => {
    return CONDITION_GROUPS.filter((group) => {
      if (group.isPrefix) {
        // "fst" group matches any condition starting with "fst"
        return conditions.some((c) => c.startsWith(group.key));
      }
      return conditions.includes(group.key);
    });
  }, [conditions]);

  // Filter entries by selected pair
  const pairFilteredEntries = useMemo(() => {
    if (activePair === "all") return entries;
    return entries.filter((e) => e.pair === activePair);
  }, [activePair, entries]);

  // Filter entries by condition (applied after pair filter)
  const filteredEntries = useMemo(() => {
    // "all" and "best" show all entries (best is handled later)
    if (activeCondition === "all" || activeCondition === "best") {
      return pairFilteredEntries;
    }

    // Find the matching condition group
    const group = CONDITION_GROUPS.find((g) => g.key === activeCondition);
    if (group && group.isPrefix) {
      // Prefix match: "fst" matches "fst-v1", "fst-v2", etc.
      return pairFilteredEntries.filter((e) =>
        e.condition.startsWith(activeCondition),
      );
    }

    // Exact match for specific conditions like "naive", "v5", etc.
    return pairFilteredEntries.filter((e) => e.condition === activeCondition);
  }, [pairFilteredEntries, activeCondition]);

  // "Best Per Model" view: collapse to only the highest-scoring
  // entry per model, ranked by the active metric. This is the
  // most useful comparison view for the leaderboard.
  const bestPerModelEntries = useMemo(() => {
    if (activeCondition !== "best") return filteredEntries;

    const bestByModel = new Map();
    filteredEntries.forEach((entry) => {
      const metricValue = entry.metrics[activeMetric] ?? -Infinity;
      const existing = bestByModel.get(entry.model);
      if (!existing || (existing.metrics[activeMetric] ?? -Infinity) < metricValue) {
        bestByModel.set(entry.model, entry);
      }
    });
    return Array.from(bestByModel.values());
  }, [filteredEntries, activeCondition, activeMetric]);

  // Determine which metrics exist in the filtered set
  const availableMetrics = useMemo(() => {
    const metricKeys = new Set();
    bestPerModelEntries.forEach((entry) => {
      Object.keys(entry.metrics).forEach((k) => metricKeys.add(k));
    });
    // Preserve a stable display order
    return ["chrF", "exactMatch", "fstAcceptance"].filter((k) =>
      metricKeys.has(k),
    );
  }, [bestPerModelEntries]);

  // Sort entries
  const sortedEntries = useMemo(() => {
    const col = SORT_COLUMNS[sortKey];
    if (!col) return bestPerModelEntries;

    return [...bestPerModelEntries].sort((a, b) => {
      const aVal = col.accessor(a);
      const bVal = col.accessor(b);

      // Numeric vs string comparison
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      if (aStr < bStr) return sortDir === "asc" ? -1 : 1;
      if (aStr > bStr) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [bestPerModelEntries, sortKey, sortDir]);

  // Rank is always based on the active metric on the primary dataset,
  // computed as a dense rank (no gaps) in descending order.
  const rankMap = useMemo(() => {
    const primaryDataset = DATASETS.find((d) => d.primary);
    const primaryId = primaryDataset ? primaryDataset.id : null;

    // Only rank entries from the primary dataset within the current display set
    const rankableEntries = bestPerModelEntries.filter(
      (e) => e.dataset === primaryId,
    );

    // Sort by active metric descending to assign rank.
    // Null metrics sort to the bottom via nullish coalescing.
    const sorted = [...rankableEntries].sort(
      (a, b) => (b.metrics[activeMetric] ?? -Infinity) - (a.metrics[activeMetric] ?? -Infinity),
    );

    const map = new Map();
    sorted.forEach((entry, i) => {
      // Use reference equality since we filtered from the same source array
      map.set(entry, i + 1);
    });
    return map;
  }, [bestPerModelEntries, activeMetric]);

  // ---- Handlers ----

  function handleSort(key) {
    if (sortKey === key) {
      // Toggle direction
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Default to descending for metrics, ascending for text
      const isMetric = ["chrF", "exactMatch", "fstAcceptance"].includes(key);
      setSortDir(isMetric ? "desc" : "asc");
    }
    // Collapse any open detail row when re-sorting
    setExpandedIndex(null);
  }

  function handleRowClick(index) {
    setExpandedIndex((prev) => (prev === index ? null : index));
  }

  function handlePairChange(pair) {
    setActivePair(pair);
    setExpandedIndex(null);
  }

  function handleConditionChange(condition) {
    setActiveCondition(condition);
    setExpandedIndex(null);
  }

  function handleMetricChange(metric) {
    setActiveMetric(metric);
    // Sync sort key with the newly selected metric
    setSortKey(metric);
    setSortDir("desc");
    setExpandedIndex(null);
  }

  // Column header sort class helper
  function sortClass(key) {
    if (sortKey !== key) return styles.sortable;
    return `${styles.sortable} ${sortDir === "asc" ? styles.sortAsc : styles.sortDesc}`;
  }

  // ---- Render ----

  return (
    <Layout
      title="Method Leaderboard"
      description="Benchmarking translation methods for Indigenous and low-resource languages with reproducible evaluation."
    >
      {/* Page Header */}
      <header className={styles.pageHeader}>
        <div className="container">
          <Heading as="h1" className={styles.pageTitle}>
            Method Leaderboard
          </Heading>
          <p className={styles.pageSubtitle}>
            Benchmarking translation methods for Indigenous and low&#8209;resource
            languages with reproducible, fingerprinted evaluation.
          </p>
          <p className={styles.pageNote}>
            Have a method to submit?{" "}
            <Link to="/docs/tutorials/build-a-plugin">
              Build a plugin and submit your scores →
            </Link>
          </p>
        </div>
      </header>

      {/* Main Content */}
      <main className={styles.contentWrapper}>
        {/* Controls: pair filter + metric toggle */}
        <div className={styles.controlsBar} id="leaderboard-controls">
          {/* Pair Filter Pills */}
          <div className={styles.pairFilter} id="pair-filter">
            <button
              type="button"
              id="pair-filter-all"
              className={`${styles.pairPill} ${activePair === "all" ? styles.pairPillActive : ""}`}
              onClick={() => handlePairChange("all")}
            >
              All
            </button>
            {pairs.map((pair) => (
              <button
                type="button"
                key={pair}
                id={`pair-filter-${pair.replace(">", "-")}`}
                className={`${styles.pairPill} ${activePair === pair ? styles.pairPillActive : ""}`}
                onClick={() => handlePairChange(pair)}
              >
                {formatPair(pair)}
              </button>
            ))}
          </div>

          {/* Metric Toggle */}
          <div className={styles.metricToggle} id="metric-toggle">
            {availableMetrics.map((metricKey) => (
              <button
                type="button"
                key={metricKey}
                id={`metric-toggle-${metricKey}`}
                className={`${styles.metricBtn} ${activeMetric === metricKey ? styles.metricBtnActive : ""}`}
                onClick={() => handleMetricChange(metricKey)}
              >
                {METRIC_META[metricKey].label}
              </button>
            ))}
          </div>

          {/* Condition Filter — groups conditions into manageable
              categories so 18 conditions don't overwhelm the UI */}
          <div className={styles.conditionFilter} id="condition-filter">
            <span className={styles.conditionFilterLabel}>Condition:</span>
            <div className={styles.conditionPills}>
              <button
                type="button"
                id="condition-filter-all"
                className={`${styles.conditionPill} ${activeCondition === "all" ? styles.conditionPillActive : ""}`}
                onClick={() => handleConditionChange("all")}
              >
                All
              </button>
              <button
                type="button"
                id="condition-filter-best"
                className={`${styles.conditionPill} ${styles.conditionPillBest} ${activeCondition === "best" ? styles.conditionPillActive : ""}`}
                onClick={() => handleConditionChange("best")}
              >
                ★ Best Only
              </button>
              {availableConditionGroups.map((group) => (
                <button
                  type="button"
                  key={group.key}
                  id={`condition-filter-${group.key}`}
                  className={`${styles.conditionPill} ${activeCondition === group.key ? styles.conditionPillActive : ""}`}
                  onClick={() => handleConditionChange(group.key)}
                >
                  {group.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Loading / Error States */}
        {loading && (
          <div className={styles.loadingState}>
            <p>Loading leaderboard data...</p>
          </div>
        )}
        {fetchError && (
          <div className={styles.errorState}>
            <p>⚠️ Could not load leaderboard: {fetchError}</p>
          </div>
        )}

        {/* Results Table (or Empty State) — only after loading completes */}
        {!loading && (
          <>
            {sortedEntries.length === 0 ? (
              <div className={styles.emptyState} id="leaderboard-empty">
                <div className={styles.emptyIcon}>📭</div>
                <p>
                  No submissions yet for{" "}
                  {activePair === "all" ? "any pair" : formatPair(activePair)}.
                </p>
                <p>Be the first to submit a benchmark result!</p>
              </div>
            ) : (
              <div className={styles.tableContainer}>
                <table className={styles.table} id="leaderboard-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th
                        className={sortClass("method")}
                        onClick={() => handleSort("method")}
                        id="col-method"
                      >
                        Method
                      </th>
                      <th
                        className={sortClass("model")}
                        onClick={() => handleSort("model")}
                        id="col-model"
                      >
                        Model
                      </th>
                      <th
                        className={sortClass("chrF")}
                        onClick={() => handleSort("chrF")}
                        id="col-chrf"
                      >
                        chrF++
                      </th>
                      <th
                        className={sortClass("exactMatch")}
                        onClick={() => handleSort("exactMatch")}
                        id="col-em"
                      >
                        EM%
                      </th>
                      <th
                        className={sortClass("fstAcceptance")}
                        onClick={() => handleSort("fstAcceptance")}
                        id="col-fst"
                      >
                        FST%
                      </th>
                      <th>Trust</th>
                      <th
                        className={sortClass("author")}
                        onClick={() => handleSort("author")}
                        id="col-author"
                      >
                        Author
                      </th>
                      <th
                        className={sortClass("date")}
                        onClick={() => handleSort("date")}
                        id="col-date"
                      >
                        Date
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEntries.map((entry, index) => {
                      const isExpanded = expandedIndex === index;
                      const rank = rankMap.get(entry);

                      return (
                        <React.Fragment key={`${entry.method}-${entry.model}-${index}`}>
                          {/* Data row */}
                          <tr
                            className={styles.tableRow}
                            onClick={() => handleRowClick(index)}
                            id={`row-${index}`}
                            aria-expanded={isExpanded}
                          >
                            <td className={styles.rankCell}>
                              {rank != null ? rank : "–"}
                            </td>
                            <td>{entry.method}</td>
                            <td>{entry.model}</td>
                            <td
                              className={`${styles.metricCell} ${activeMetric === "chrF" ? styles.metricHighlight : ""}`}
                            >
                              {formatMetric(entry.metrics.chrF, "")}
                            </td>
                            <td
                              className={`${styles.metricCell} ${activeMetric === "exactMatch" ? styles.metricHighlight : ""}`}
                            >
                              {formatMetric(entry.metrics.exactMatch, "%")}
                            </td>
                            <td
                              className={`${styles.metricCell} ${activeMetric === "fstAcceptance" ? styles.metricHighlight : ""}`}
                            >
                              {formatMetric(entry.metrics.fstAcceptance, "%")}
                            </td>
                            <td>
                              <TrustBadge trust={entry.trust} />
                            </td>
                            <td>{entry.author}</td>
                            <td>{formatDate(entry.date)}</td>
                          </tr>

                          {/* Expanded detail row */}
                          <tr className={styles.expandedRow}>
                            <td colSpan={9}>
                              <div
                                className={`${styles.expandedContent} ${isExpanded ? styles.expandedContentOpen : ""}`}
                              >
                                {isExpanded && <RowDetail entry={entry} />}
                              </div>
                            </td>
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Trust Legend */}
        <div className={styles.trustLegend} id="trust-legend">
          <span className={styles.legendTitle}>Trust Levels</span>
          <div className={styles.legendItem}>
            <TrustBadge trust="self" />
            <span className={styles.legendStatus}>Active</span>
          </div>
          <div className={styles.legendItem}>
            <TrustBadge trust="verified" />
            <span className={styles.legendStatus}>Coming soon</span>
          </div>
          <div className={styles.legendItem}>
            <TrustBadge trust="community" />
            <span className={styles.legendStatus}>Coming soon</span>
          </div>
        </div>

        {/* LLM Non-Determinism Disclaimer */}
        <p className={styles.disclaimer} id="llm-disclaimer">
          ⚠️ LLM outputs are non-deterministic. Scores represent point-in-time
          measurements under specific model versions and API configurations.
          Model providers may update weights, decoding strategies, or safety
          filters at any time, which can cause score drift between runs.
        </p>

        {/* How It Works */}
        <section className={styles.howItWorks} id="how-it-works">
          <Heading as="h2" className={styles.howItWorksTitle}>
            How It Works
          </Heading>
          <ol className={styles.howItWorksList}>
            <li className={styles.howItWorksItem}>
              <span className={styles.howItWorksIcon}>1</span>
              <span className={styles.howItWorksText}>
                <strong>Fingerprinted Pipelines</strong> — Each submission is
                tied to a specific Git commit and pipeline configuration,
                ensuring results can be traced back to the exact code that
                produced them.
              </span>
            </li>
            <li className={styles.howItWorksItem}>
              <span className={styles.howItWorksIcon}>2</span>
              <span className={styles.howItWorksText}>
                <strong>Versioned Datasets</strong> — Evaluation datasets are
                content-hashed and versioned. Scores are only comparable within
                the same dataset version, preventing silent data contamination.
              </span>
            </li>
            <li className={styles.howItWorksItem}>
              <span className={styles.howItWorksIcon}>3</span>
              <span className={styles.howItWorksText}>
                <strong>Standardised Harness</strong> — All metrics are computed
                by the shared i18n-rosetta evaluation harness, eliminating
                implementation differences between submissions.
              </span>
            </li>
            <li className={styles.howItWorksItem}>
              <span className={styles.howItWorksIcon}>4</span>
              <span className={styles.howItWorksText}>
                <strong>Open Submission</strong> — Anyone can submit results by
                opening a pull request with their method's JSON entry and
                pipeline fingerprint. Verified and Community trust tiers will be
                available soon.
              </span>
            </li>
          </ol>
        </section>
      </main>
    </Layout>
  );
}
