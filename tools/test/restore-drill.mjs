#!/usr/bin/env node
// CI-only isolated recovery drill: never drop, truncate or restore into chatpm.
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {chmodSync,closeSync,existsSync,mkdtempSync,openSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {main as backup,listBackups} from '../ops/backup.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const project=['compose','-p','chatpm',
  ...(existsSync(join(root,'.env'))?['--env-file',join(root,'.env')]:[]),
  '-f','infra/compose.prod.yml'];
const prefix='chatpm_restore_drill_';

function docker(args,options={}){
  const p=spawnSync('docker',[...project,...args],{
    cwd:root,env:process.env,encoding:'utf8',maxBuffer:20*1024*1024,
    ...options,
  });
  if(p.error||p.status!==0)
    throw new Error('Restore drill Docker command failed: '+
      (p.error?.message||p.stderr?.trim()||'exit '+p.status));
  return p.stdout;
}
function archiveCommand(args,filename){
  const fd=openSync(filename,'r');
  try{
    return docker(args,{stdio:[fd,'pipe','pipe']});
  }finally{closeSync(fd);}
}
const fingerprintSql=[
  'CREATE TEMP TABLE restore_fp (name text, row_count bigint, checksum text);',
  'DO $restore$',
  'DECLARE item record;',
  'BEGIN',
  " FOR item IN SELECT schemaname,tablename FROM pg_tables",
  " WHERE schemaname='public' ORDER BY tablename LOOP",
  " EXECUTE format('INSERT INTO restore_fp SELECT %L,",
  " COUNT(*)::bigint,md5(COALESCE(string_agg(md5(to_jsonb(t)::text),",
  " %L ORDER BY md5(to_jsonb(t)::text)),%L)) FROM %I.%I t',",
  " item.schemaname||'.'||item.tablename,'','',",
  ' item.schemaname,item.tablename);',
  ' END LOOP;',
  'END $restore$;',
  "SELECT name||'|'||row_count||'|'||checksum FROM restore_fp ORDER BY name;",
].join('\n');

export function parseFingerprints(output){
  const entries=new Map();
  for(const line of output.trim().split('\n').filter(Boolean)){
    const match=/^(public\.[a-z_][a-z_0-9]*)\|(\d+)\|([a-f0-9]{32})$/.exec(line.trim());
    if(!match||entries.has(match[1]))
      throw new Error('Invalid or duplicated database fingerprint record');
    entries.set(match[1],{count:Number(match[2]),hash:match[3]});
  }
  return entries;
}
export function verifyFingerprints(source,recovered){
  const original=parseFingerprints(source),restored=parseFingerprints(recovered);
  if(!original.size||!original.has('public.schema_migrations')||
     (original.get('public.schema_migrations')?.count??0)<1||
     (original.get('public.users')?.count??0)<1)
    throw new Error('The source database is missing migrations or seeded user data');
  const mismatches=[...new Set([...original.keys(),...restored.keys()])]
    .filter(name=>JSON.stringify(original.get(name))!==JSON.stringify(restored.get(name)));
  if(mismatches.length)
    throw new Error('Restored schema/data differs in: '+mismatches.join(', '));
  return {tables:original.size,rows:[...original.values()].reduce((n,v)=>n+v.count,0)};
}
function fingerprints(database){
  // Validate the source and the restored DB by the same PostgreSQL engine.
  // Only SHA/row-count output leaves PostgreSQL, never confidential row values.
  return docker(['exec','-T','postgres','psql','-U','chatpm','-d',database,
    '-X','-A','-t','-q','-v','ON_ERROR_STOP=1'],{input:fingerprintSql});
}
export function main(){
  if(process.env.CI!=='true'||process.env.CHATPM_CI_RESTORE_DRILL!=='1')
    throw new Error('Isolated restore drill requires CI=true and CHATPM_CI_RESTORE_DRILL=1');
  const running=new Set(docker(['ps','--status','running','--services'])
    .split(/\s+/).filter(Boolean));
  if(!running.has('postgres'))
    throw new Error('PostgreSQL is not running in the isolated Docker CI stack');
  if(['web','api','worker'].some(name=>running.has(name)))
    throw new Error('Stop Web/API/Worker writers before an isolated restore drill');
  const target=prefix+randomBytes(8).toString('hex');
  const temp=mkdtempSync(join(tmpdir(),'chatpm-recovery-'));
  chmodSync(temp,0o700);
  let created=false,cleanupFailure;
  try{
    backup(['--docker','--dir='+temp,'--keep=1']);
    const filename=listBackups(readdirSync(temp))[0];
    if(!filename)throw new Error('No custom PostgreSQL backup was created');
    const archive=join(temp,filename);
    const contents=archiveCommand(['exec','-T','postgres','pg_restore','--list'],archive);
    if(!contents.includes('TABLE DATA'))
      throw new Error('Backup archive does not contain table data');
    const before=fingerprints('chatpm');
    docker(['exec','-T','postgres','createdb','-U','chatpm','-T','template0',target]);
    created=true;
    archiveCommand(['exec','-T','postgres','pg_restore','-U','chatpm',
      '--dbname',target,'--no-owner','--no-privileges','--exit-on-error'],archive);
    const after=fingerprints(target);
    const {tables,rows}=verifyFingerprints(before,after);
    console.log('Isolated PostgreSQL recovery verified: '+tables+
      ' public tables and '+rows+' rows match (all row fingerprints).');
  }finally{
    if(created){
      try{
        if(!target.startsWith(prefix))throw new Error('Unsafe recovery database name');
        docker(['exec','-T','postgres','dropdb','-U','chatpm','--if-exists',
          '--force',target]);
      }catch(err){cleanupFailure=err;}
    }
    rmSync(temp,{recursive:true,force:true});
    if(cleanupFailure)throw cleanupFailure;
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(error){
    console.error(error instanceof Error?error.message:'Restore drill failed');
    process.exitCode=1;
  }
}
