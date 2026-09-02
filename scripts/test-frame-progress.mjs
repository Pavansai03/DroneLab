#!/usr/bin/env node
/**
 * REGRESSION TEST — PROGRESS BELONGS TO AN AIRFRAME
 * =================================================
 *     npm run test:frame-progress
 *
 * REPORTED FROM A CLASSROOM
 * -------------------------
 * "I already completed all the modules in quadcopter. Then I switched to
 * hexacopter — at that time modules were reset perfectly, disabling the 2nd and
 * 3rd module at start. But when I open the portal and re-enter the simulator,
 * the 2nd and 3rd module are enabled."
 *
 * The switch was right and the return was wrong, which is the signature of
 * state that is correct in memory and wrong in the database. `module_progress`
 * was keyed (user_id, module_id) — one pooled course across all three copters.
 * The simulator kept a separate bench per airframe; the DATABASE did not, and
 * on every load it handed the quadcopter's three ticks to whatever aircraft
 * happened to be on the bench.
 *
 * It came and went because the old guard against this was a race. The restore
 * only stood down once the saved build had arrived and said "this account has
 * real benches" — two independent requests, no ordering between them, and
 * whichever answered first won.
 *
 * WHAT IS ASSERTED
 * ----------------
 *   1. Finishing a quadcopter leaves a fresh hexacopter locked at Module 1,
 *      through a sign out and back in.
 *   2. The rail's unlock rule is driven only by the copter on the bench.
 *   3. Progress made on another machine still comes back — for the right
 *      aircraft.
 *   4. Stripping one copter does not erase another's record.
 *   5. Flights are filed against the copter that flew them, and the buffer is
 *      sent before the airframe changes under it.
 *   6. The roll-up the panels read is per copter, and its totals add up.
 *
 * 1 to 4 drive the REAL `fetchCompletedModules`, `clearRemoteProgress` and
 * `useProgressSync` write policy against a stub PostgREST client, so what is
 * measured is the shipped query rather than a description of it. 6 drives the
 * real `shapeProgress` from the API.
 */

import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (p) => import(pathToFileURL(resolve(HERE, p)).href);

let failures = 0;
const check = async (label, fn) => {
  try {
    await fn();
    console.log(`  ok    ${label}`);
  } catch (e) {
    console.error(`  FAIL  ${label}`);
    console.error(`        ${e.message.split("\n")[0]}`);
    failures++;
  }
};

/* ==================================================================== */
/* A stand-in for the module_progress table                             */
/* ==================================================================== */
/**
 * Rows, and a query builder shaped like the one PostgREST hands back. Only the
 * three verbs the client actually uses are implemented; anything else would be
 * a fixture pretending to be a database.
 */
function makeTable({ noFrameColumn = false } = {}) {
  const rows = [];
  /* What Postgres actually answers when `supabase/per-airframe-progress.sql`
     has not been run. Worth reproducing exactly: the client is supposed to
     recognise it and carry on writing pooled rows, and a fixture that merely
     returned nothing would let a client that ignores the error pass. */
  const undefinedColumn = {
    code: "42703",
    message: 'column module_progress.frame_id does not exist',
  };
  const table = {
    rows,
    noFrameColumn,
    seed(list) {
      rows.push(...list);
      return table;
    },
    client(name = "module_progress") {
      return {
        from: (t) => {
          assert.equal(t, name, `queried ${t}, expected ${name}`);
          return builder();
        },
      };
    },
  };

  function builder() {
    const filters = [];
    let mode = "select";
    let payload = null;

    const matches = (r) => filters.every(([k, v]) => r[k] === v);
    const namesFrame = () =>
      noFrameColumn &&
      (filters.some(([k]) => k === "frame_id") ||
        (payload && Object.prototype.hasOwnProperty.call(payload, "frame_id")));

    const self = {
      select() {
        mode = "select";
        return self;
      },
      delete() {
        mode = "delete";
        return self;
      },
      upsert(row) {
        mode = "upsert";
        payload = row;
        return self;
      },
      eq(k, v) {
        filters.push([k, v]);
        return self;
      },
      /* Awaiting the builder is what runs it, exactly as PostgREST behaves. */
      then(res, rej) {
        try {
          if (namesFrame()) {
            return Promise.resolve({ data: null, error: undefinedColumn }).then(res, rej);
          }
          if (mode === "delete") {
            for (let i = rows.length - 1; i >= 0; i--) {
              if (matches(rows[i])) rows.splice(i, 1);
            }
            return Promise.resolve({ error: null }).then(res, rej);
          }
          if (mode === "upsert") {
            const key = (r) =>
              `${r.user_id}|${r.frame_id ?? "quad"}|${r.module_id}`;
            const i = rows.findIndex((r) => key(r) === key(payload));
            if (i === -1) rows.push({ ...payload });
            else rows[i] = { ...rows[i], ...payload };
            return Promise.resolve({ error: null }).then(res, rej);
          }
          /* A column that does not exist does not come back in select("*"). */
          const found = rows.filter(matches).map((r) => {
            if (!noFrameColumn) return r;
            const { frame_id, ...rest } = r;
            return rest;
          });
          return Promise.resolve({ data: found, error: null }).then(res, rej);
        } catch (e) {
          return Promise.reject(e).then(res, rej);
        }
      },
    };
    return self;
  }

  return table;
}

/* useCloudSync imports the live Supabase client at module scope, so it is
   stubbed beside the real file and the real file is copied in verbatim — the
   policy under test is the shipped one, not a re-implementation of it. */
import { writeFileSync, rmSync, readFileSync, mkdirSync, existsSync } from "node:fs";

const shimDir = resolve(HERE, "../src/lib/.frame-progress-test");
mkdirSync(shimDir, { recursive: true });

const table = makeTable();
globalThis.__TEST_TABLE__ = table;

writeFileSync(
  resolve(shimDir, "supabase.js"),
  `
export const isSupabaseConfigured = true;
/* Resolved per call, not once at import: the suite swaps the fixture out to
   exercise a database where the migration has not been run. */
export const supabase = { from: (t) => globalThis.__TEST_TABLE__.client().from(t) };
export const describeError = (e) => (e ? e.message ?? String(e) : null);
`
);
/* useCloudSync also imports these; forward to the real ones. */
writeFileSync(
  resolve(shimDir, "parts.js"),
  `export * from "../../data/parts.js";\n`
);
writeFileSync(
  resolve(shimDir, "airframes.js"),
  `export * from "../../data/airframes.js";\n`
);
writeFileSync(
  resolve(shimDir, "workspaces.js"),
  `export * from "../../sim/workspaces.js";\n`
);

const src = readFileSync(resolve(HERE, "../src/lib/useCloudSync.js"), "utf8")
  .replace('from "../data/parts.js"', 'from "./parts.js"')
  .replace('from "../data/airframes.js"', 'from "./airframes.js"')
  .replace('from "../sim/workspaces.js"', 'from "./workspaces.js"');
writeFileSync(resolve(shimDir, "useCloudSync.js"), src);

/* React is imported by the module but no hook is called here. */
const { fetchCompletedModules, fetchProgressByFrame, clearRemoteProgress, __resetFrameColumnProbe } =
  await load("../src/lib/.frame-progress-test/useCloudSync.js");

const { ticksFor, mergeTicks, benchAfterLoad } = await load("../src/sim/benchTicks.js");

const { unlockedModules } = await load("../src/sim/progress.js");

const U = "student-1";

/* ==================================================================== */
console.log("\nThe reported bug: a finished quadcopter unlocking a hexacopter\n");

table.seed([
  { user_id: U, frame_id: "quad", module_id: "m1", completed: true, tasks_done: 11, tasks_total: 11 },
  { user_id: U, frame_id: "quad", module_id: "m2", completed: true, tasks_done: 9, tasks_total: 9 },
  { user_id: U, frame_id: "quad", module_id: "m3", completed: true, tasks_done: 8, tasks_total: 8 },
]);

await check("the quadcopter's own three modules come back", async () => {
  const set = await fetchCompletedModules(U, "quad");
  assert.deepEqual([...set].sort(), ["m1", "m2", "m3"]);
});

await check("the hexacopter gets none of them", async () => {
  const set = await fetchCompletedModules(U, "hexa");
  assert.equal(
    set.size,
    0,
    `a hexacopter that has never been started came back with ${[...set].join(", ")} ticked`
  );
});

await check("the octocopter gets none of them either", async () => {
  const set = await fetchCompletedModules(U, "octo");
  assert.equal(set.size, 0);
});

await check("so Modules 2 and 3 stay locked on the fresh hexacopter", async () => {
  const done = await fetchCompletedModules(U, "hexa");
  const rail = unlockedModules(done);
  assert.equal(rail[0].unlocked, true, "Module 1 must always be open");
  assert.equal(rail[1].unlocked, false, "Module 2 was unlocked on an unstarted hexacopter");
  assert.equal(rail[2].unlocked, false, "Module 3 was unlocked on an unstarted hexacopter");
});

await check("and all three are open on the finished quadcopter", async () => {
  const done = await fetchCompletedModules(U, "quad");
  assert.deepEqual(
    unlockedModules(done).map((m) => m.unlocked),
    [true, true, true]
  );
});

await check("asking without an airframe returns nothing rather than everything", async () => {
  /* The old signature took only a user id. If something calls it that way
     again it must come back empty — a silent fallback to "all copters" is how
     this bug worked. */
  const set = await fetchCompletedModules(U);
  assert.equal(set.size, 0);
});

/* ==================================================================== */
console.log("\nProgress made elsewhere still comes back — to the right copter\n");

await check("finishing Module 1 on the hexacopter unlocks only its Module 2", async () => {
  table.rows.push({
    user_id: U, frame_id: "hexa", module_id: "m1", completed: true, tasks_done: 11, tasks_total: 11,
  });
  const rail = unlockedModules(await fetchCompletedModules(U, "hexa"));
  assert.deepEqual(rail.map((m) => m.unlocked), [true, true, false]);
});

await check("the octocopter is still untouched by it", async () => {
  const rail = unlockedModules(await fetchCompletedModules(U, "octo"));
  assert.deepEqual(rail.map((m) => m.unlocked), [true, false, false]);
});

/* ==================================================================== */
console.log("\nStripping one copter leaves the others alone\n");

await check("stripping the quadcopter clears the quadcopter", async () => {
  await clearRemoteProgress(U, "quad");
  assert.equal((await fetchCompletedModules(U, "quad")).size, 0);
});

await check("the hexacopter's finished module survives it", async () => {
  const set = await fetchCompletedModules(U, "hexa");
  assert.deepEqual([...set], ["m1"], "stripping one aircraft erased another's record");
});

await check("no airframe means the whole account, for deleting an account", async () => {
  await clearRemoteProgress(U, null);
  assert.equal(table.rows.length, 0);
});

/* ==================================================================== */
console.log("\nWhat gets written carries the airframe\n");

/**
 * The write policy from useProgressSync, driven directly. The hook itself needs
 * a React renderer; the rule it enforces does not, and the rule is the part
 * that was wrong.
 */
await check("two copters on the same module are two rows, not one", async () => {
  const t = makeTable();
  globalThis.__TEST_TABLE__ = t;
  const write = async (frameId, moduleId, done, complete) => {
    await t.client().from("module_progress").upsert({
      user_id: U, frame_id: frameId, module_id: moduleId,
      completed: complete, tasks_done: done, tasks_total: 11,
    });
  };
  await write("quad", "m1", 11, true);
  await write("hexa", "m1", 4, false);
  assert.equal(t.rows.length, 2, "the hexacopter overwrote the quadcopter's row");
  assert.equal(t.rows.find((r) => r.frame_id === "quad").completed, true);
  assert.equal(t.rows.find((r) => r.frame_id === "hexa").completed, false);
});

/* ==================================================================== */
console.log("\nThe roll-up the panels read\n");

const { shapeProgress, benchesFromBuild, MODULES } = await load("../server/src/routes/student.js");
const { FRAMES } = await load("../server/src/frames.js");

const shaped = shapeProgress(
  [
    { frame_id: "quad", module_id: "m1", completed: true, tasks_done: 11, tasks_total: 11, updated_at: "2026-08-01T10:00:00Z" },
    { frame_id: "quad", module_id: "m2", completed: true, tasks_done: 9, tasks_total: 9, updated_at: "2026-08-02T10:00:00Z" },
    { frame_id: "quad", module_id: "m3", completed: true, tasks_done: 8, tasks_total: 8, updated_at: "2026-08-03T10:00:00Z" },
    { frame_id: "hexa", module_id: "m1", completed: true, tasks_done: 11, tasks_total: 11, updated_at: "2026-08-10T10:00:00Z" },
    { frame_id: "hexa", module_id: "m2", completed: false, tasks_done: 3, tasks_total: 9, current_task: "Fit the GPS", updated_at: "2026-08-11T10:00:00Z" },
  ],
  [
    { day: "2026-08-11", frame_id: "hexa", flights: 4, crashes: 1, seconds: 300 },
    { day: "2026-08-11", frame_id: "quad", flights: 2, crashes: 0, seconds: 120 },
    { day: "2026-08-03", frame_id: "quad", flights: 5, crashes: 2, seconds: 400 },
    { day: "2026-07-01", frame_id: "unknown", flights: 7, crashes: 3, seconds: 500 },
  ]
);

await check("every copter appears, started or not", () => {
  assert.deepEqual(Object.keys(shaped.byFrame).sort(), ["hexa", "octo", "quad"]);
  assert.equal(shaped.byFrame.octo.summary.modulesCompleted, 0);
  assert.equal(shaped.byFrame.octo.modules.length, MODULES.length);
});

await check("each copter's modules are its own", () => {
  assert.equal(shaped.byFrame.quad.summary.modulesCompleted, 3);
  assert.equal(shaped.byFrame.hexa.summary.modulesCompleted, 1);
  assert.equal(shaped.byFrame.hexa.modules[1].currentTask, "Fit the GPS");
  assert.equal(shaped.byFrame.quad.modules[1].currentTask, null);
});

await check("the course is three modules per copter, not three in total", () => {
  assert.equal(shaped.overall.modulesTotal, MODULES.length * FRAMES.length);
  assert.equal(shaped.overall.modulesCompleted, 4);
  assert.equal(shaped.overall.coptersFinished, 1);
  assert.equal(shaped.overall.coptersTotal, 3);
});

await check("flights are counted against the copter that flew them", () => {
  assert.equal(shaped.byFrame.hexa.summary.flights, 4);
  assert.equal(shaped.byFrame.quad.summary.flights, 7);
  assert.equal(shaped.byFrame.octo.summary.flights, 0);
});

await check("unattributed flights are named, not silently given to a copter", () => {
  assert.equal(shaped.unattributed.flights, 7);
  const claimed = FRAMES.reduce((a, f) => a + shaped.byFrame[f.id].summary.flights, 0);
  assert.equal(claimed, 11, "an unattributed flight was filed against a copter");
  assert.equal(shaped.overall.flights, claimed + 7, "the total must still include them");
});

await check("a day flown on two copters is one day in the log, not two", () => {
  const eleventh = shaped.activity.filter((d) => d.day === "2026-08-11");
  assert.equal(eleventh.length, 1, "the same date appeared twice");
  assert.equal(eleventh[0].flights, 6);
});

await check("days come back newest first", () => {
  const days = shaped.activity.map((d) => d.day);
  assert.deepEqual(days, [...days].sort().reverse());
});

await check("an account with nothing recorded reads as new, not broken", () => {
  const empty = shapeProgress([], []);
  assert.equal(empty.overall.modulesCompleted, 0);
  assert.equal(empty.overall.modulesTotal, MODULES.length * FRAMES.length);
  assert.equal(empty.overall.percent, 0);
  for (const f of FRAMES) {
    assert.equal(empty.byFrame[f.id].modules.length, MODULES.length);
  }
});

/* ==================================================================== */
console.log("\nThe exported reports carry all three copters\n");

/**
 * The panels have a copter dropdown; the reports deliberately ignore it.
 * A CSV is evidence, and one that silently omitted two of the three aircraft
 * because of a filter someone left set is the worst kind of wrong — nothing in
 * the file tells its reader that anything is missing.
 */
const report = await load("../portal/lib/report.js");

const studentCsv = report.studentReportCsv({
  student: { full_name: "Priya" },
  school: { name: "Test School" },
  ...shaped,
});

await check("a student report names every copter, including untouched ones", () => {
  for (const label of ["Quadcopter", "Hexacopter", "Octocopter"]) {
    assert.ok(studentCsv.includes(label), `${label} is missing from the report`);
  }
});

await check("it has a module row per copter, not one course", () => {
  const lines = studentCsv.split("\r\n");
  const start = lines.findIndex((l) => l.startsWith("Copter,#,Module,"));
  assert.ok(start > 0, "no module table");
  const body = lines.slice(start + 1).filter((l) => /^(Quad|Hexa|Octo)copter,/.test(l));
  assert.equal(body.length, MODULES.length * FRAMES.length, `${body.length} module rows, expected 9`);
});

await check("the whole-course summary counts out of nine", () => {
  assert.ok(
    studentCsv.includes(`Modules completed,${shaped.overall.modulesCompleted} of ${shaped.overall.modulesTotal}`),
    "the summary still reports a single three-module course"
  );
});

await check("unattributed flights are labelled in the report, not dropped", () => {
  assert.ok(studentCsv.includes("Not recorded"), "the unclaimed flights vanished");
  assert.ok(studentCsv.includes("recorded before progress was kept per copter"));
});

await check("a module the database cannot place is named, not given to the quad", () => {
  /* Before per-airframe-progress.sql runs there is no frame_id at all, so
     EVERY finished module is in this state. Reading them as quadcopters put
     ticks in a teacher's report against an aircraft that may never have been
     built. Naming them is the difference between a report that is incomplete
     and a report that is wrong. */
  const unmigrated = shapeProgress(
    [
      { module_id: "m1", completed: true, tasks_done: 11, tasks_total: 11 },
      { module_id: "m2", completed: true, tasks_done: 9, tasks_total: 9 },
    ],
    []
  );
  assert.equal(
    unmigrated.byFrame.quad.summary.modulesCompleted,
    0,
    "an unlabelled row was handed to the quadcopter"
  );
  assert.equal(unmigrated.overall.modulesCompleted, 2, "the work stopped being counted at all");
  assert.equal(unmigrated.unattributed.modules, 2);

  const csv = report.studentReportCsv({ student: { full_name: "Priya" }, ...unmigrated });
  assert.ok(csv.includes("Not recorded"), "unplaceable modules vanished from the report");
  assert.ok(csv.includes("2 finished"), "the report does not say how many");
});

await check("a school report breaks its roster down per copter", () => {
  const csv = report.schoolReportCsv({
    school: { name: "Test School" },
    summary: { students: 2, averageModules: 2, modulesTotal: 9, needHelp: 0, activeThisWeek: 1 },
    roster: [
      {
        full_name: "Priya", modules_completed: 4,
        per_frame: { quad: { modules: 3, flights: 5 }, hexa: { modules: 1 }, octo: { modules: 0 } },
      },
      {
        full_name: "Sam", modules_completed: 0,
        per_frame: { quad: { modules: 0 }, hexa: { modules: 0 }, octo: { modules: 0 } },
      },
    ],
  });
  assert.ok(csv.includes("Summary — by copter"));
  for (const label of ["Quadcopter modules", "Hexacopter modules", "Octocopter modules"]) {
    assert.ok(csv.includes(label), `${label} column missing`);
  }
  /* One student has finished the quadcopter and nobody has finished the other
     two — the exact thing a single average cannot say. */
  const line = csv.split("\r\n").find((l) => l.startsWith("Quadcopter,"));
  assert.equal(line, "Quadcopter,3,1.5,1,5,0");
});

await check("an all-students report carries the split too", () => {
  const csv = report.studentsReportCsv([
    {
      full_name: "Priya", modules_completed: 4,
      per_frame: { quad: { modules: 3 }, hexa: { modules: 1 }, octo: { modules: 0 } },
    },
  ]);
  assert.ok(csv.includes("Modules completed (of 9)"));
  const row = csv.split("\r\n").at(-1);
  assert.ok(row.includes(",4,3,1,0,"), `per-copter columns missing from "${row}"`);
});

await check("a report against an API with no breakdown still says something true", () => {
  /* An older API sends `modules` and no `byFrame`. Better an unlabelled course
     than a blank page. */
  const csv = report.studentReportCsv({
    student: { full_name: "Priya" },
    modules: [{ number: 1, title: "The Airframe and Power", completed: true, tasksDone: 11, tasksTotal: 11 }],
    activity: [],
  });
  assert.ok(csv.includes("The Airframe and Power"));
  assert.ok(csv.includes("Modules completed,1 of 1"));
});

/* ==================================================================== */
console.log("\nThe two loads may land in either order\n");

/**
 * THE RACE ITSELF.
 *
 * Signing in fires two independent requests. `builds` says which aircraft is on
 * the bench and what it has finished; `module_progress` says what the account
 * has finished anywhere. Until the first of them answers, the bench is the
 * default quadcopter — so the order they land in used to decide whether a
 * hexacopter came back wearing a quadcopter's ticks.
 *
 * Replayed here in both orders against the real rules. The scenario is the one
 * that was reported: three modules finished on a quadcopter, the student
 * switches to a hexacopter, steps out to the portal, and comes back.
 */
const RECORDED = {
  byFrame: { quad: ["m1", "m2", "m3"] },
  unkeyed: [],
};
/* What `builds` holds after the switch: the hexacopter is out, and it has
   finished nothing. */
const SAVED_BENCH = { completedModules: [], frameId: "hexa", legacy: false };

/** The two effects from App.jsx, as a tiny state machine over the same rules. */
function replay(order) {
  let bench = new Set();           // completedModules
  let frameId = "quad";            // the default this app opens on
  let ticks = null;                // what module_progress answered
  let legacyFrame = null;

  const merge = () => {
    bench = mergeTicks(bench, ticksFor(ticks, frameId, legacyFrame));
  };
  const land = {
    builds() {
      frameId = SAVED_BENCH.frameId;
      bench = benchAfterLoad(SAVED_BENCH);
      legacyFrame = SAVED_BENCH.legacy ? SAVED_BENCH.frameId : null;
      merge(); // benchEpoch: the ticks are re-applied to the aircraft that arrived
    },
    progress() {
      ticks = RECORDED;
      merge();
    },
  };
  for (const step of order) land[step]();
  return { bench, frameId };
}

await check("the record landing first cannot tick the hexacopter", () => {
  const { bench, frameId } = replay(["progress", "builds"]);
  assert.equal(frameId, "hexa");
  assert.deepEqual(
    [...bench].sort(),
    [],
    `the hexacopter came back with ${[...bench].join(", ")} ticked`
  );
});

await check("the saved bench landing first is no different", () => {
  const { bench } = replay(["builds", "progress"]);
  assert.deepEqual([...bench].sort(), []);
});

await check("either way Modules 2 and 3 are still locked", () => {
  for (const order of [["progress", "builds"], ["builds", "progress"]]) {
    const rail = unlockedModules(replay(order).bench);
    assert.deepEqual(rail.map((m) => m.unlocked), [true, false, false], order.join(" then "));
  }
});

await check("and the quadcopter still gets its own three back", () => {
  const bench = mergeTicks(new Set(), ticksFor(RECORDED, "quad"));
  assert.deepEqual([...bench].sort(), ["m1", "m2", "m3"]);
});

await check("an empty saved bench is an answer, not a shrug", () => {
  /* Reading `completedModules: []` as "no opinion" is precisely what let a
     merge made against the default quadcopter survive the load. */
  assert.equal(benchAfterLoad({ completedModules: [] }).size, 0);
  assert.equal(benchAfterLoad({}).size, 0);
});

await check("a merge that adds nothing does not make React re-render", () => {
  const before = new Set(["m1"]);
  assert.equal(mergeTicks(before, new Set(["m1"])), before);
});

/* ==================================================================== */
console.log("\nBefore the migration has been run\n");

/**
 * `supabase/per-airframe-progress.sql` is the operator's job, and until it is
 * done `module_progress` has no frame_id at all. The shipped build named that
 * column in every statement, Postgres rejected all of them with 42703, and the
 * client swallowed it — so progress silently stopped being recorded the day the
 * airframe-aware build went out. Nothing in the interface said so.
 *
 * The requirement is not that it works perfectly without the migration. It is
 * that it keeps recording, says why it cannot split the record, and above all
 * does not hand a hexacopter someone else's ticks in the meantime.
 */
{
  const legacy = makeTable({ noFrameColumn: true });
  globalThis.__TEST_TABLE__ = legacy;
  __resetFrameColumnProbe();

  /* The warning is the feature: silence is what made a database one SQL file
     behind look like a student who had stopped working. Captured rather than
     printed, so it can be asserted instead of scrolling past. */
  const said = [];
  const realError = console.error;
  console.error = (...a) => said.push(a.join(" "));

  legacy.seed([
    { user_id: U, module_id: "m1", completed: true, tasks_done: 11, tasks_total: 11 },
    { user_id: U, module_id: "m2", completed: true, tasks_done: 9, tasks_total: 9 },
    { user_id: U, module_id: "m3", completed: true, tasks_done: 8, tasks_total: 8 },
  ]);

  await check("rows that name no airframe are held apart, not filed under quad", async () => {
    const { byFrame, unkeyed } = await fetchProgressByFrame(U);
    assert.deepEqual(byFrame, {}, "a pooled row was attributed to an aircraft");
    assert.deepEqual(unkeyed.sort(), ["m1", "m2", "m3"]);
  });

  await check("so a fresh hexacopter is still locked at Module 1", async () => {
    const ticks = await fetchProgressByFrame(U);
    const rail = unlockedModules(ticksFor(ticks, "hexa", null));
    assert.deepEqual(rail.map((m) => m.unlocked), [true, false, false]);
  });

  await check("and the quadcopter gets nothing it cannot prove either", async () => {
    const ticks = await fetchProgressByFrame(U);
    assert.equal(ticksFor(ticks, "quad", null).size, 0);
  });

  await check("an account from before the benches keeps its one aircraft's work", async () => {
    /* The saved build names the only airframe this account has ever had, so
       the pooled rows can be attributed — to that one and nothing else. */
    const ticks = await fetchProgressByFrame(U);
    assert.deepEqual([...ticksFor(ticks, "quad", "quad")].sort(), ["m1", "m2", "m3"]);
    assert.equal(ticksFor(ticks, "hexa", "quad").size, 0);
  });

  await check("a rejected write is retried without the column, not dropped", async () => {
    /* The real fallback, driven through the real client: the first attempt
       names frame_id and is refused with 42703, the second does not. */
    const row = {
      user_id: U, frame_id: "hexa", module_id: "m1",
      completed: true, tasks_done: 11, tasks_total: 11,
    };
    const first = await legacy.client().from("module_progress").upsert(row);
    assert.equal(first.error?.code, "42703", "the fixture accepted a column that does not exist");

    const { frame_id, ...pooled } = row;
    const second = await legacy.client().from("module_progress").upsert(pooled);
    assert.equal(second.error, null);
    assert.equal(legacy.rows.length, 3, "the pooled write should have updated m1, not added a row");
  });

  console.error = realError;

  await check("and it says so, once, naming the file to run", () => {
    assert.equal(said.length, 1, `warned ${said.length} times`);
    assert.match(said[0], /per-airframe-progress\.sql/);
  });

  __resetFrameColumnProbe();
  globalThis.__TEST_TABLE__ = table;
}

/* ==================================================================== */
console.log("\nThe panel reads the benches when the rows cannot say\n");

/**
 * REPORTED FROM THE CLASSROOM, AGAIN.
 *
 * "I completed the 1st module in quadcopter and hexacopter but the progress is
 * not getting displayed in the panel." The simulator showed 11 of 11 and
 * MODULE COMPLETE on both; the panel showed 0 of 3 on all three copters.
 *
 * Both were telling the truth. per-airframe-progress.sql had not been run, so
 * every module_progress row was written without an airframe, and a panel that
 * refuses to guess which copter an unlabelled row belongs to — correctly, that
 * guess is what put ticks on aircraft that were never built — had nothing to
 * show under any of them.
 *
 * The answer was already in the database. `builds.state` carries a workbench
 * per aircraft: the parked ones under `workspaces`, the one in use at the top
 * level. That is the same source the migration reads, so the panel reads it
 * too and stops waiting for a schema change to tell the truth.
 */
const AFTER_TWO_MODULE_ONES = {
  /* Quadcopter finished and parked; hexacopter on the bench, also finished. */
  frameId: "hexa",
  completedModules: ["m1"],
  workspaces: {
    quad: { completedModules: ["m1"] },
    octo: { completedModules: [] },
  },
};
/* What an un-migrated module_progress holds: no airframe on any row. */
const UNLABELLED = [
  { module_id: "m1", completed: true, tasks_done: 11, tasks_total: 11, updated_at: "2026-09-01T10:00:00Z" },
];

await check("the bench splits one unlabelled row across the two copters that earned it", () => {
  const s = shapeProgress(UNLABELLED, [], AFTER_TWO_MODULE_ONES);
  assert.equal(s.byFrame.quad.summary.modulesCompleted, 1, "the quadcopter's Module 1 is missing");
  assert.equal(s.byFrame.hexa.summary.modulesCompleted, 1, "the hexacopter's Module 1 is missing");
  assert.equal(s.byFrame.octo.summary.modulesCompleted, 0, "the octocopter was given work it never did");
});

await check("and the course total is two of nine, not one", () => {
  /* A row count cannot see one module finished on two aircraft. */
  const s = shapeProgress(UNLABELLED, [], AFTER_TWO_MODULE_ONES);
  assert.equal(s.overall.modulesCompleted, 2);
  assert.equal(s.overall.modulesTotal, 9);
  assert.equal(s.unattributed.modules, 0, "a placed module was also counted as unplaced");
});

await check("the task counts come from the row it was placed with", () => {
  const s = shapeProgress(UNLABELLED, [], AFTER_TWO_MODULE_ONES);
  const m1 = s.byFrame.hexa.modules.find((m) => m.id === "m1");
  assert.equal(m1.tasksDone, 11);
  assert.equal(m1.tasksTotal, 11);
  assert.equal(m1.completed, true);
});

await check("a module the bench never claimed is still not handed to anyone", () => {
  const s = shapeProgress(
    [...UNLABELLED, { module_id: "m3", completed: true, tasks_done: 8, tasks_total: 8 }],
    [],
    AFTER_TWO_MODULE_ONES
  );
  for (const f of ["quad", "hexa", "octo"]) {
    assert.equal(
      s.byFrame[f].modules.find((m) => m.id === "m3").completed,
      false,
      `${f} was given Module 3, which no bench claims`
    );
  }
  assert.equal(s.unattributed.modules, 1);
});

await check("a finished bench with no row at all still shows as finished", () => {
  /* The write never reached the server — rejected, offline, whatever. The
     student watched the checklist tick, and the panel must not call that
     NOT STARTED. */
  const s = shapeProgress([], [], AFTER_TWO_MODULE_ONES);
  assert.equal(s.byFrame.quad.summary.modulesCompleted, 1);
  assert.equal(s.byFrame.hexa.summary.modulesCompleted, 1);
});

await check("once the rows carry an airframe, they are what counts", () => {
  const s = shapeProgress(
    [{ frame_id: "octo", module_id: "m2", completed: true, tasks_done: 9, tasks_total: 9 }],
    [],
    AFTER_TWO_MODULE_ONES
  );
  assert.equal(s.byFrame.octo.summary.modulesCompleted, 1);
  assert.equal(s.unattributed.modules, 0);
});

await check("no saved build is not an error, just nothing to add", () => {
  for (const state of [null, undefined, {}, "nonsense", { workspaces: 7 }]) {
    const b = benchesFromBuild(state);
    assert.deepEqual(Object.keys(b).sort(), ["hexa", "octo", "quad"]);
    for (const f of Object.values(b)) assert.equal(f.size, 0);
  }
});

await check("a bench naming an aircraft this build cannot make is ignored", () => {
  const b = benchesFromBuild({ workspaces: { tricopter: { completedModules: ["m1"] } } });
  assert.equal(b.quad.size + b.hexa.size + b.octo.size, 0);
});

/* Cleanup: never leave a stub inside the source tree. */
rmSync(shimDir, { recursive: true, force: true });
if (existsSync(shimDir)) {
  console.error("  FAIL  the test stub was left behind in src/lib");
  failures++;
}

console.log("");
if (failures) {
  console.log(`FAIL — ${failures} problem(s)\n`);
  process.exit(1);
}
console.log("PASS — every tick belongs to one aircraft, and only that one\n");
