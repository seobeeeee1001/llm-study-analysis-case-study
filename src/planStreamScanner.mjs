/**
 * Adapted from the plan-first SSE scanner used in the source project.
 * Only a complete plan object, followed by complete detail objects, is emitted.
 * push() accepts arbitrary text chunk boundaries; finish() rejects truncated output.
 */
export function createPlanStreamScanner(expectPlan, onPlan, onDetail) {
  let stage = "start";
  let leading = "", trailing = "", fenced = false;
  let field = "", key = "", readingKey = false, escaped = false;
  let capture = "", stack = [], quoted = false, capturing = null;
  let detailCount = 0, arrayCanEnd = true;
  const keys = new Set();
  const fail = () => { throw new Error("Invalid plan-first JSON stream order/syntax"); };
  const startCapture = (kind) => {
    capturing = kind;
    capture = "{";
    stack = ["{"];
    quoted = false;
    escaped = false;
  };

  const push = (chunk) => {
    for (const char of chunk) {
      if (stage === "start") {
        if (char === "{") {
          if (leading.trim() && !/^```(?:json)?[ \t]*\r?\n\s*$/.test(leading.trimStart())) fail();
          fenced = !!leading.trim();
          stage = "key";
        } else {
          leading += char;
          if (leading.length > 64) fail();
        }
        continue;
      }
      if (stage === "end") {
        trailing += char;
        if (!(fenced ? /^[\s`]*$/ : /^\s*$/).test(trailing)) fail();
        continue;
      }
      if (capturing) {
        capture += char;
        if (quoted) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === '"') quoted = false;
        } else if (char === '"') quoted = true;
        else if (char === "{" || char === "[") stack.push(char);
        else if (char === "}" || char === "]") {
          if (stack.pop() !== (char === "}" ? "{" : "[")) fail();
          if (!stack.length) {
            const kind = capturing;
            capturing = null;
            const value = JSON.parse(capture);
            capture = "";
            if (kind === "plan") {
              stage = "separator";
              onPlan(value);
            } else {
              stage = "arraySeparator";
              onDetail(value, detailCount++);
            }
          }
        }
        continue;
      }
      if (readingKey) {
        key += char;
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') {
          readingKey = false;
          field = JSON.parse(key);
          if (keys.has(field)
            || (keys.size === 0 && field !== (expectPlan ? "plan" : "details"))
            || (keys.size > 0 && field !== "details")) fail();
          keys.add(field);
          stage = "colon";
        }
        continue;
      }
      if (/\s/.test(char)) continue;
      if (stage === "key" && char === '"') { readingKey = true; key = '"'; escaped = false; }
      else if (stage === "colon" && char === ":") stage = "value";
      else if (stage === "value" && field === "plan" && char === "{") startCapture("plan");
      else if (stage === "value" && field === "details" && char === "[") { stage = "arrayItem"; arrayCanEnd = true; }
      else if (stage === "separator" && char === "," && !keys.has("details")) stage = "key";
      else if (stage === "separator" && char === "}" && keys.has("details")) stage = "end";
      else if (stage === "arrayItem" && char === "{") startCapture("detail");
      else if (stage === "arrayItem" && char === "]" && arrayCanEnd) stage = "separator";
      else if (stage === "arraySeparator" && char === ",") { stage = "arrayItem"; arrayCanEnd = false; }
      else if (stage === "arraySeparator" && char === "]") stage = "separator";
      else fail();
    }
  };
  return {
    push,
    finish() {
      if (stage !== "end" || capturing || readingKey
        || !(fenced ? /^\s*```\s*$/.test(trailing) : /^\s*$/.test(trailing))) fail();
    },
    get detailCount() { return detailCount; },
  };
}
