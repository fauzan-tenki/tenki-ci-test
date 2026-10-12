#!/usr/bin/env node
// Compares Tenki CI and GitHub Actions on one commit, using the check runs both publish to GitHub.
//
//   node scripts/measure.mjs [sha] [--since <iso>] [--wait] [--timeout <min>]
//   node scripts/measure.mjs --push [--runs N] [--timeout <min>]   # empty commit(s) + push + measure
//
// Results are appended to results/runs.jsonl; print a summary with `node scripts/report.mjs`.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const valueOpts = new Set(["--since", "--timeout", "--runs", "--repo"]);
const positional = args.filter((a, i) => !a.startsWith("--") && !valueOpts.has(args[i - 1]));

const sh = (cmd, cmdArgs) => execFileSync(cmd, cmdArgs, { encoding: "utf8" }).trim();
const repo = opt("repo", sh("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]));
const gh = (path) => JSON.parse(sh("gh", ["api", "-H", "Accept: application/vnd.github+json", path]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = (a, b) => (a && b ? (Date.parse(b) - Date.parse(a)) / 1000 : null);

// Job names end in "· <system>" (tenki-ci, github-hosted, tenki-runner); the Tenki CI run check is "Tenki CI".
function systemOf(check) {
  if (check.name === "Tenki CI") return "tenki-ci";
  const m = check.name.match(/·\s*([\w-]+)\s*$/);
  if (m) return m[1];
  return check.app?.slug === "github-actions" ? "github-actions" : check.app?.slug ?? "unknown";
}

function checkRuns(sha) {
  const out = [];
  for (let page = 1; page < 10; page++) {
    const res = gh(`repos/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}`);
    out.push(...res.check_runs);
    if (res.check_runs.length < 100) break;
  }
  return out;
}

// GitHub Actions exposes queue time (created_at) on the jobs API; check runs only carry started_at.
function actionsJobs(sha) {
  const runs = gh(`repos/${repo}/actions/runs?head_sha=${sha}&per_page=50`).workflow_runs;
  return runs.flatMap((run) =>
    gh(`repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`).jobs.map((j) => ({ ...j, workflow: run.name, run_created_at: run.created_at })),
  );
}

async function measure(sha, since, { wait, timeoutMin }) {
  const deadline = Date.now() + timeoutMin * 60_000;
  let checks;
  for (;;) {
    checks = checkRuns(sha);
    const pending = checks.filter((c) => c.status !== "completed");
    const hasTenki = checks.some((c) => c.name === "Tenki CI");
    const hasActions = checks.some((c) => c.app?.slug === "github-actions");
    const done = checks.length > 0 && pending.length === 0 && hasTenki && hasActions;
    if (!wait || done) break;
    if (Date.now() > deadline) {
      console.error(`timed out after ${timeoutMin} min; pending: ${pending.map((c) => c.name).join(", ") || "(no Tenki CI or Actions checks yet)"}`);
      break;
    }
    process.stderr.write(`\r${new Date().toISOString().slice(11, 19)} checks=${checks.length} pending=${pending.length} tenki=${hasTenki} actions=${hasActions}   `);
    await sleep(5000);
  }
  process.stderr.write("\n");

  const jobs = actionsJobs(sha);
  const rows = checks.map((c) => {
    const job = jobs.find((j) => j.id === c.id);
    return {
      system: systemOf(c),
      name: c.name,
      app: c.app?.slug,
      conclusion: c.conclusion ?? c.status,
      queued_at: job?.created_at ?? null,
      started_at: c.started_at,
      completed_at: c.completed_at,
      queue_s: job ? secs(job.created_at, c.started_at) : null,
      run_s: secs(c.started_at, c.completed_at),
      push_to_start_s: secs(since, c.started_at),
      push_to_done_s: secs(since, c.completed_at),
      runner: job?.runner_name ?? null,
      labels: job?.labels ?? null,
    };
  });

  const bySystem = {};
  for (const r of rows) (bySystem[r.system] ??= []).push(r);
  const systems = Object.fromEntries(
    Object.entries(bySystem).map(([system, rs]) => {
      const starts = rs.map((r) => r.started_at).filter(Boolean).sort();
      const ends = rs.map((r) => r.completed_at).filter(Boolean).sort();
      return [system, {
        jobs: rs.length,
        conclusion: rs.every((r) => r.conclusion === "success" || r.conclusion === "skipped") ? "success" : rs.map((r) => r.conclusion).join(","),
        first_start: starts[0] ?? null,
        last_done: ends.at(-1) ?? null,
        push_to_first_start_s: secs(since, starts[0]),
        push_to_all_done_s: secs(since, ends.at(-1)),
      }];
    }),
  );

  const record = { repo, sha, since, measured_at: new Date().toISOString(), systems, rows };
  mkdirSync("results", { recursive: true });
  appendFileSync("results/runs.jsonl", JSON.stringify(record) + "\n");

  console.log(`\n${repo}@${sha.slice(0, 7)}  push at ${since ?? "unknown"}`);
  console.table(rows.map((r) => ({
    system: r.system, job: r.name, result: r.conclusion,
    "queue s": r.queue_s, "run s": r.run_s, "push→start s": r.push_to_start_s, "push→done s": r.push_to_done_s,
  })));
  console.table(Object.fromEntries(Object.entries(systems).map(([k, v]) => [k, {
    jobs: v.jobs, result: v.conclusion, "push→first start s": v.push_to_first_start_s, "push→all done s": v.push_to_all_done_s,
  }])));
  return record;
}

const timeoutMin = Number(opt("timeout", 20));
if (flag("push")) {
  const n = Number(opt("runs", 1));
  for (let i = 1; i <= n; i++) {
    sh("git", ["commit", "--allow-empty", "-m", `bench: measurement run ${i}/${n} (${new Date().toISOString()})`]);
    const since = new Date().toISOString();
    sh("git", ["push", "origin", "HEAD"]);
    const sha = sh("git", ["rev-parse", "HEAD"]);
    console.error(`pushed ${sha.slice(0, 7)} at ${since}`);
    await measure(sha, since, { wait: true, timeoutMin });
  }
} else {
  const sha = sh("git", ["rev-parse", positional[0] ?? "HEAD"]);
  const since = opt("since", sh("git", ["show", "-s", "--format=%cI", sha]));
  await measure(sha, since, { wait: flag("wait"), timeoutMin });
}
