#!/usr/bin/env tsx
/**
 * Checks the conversation flow before it is pushed, against the rules Retell
 * enforces. Each rule here exists because the API rejected a real push.
 *
 *   npx tsx retell/validate-flow.ts
 *
 * Retell spreads transitions across several fields, not just `edges`, so a
 * naive walk reports nodes as unreachable when they are not.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const flow = JSON.parse(readFileSync(join(HERE, "demo-flow.json"), "utf8"));

type Edge = { id?: string; destination_node_id?: string };
type Node = Record<string, any> & { id: string };

/** Every field a transition can hide in. */
function edgesOf(node: Node): Edge[] {
  const out: Edge[] = [];
  if (Array.isArray(node.edges)) out.push(...node.edges);
  for (const key of ["else_edge", "edge", "skip_response_edge", "failure_edge"]) {
    if (node[key]) out.push(node[key] as Edge);
  }
  return out;
}

const nodes: Node[] = flow.nodes ?? [];
const ids = new Set(nodes.map((n) => n.id));
const tools = new Set((flow.tools ?? []).map((t: { name?: string }) => t.name));
const problems: string[] = [];

for (const node of nodes) {
  for (const edge of edgesOf(node)) {
    const dest = edge.destination_node_id;
    if (!dest) continue;
    if (!ids.has(dest)) problems.push(`${node.id}: edge ${edge.id} points at missing node ${dest}`);
    // Rejected by the API: "Edge destination node id cannot be the same as
    // the source node id". A conversation node already stays put when nothing
    // matches, so a self edge says nothing.
    if (dest === node.id) problems.push(`${node.id}: edge ${edge.id} points at its own node`);
  }

  if (node.type === "function" && !tools.has(node.tool_id)) {
    problems.push(`${node.id}: uses tool ${node.tool_id}, which is not declared`);
  }

  // Rejected by the API: "Node cannot have elseEdge together with
  // skipResponseEdge or alwaysEdge".
  if (node.else_edge && (node.skip_response_edge || node.always_edge)) {
    problems.push(`${node.id}: has else_edge alongside skip_response_edge or always_edge`);
  }

  // Rejected by the API: cool_down must be at least 1.
  const cool = node.global_node_setting?.cool_down;
  if (typeof cool === "number" && cool < 1) {
    problems.push(`${node.id}: global cool_down is ${cool}, the API requires at least 1`);
  }
}

// Reachability, counting global nodes as entry points since they can fire from
// anywhere in the conversation.
const reached = new Set<string>([flow.start_node_id]);
for (const n of nodes) if (n.global_node_setting) reached.add(n.id);
let grew = true;
while (grew) {
  grew = false;
  for (const node of nodes) {
    if (!reached.has(node.id)) continue;
    for (const edge of edgesOf(node)) {
      const dest = edge.destination_node_id;
      if (dest && !reached.has(dest)) {
        reached.add(dest);
        grew = true;
      }
    }
  }
}
for (const node of nodes) {
  if (!reached.has(node.id)) problems.push(`${node.id}: unreachable, nothing transitions to it`);
}

console.log(`flow: ${nodes.length} nodes, ${tools.size} tools, start ${flow.start_node_id}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("No problems found.");
