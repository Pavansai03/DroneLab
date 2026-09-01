"use client";

import { FRAMES } from "../lib/frames.js";

/**
 * WHICH COPTER ARE WE TALKING ABOUT?
 * ==================================
 * The course is three modules on each of three aircraft. Every panel that
 * reports progress therefore has to answer "on what", and until this existed
 * they all quietly answered "on everything, added together" — which reads as a
 * student being two-thirds of the way through a course they have barely
 * started, and tells a teacher nothing about which build is going wrong.
 *
 * "All copters" stays the default. It is the honest headline: it is the whole
 * course, and it is the figure a student's ring and a school's average have
 * always been trying to show. Choosing one aircraft narrows everything below.
 *
 * One control, shared by the student panel and the teacher panel, so the two
 * cannot drift into offering different copters or different wording for them.
 */
export default function CopterSelect({ value, onChange, id = "copter", label = "Copter" }) {
  return (
    <label className="copter-select">
      <span>{label}</span>
      <select id={id} value={value ?? "all"} onChange={(e) => onChange(e.target.value)}>
        <option value="all">All copters</option>
        {FRAMES.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label} — {f.motors} motors
          </option>
        ))}
      </select>
    </label>
  );
}
