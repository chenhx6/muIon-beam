import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, projectRootFromHere, jsonWrite } from './project-utils.mjs';

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function git(root,args,binary=false) {
  const result=spawnSync('git',['-C',root,...args],{encoding:binary?null:'utf8',windowsHide:true,maxBuffer:100*1024*1024,timeout:60000});
  if(result.status!==0) throw new Error(String(result.stderr||'Git snapshot read failed'));
  return binary?result.stdout:result.stdout.trim();
}

// Capture Git objects, never the dirty working tree or .git directory.
// Ordinary infrastructure commits need no fabricated scientific-result tag.
export function archiveCommittedProject({root,driveRoot,commit='HEAD',remote='origin',onProgress=()=>{}}) {
  root=path.resolve(root); driveRoot=path.resolve(driveRoot);
  const resolved=git(root,['rev-parse',`${commit}^{commit}`]);
  const remoteCommit=git(root,['ls-remote',remote,'refs/heads/main']).split(/\s+/)[0];
  if(remoteCommit!==resolved) throw new Error('snapshot commit must equal the verified remote main before copying');
  const snapshotId=`SNAPSHOT-${resolved.slice(0,12)}`;
  const destination=path.join(driveRoot,'project/snapshots',snapshotId);
  const entries=git(root,['ls-tree','-r','-z',resolved]).split('\0').filter(Boolean).map(row=>{
    const tab=row.indexOf('\t'); const [mode,type,object]=row.slice(0,tab).split(' '); const file=row.slice(tab+1);
    if(type!=='blob'||!['100644','100755'].includes(mode))throw new Error(`unsupported recovery object: ${file}`);
    if(path.isAbsolute(file)||file.split('/').some(part=>part==='..'||part==='.git')||file==='_snapshot-receipt.json')throw new Error(`invalid snapshot path: ${file}`);
    return {path:file,object,mode};
  });
  const files=[];
  for(const entry of entries) {
    const bytes=git(root,['cat-file','blob',entry.object],true); const sha256=digest(bytes);
    const target=path.resolve(destination,entry.path);
    if(!target.startsWith(path.resolve(destination)+path.sep))throw new Error('snapshot path escaped destination');
    fs.mkdirSync(path.dirname(target),{recursive:true});
    if(fs.existsSync(target)) {
      if(digest(fs.readFileSync(target))!==sha256)throw new Error(`existing snapshot differs; preserve both: ${entry.path}`);
    } else fs.writeFileSync(target,bytes,{flag:'wx'});
    const copied=fs.readFileSync(target);
    if(copied.length!==bytes.length||digest(copied)!==sha256)throw new Error(`Drive verification failed: ${entry.path}`);
    files.push({path:entry.path,size:bytes.length,sha256,git_mode:entry.mode});
    if(files.length%200===0)onProgress({copied:files.length,total:entries.length});
  }
  const expected=new Set(files.map(file=>file.path)); const actual=[];
  const visit=directory=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const full=path.join(directory,entry.name);if(entry.isDirectory())visit(full);else actual.push(path.relative(destination,full).replaceAll('\\','/'));}};
  visit(destination);
  if(actual.filter(file=>file!=='_snapshot-receipt.json').some(file=>!expected.has(file)))throw new Error('unexpected files in snapshot; preserve and inspect before declaring verified');
  if(git(root,['ls-remote',remote,'refs/heads/main']).split(/\s+/)[0]!==resolved)throw new Error('remote main changed during snapshot verification');
  const receipt={schema_version:1,record_type:'committed-project-snapshot',snapshot_id:snapshotId,commit:resolved,remote_commit_at_verification:remoteCommit,verified_at:new Date().toISOString(),status:'mapped-drive-verified',verification:{mapped_drive:'file-count-size-sha256-verified',cloud_upload:'not-verified-by-filesystem-copy'},scope:'committed-Git-tree-only; excludes uncommitted local work and runtime',drive_path:destination,file_count:files.length,total_bytes:files.reduce((sum,file)=>sum+file.size,0),manifest_sha256:digest(JSON.stringify(files)),files};
  jsonWrite(path.join(destination,'_snapshot-receipt.json'),receipt);
  jsonWrite(path.join(root,'00_project/traceability/project-snapshots',`${snapshotId}.json`),receipt);
  jsonWrite(path.join(driveRoot,'project/recovery-index','latest-committed-project.json'),{schema_version:1,snapshot_id:snapshotId,commit:resolved,path:destination,receipt:'_snapshot-receipt.json',scope:receipt.scope,verified_at:receipt.verified_at});
  return receipt;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=parseArgs(process.argv.slice(2));
  try{
    if(!args.drive_root)throw new Error('--drive-root is required');
    const result=archiveCommittedProject({root:args.project_root||projectRootFromHere(),driveRoot:args.drive_root,commit:args.commit||'HEAD',onProgress:value=>console.error(JSON.stringify(value))});
    console.log(JSON.stringify({...result,files:undefined},null,2));
  }catch(error){
    const root=path.resolve(args.project_root||projectRootFromHere());
    const id=digest(JSON.stringify({commit:args.commit||'HEAD',drive_root:args.drive_root||null})).slice(0,24);
    jsonWrite(path.join(root,'_work/current/snapshot-outbox',`${id}.json`),{status:'pending',commit:args.commit||'HEAD',drive_root:args.drive_root||null,error:error.message,recorded_at:new Date().toISOString(),next_action:'retry same immutable snapshot; preserve conflicting or partial destination'});
    console.error(error.message);process.exitCode=1;
  }
}
