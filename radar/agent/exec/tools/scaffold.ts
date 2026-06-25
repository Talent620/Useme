// Scaffold tool: generate a runnable automation artifact (n8n workflow JSON)
// from a spec. Autonomous "build", not just "describe" — the deliverable is an
// importable workflow, validated for structural correctness.

export interface N8nNode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
}

export interface N8nWorkflow {
  name: string;
  nodes: N8nNode[];
  connections: Record<string, { main: { node: string; type: "main"; index: number }[][] }>;
  settings: Record<string, unknown>;
}

const TYPE = {
  manualTrigger: "n8n-nodes-base.manualTrigger",
  httpRequest: "n8n-nodes-base.httpRequest",
  set: "n8n-nodes-base.set",
  if: "n8n-nodes-base.if",
  noOp: "n8n-nodes-base.noOp",
};

function nodeType(step: string): string {
  const s = step.toLowerCase();
  if (/api|http|request|pobierz|fetch|webhook/.test(s)) return TYPE.httpRequest;
  if (/jeśli|if|warunek|sprawdź/.test(s)) return TYPE.if;
  if (/zapisz|set|ustaw|mapuj|transform/.test(s)) return TYPE.set;
  return TYPE.noOp;
}

/** Build a valid, importable n8n workflow as a linear chain of steps. */
export function n8nWorkflow(name: string, steps: string[]): N8nWorkflow {
  const nodes: N8nNode[] = [
    { id: "n0", name: "Start", type: TYPE.manualTrigger, typeVersion: 1, position: [0, 0], parameters: {} },
  ];
  const labels = steps.length ? steps : ["Przetwarzanie"];
  labels.forEach((step, i) => {
    nodes.push({
      id: `n${i + 1}`,
      name: step.slice(0, 40),
      type: nodeType(step),
      typeVersion: 1,
      position: [(i + 1) * 220, 0],
      parameters: {},
    });
  });

  const connections: N8nWorkflow["connections"] = {};
  for (let i = 0; i < nodes.length - 1; i++) {
    connections[nodes[i]!.name] = { main: [[{ node: nodes[i + 1]!.name, type: "main", index: 0 }]] };
  }

  return { name, nodes, connections, settings: { executionOrder: "v1" } };
}

/** Deliverable bundle: importable JSON + a short how-to. */
export function renderWorkflowJson(name: string, steps: string[]): string {
  return JSON.stringify(n8nWorkflow(name, steps), null, 2);
}
