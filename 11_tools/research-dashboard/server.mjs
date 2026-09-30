import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateProgress } from '../project-supervisor/progress-aggregator.mjs';
import { isDisabled, readControl } from '../../.codex/skills/farmer/farmer-control.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(MODULE_DIR, '../..');
const json = (file, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
};
const html = fs.readFileSync(path.join(MODULE_DIR, 'index.html'), 'utf8');

function serviceStatus() {
  const saved = json(path.join(ROOT, '_work/current/project-supervisor/processes.json'), {});
  const services = { ...(saved?.services || {}) };
  if (isDisabled(ROOT)) services.farmer = { status: 'disabled', detail: readControl(ROOT).reason || 'farmer disabled by control switch' };
  services.dashboard = {
    status: 'healthy',
    pid: process.pid,
    url: 'http://127.0.0.1:' + (process.env.RESEARCH_DASHBOARD_PORT || 4317) + '/api/health',
  };
  return services;
}

export function handler(req, res) {
  if (req.method !== 'GET') { res.writeHead(405); return res.end('Method Not Allowed'); }
  if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(html);
  }
  if (req.url === '/supervision.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(fs.readFileSync(path.join(MODULE_DIR, 'supervision.js'), 'utf8'));
  }
  if (req.url === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ service: 'muion-research-dashboard', project_root: ROOT, pid: process.pid }));
  }
  if (req.url === '/api/status') {
    try {
      const supervision = aggregateProgress(ROOT);
      const value = {
        generated_at: supervision.generated_at,
        supervision,
        system_services: { services: serviceStatus() },
      };
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(value));
    } catch (error) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ error: error.message }));
    }
  }
  res.writeHead(404);
  res.end('Not Found');
}

export function start({ port = Number(process.env.RESEARCH_DASHBOARD_PORT || 4317), host = '127.0.0.1' } = {}) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      console.log('research-dashboard listening on http://' + host + ':' + server.address().port);
      resolve(server);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) start().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
