// Dependency-free YAML subset reader used by the project metadata tools.
// It supports maps, lists, scalar values, and inline arrays used by the templates.
import fs from 'node:fs';

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function scalar(value) {
  const text = value.trim();
  if (text === '' || text === 'null' || text === '~') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text.startsWith('[') && text.endsWith(']')) {
    const body = text.slice(1, -1).trim();
    if (!body) return [];
    return body.split(',').map((item) => scalar(item));
  }
  if (text.startsWith('{') && text.endsWith('}')) {
    try { return JSON.parse(text); } catch { return text; }
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return unquote(text);
}

function splitKeyValue(text) {
  const index = text.indexOf(':');
  if (index < 0) return [text.trim(), ''];
  return [text.slice(0, index).trim(), text.slice(index + 1).trim()];
}

function nextMeaningful(lines, index) {
  for (let i = index + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed && !trimmed.startsWith('#')) return { indent: lines[i].length - lines[i].trimStart().length, text: trimmed };
  }
  return null;
}

export function parseYaml(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const root = {};
  const stack = [{ indent: -1, value: root }];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed === '---') continue;
    const indent = line.length - line.trimStart().length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].value;

    if (trimmed === '-' || trimmed.startsWith('- ')) {
      if (!Array.isArray(parent)) throw new Error(`List item without list parent at line ${index + 1}`);
      const body = trimmed.slice(1).trim();
      if (!body) {
        const child = [];
        parent.push(child);
        stack.push({ indent, value: child });
        continue;
      }
      const [key, value] = splitKeyValue(body);
      if (body.includes(':')) {
        const object = {};
        parent.push(object);
        if (value === '') {
          const next = nextMeaningful(lines, index);
          const child = next && next.indent > indent && next.text.startsWith('-') ? [] : {};
          object[key] = child;
          stack.push({ indent, value: object });
          stack.push({ indent: indent + 1, value: child });
        } else {
          object[key] = scalar(value);
          stack.push({ indent, value: object });
        }
      } else {
        parent.push(scalar(body));
      }
      continue;
    }

    if (typeof parent !== 'object' || Array.isArray(parent)) throw new Error(`Mapping item without map parent at line ${index + 1}`);
    const [key, value] = splitKeyValue(trimmed);
    if (!key) throw new Error(`Empty key at line ${index + 1}`);
    if (value === '') {
      const next = nextMeaningful(lines, index);
      const child = next && next.indent > indent && next.text.startsWith('-') ? [] : {};
      parent[key] = child;
      stack.push({ indent, value: child });
    } else {
      parent[key] = scalar(value);
    }
  }
  return root;
}

export function parseYamlFile(filePath) {
  return parseYaml(fs.readFileSync(filePath, 'utf8'));
}
