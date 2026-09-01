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
function makeTable() {
  const rows = [];
  const table = {
    rows,
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
          return Promise.resolve({ data: rows.filter(matches), error: null }).then(res, rej);
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
export const supabase = globalThis.__TEST_TABLE__.client();
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
const { fetchCompletedModules, clearRemoteProgress } = await load(
  "../src/lib/.frame-progress-test/useCloudSync.js"
);

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

const { shapeProgress, MODULES } = await load("../server/src/routes/student.js");
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
  assert.ok(studentCsv.includes("logged before flights were recorded per copter"));
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
