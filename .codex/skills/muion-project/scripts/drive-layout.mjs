import path from 'node:path';
import { isPathInside, relativePath } from './project-utils.mjs';

export const DEFAULT_DRIVE_ARCHIVE_ROOT = 'H:\\我的云端硬盘\\muIon_archive';
export const CANONICAL_MIRROR_NAME = 'muIon-beam';

export function canonicalDriveMirrorRoot(explicitRoot) {
  if (explicitRoot) return path.resolve(explicitRoot);
  const archiveRoot = process.env.MUION_DRIVE_ARCHIVE_ROOT || DEFAULT_DRIVE_ARCHIVE_ROOT;
  return path.resolve(archiveRoot, CANONICAL_MIRROR_NAME);
}

export function defaultProjectMirrorPath(explicitPath) {
  return explicitPath ? path.resolve(explicitPath) : canonicalDriveMirrorRoot();
}

export function defaultRunMirrorPath(projectRoot, runDir, runId, explicitPath) {
  if (explicitPath) return path.resolve(explicitPath);
  const root = path.resolve(projectRoot); const source = path.resolve(runDir);
  const relative = relativePath(root, source);
  if (!isPathInside(source, path.join(root, '03_runs')) || relative === '03_runs') {
    throw new Error('run archive must keep a project-relative path below 03_runs');
  }
  return path.join(canonicalDriveMirrorRoot(), relative);
}

export function defaultExternalLibraryMirrorRoot(explicitRoot) {
  if (explicitRoot) return path.resolve(explicitRoot);
  return path.join(canonicalDriveMirrorRoot(), '06_external_lib');
}

export function assertMirrorDoesNotContainProject(mirrorRoot, projectRoot) {
  if (isPathInside(mirrorRoot, projectRoot) || isPathInside(projectRoot, mirrorRoot)) {
    throw new Error('Drive mirror root and project root must be separate');
  }
}
