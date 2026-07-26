import React, { useMemo, useState } from "react";
import { LOGIC_TREES, evaluateTree } from "../data/logicTrees.js";

/**
 * Renders a component's decision tree and lights up the branch the aircraft is
 * ACTUALLY taking right now. This is the heart of the teaching: a student who
 * cannot arm can look here and see the exact question that answered "no".
 */
export default function LogicTreeViewer({ treeId, diagnostics, frame }) {
  const [motorIdx, setMotorIdx] = useState(0);
  const tree = LOGIC_TREES[treeId];

  const perMotor = ["esc", "motor", "propeller"].includes(treeId);

  const result = useMemo(() => {
    if (!tree || !diagnostics) return null;
    if (perMotor) {
      const ctxList = diagnostics.contexts[treeId];
      const ctx = ctxList?.[motorIdx];
      return ctx ? evaluateTree(tree, ctx) : null;
    }
    return diagnostics.results[treeId];
  }, [tree, diagnostics, treeId, motorIdx, perMotor]);

  if (!tree) return <div className="empty">Select a component to see its logic.</div>;

  return (
    <div>
      {perMotor && (
        <div className="motor-tabs">
          {frame.motors.map((m) => {
            const r = diagnostics?.perMotor?.[treeId]?.[m.index];
            return (
              <button
                key={m.index}
                className={`motor-tab ${motorIdx === m.index ? "on" : ""} ${
                  r?.tone === "bad" ? "bad" : ""
                }`}
                onClick={() => setMotorIdx(m.index)}
                title={`${m.position} · ${m.spinLabel}`}
              >
                {m.id}
              </button>
            );
          })}
        </div>
      )}

      <div className="tree-wrap">
        <div className="tree-title">{tree.title}</div>
        <div className="tree-sub">{tree.subtitle}</div>
        <TreeNode
          tree={tree}
          nodeId={tree.root}
          result={result}
          depth={0}
          seen={new Set()}
        />
      </div>
    </div>
  );
}

function TreeNode({ tree, nodeId, result, depth, seen }) {
  if (!nodeId || depth > 14 || seen.has(nodeId)) return null;
  const node = tree.nodes[nodeId];
  if (!node) return null;

  const nextSeen = new Set(seen);
  nextSeen.add(nodeId);

  const lit = result?.pathSet?.has(nodeId);
  const isTerminal = result?.terminalId === nodeId;
  const tone = lit ? (isTerminal ? result.tone : node.tone || "info") : "";

  if (node.type === "decision") {
    const taken = result?.branches?.[nodeId];
    return (
      <div className="tree-level">
        <div
          className={`tree-node decision ${lit ? "lit" : ""} ${tone}`}
          title={lit ? `Currently: ${taken === "yes" ? "YES" : "NO"}` : undefined}
        >
          {node.text}
        </div>

        <div className={`tree-branch ${taken === "no" ? "lit-no" : ""}`}>
          <span className={`branch-tag no ${taken === "no" ? "on" : ""}`}>NO</span>
          <div className="branch-body">
            <TreeNode
              tree={tree}
              nodeId={node.no}
              result={result}
              depth={depth + 1}
              seen={nextSeen}
            />
          </div>
        </div>

        <div className={`tree-branch ${taken === "yes" ? "lit-yes" : ""}`}>
          <span className={`branch-tag yes ${taken === "yes" ? "on" : ""}`}>YES</span>
          <div className="branch-body">
            <TreeNode
              tree={tree}
              nodeId={node.yes}
              result={result}
              depth={depth + 1}
              seen={nextSeen}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tree-level">
      <div
        className={`tree-node ${lit ? "lit" : ""} ${tone} ${isTerminal ? "terminal" : ""}`}
      >
        {node.text}
      </div>
      {node.next && (
        <>
          <div className="flow-arrow">&#8595;</div>
          <TreeNode
            tree={tree}
            nodeId={node.next}
            result={result}
            depth={depth + 1}
            seen={nextSeen}
          />
        </>
      )}
    </div>
  );
}
