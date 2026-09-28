/** Minimal, self-contained version of the source-plan invariants. */
export function validateDocument(document) {
  if (!Array.isArray(document?.blocks) || document.blocks.length === 0) {
    throw new Error("Document needs at least one source block");
  }
  const ids = new Set();
  for (const block of document.blocks) {
    if (typeof block?.id !== "string" || !block.id || typeof block.text !== "string") {
      throw new Error("Invalid source block");
    }
    if (ids.has(block.id)) throw new Error("Duplicate source block ID");
    ids.add(block.id);
  }
  return document;
}

export function validatePlan(document, plan) {
  validateDocument(document);
  if (!Array.isArray(plan?.topics) || plan.topics.length === 0) {
    throw new Error("Plan needs at least one topic");
  }
  const assigned = [];
  const topicIds = new Set();
  for (const topic of plan.topics) {
    if (typeof topic?.id !== "string" || !topic.id
      || typeof topic.title !== "string" || !topic.title.trim()
      || !Array.isArray(topic.blockIds) || topic.blockIds.length === 0) {
      throw new Error("Invalid planned topic");
    }
    if (topicIds.has(topic.id)) throw new Error("Duplicate topic ID");
    topicIds.add(topic.id);
    assigned.push(...topic.blockIds);
  }
  const sourceIds = document.blocks.map((block) => block.id);
  if (JSON.stringify(assigned) !== JSON.stringify(sourceIds)) {
    throw new Error("Plan must assign every source block exactly once, in order");
  }
  return plan;
}

export function validateDetail(spec, detail) {
  const topic = detail?.topic;
  if (topic?.id !== spec.id || topic.title !== spec.title
    || !Array.isArray(topic.points) || topic.points.length === 0) {
    throw new Error("Detail changed its planned topic or has no points");
  }
  const pointIds = new Set();
  for (const point of topic.points) {
    if (typeof point?.id !== "string" || !point.id || pointIds.has(point.id)
      || typeof point.text !== "string" || !point.text.trim()
      || !spec.blockIds.includes(point.evidenceBlockId)) {
      throw new Error("Point has no valid evidence in its assigned source range");
    }
    pointIds.add(point.id);
  }
  return detail;
}
