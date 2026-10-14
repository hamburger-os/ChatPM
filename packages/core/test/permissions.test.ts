import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertProject,canProject } from '../src/permissions.ts';

test('project action authorization denies observer mutations and member planning',()=>{
  assert.equal(canProject('observer','read'),true);
  for(const action of ['message.write','task.create','task.plan','task.status',
    'proposal.approve','members.manage'] as const){
    assert.equal(canProject('observer',action),false);
  }
  assert.equal(canProject('member','task.create'),false);
  assert.equal(canProject('member','task.plan'),false);
  assert.equal(canProject('member','task.status',{isAssignee:true}),true);
  assert.equal(canProject('member','task.status',{isAssignee:false}),false);
  assert.equal(canProject('manager','task.plan'),true);
  assert.equal(canProject('manager','proposal.approve'),true);
  assert.equal(canProject('manager','members.manage'),false);
  assert.equal(canProject('owner','members.manage'),true);
  assert.throws(()=>assertProject('observer','task.create'),/没有执行该操作的权限/);
});
