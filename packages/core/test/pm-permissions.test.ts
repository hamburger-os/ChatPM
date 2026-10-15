import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canProject } from '../src/permissions.ts';

test('formal PM permissions distinguish planning, submission, review and baseline approval',()=>{
  for(const action of ['pm.plan','pm.submit','pm.accept','pm.approve'] as const)
    assert.equal(canProject('observer',action),false);
  assert.equal(canProject('member','pm.plan'),false);
  assert.equal(canProject('member','pm.submit',{isAssignee:false}),false);
  assert.equal(canProject('member','pm.submit',{isAssignee:true}),true);
  assert.equal(canProject('member','pm.accept'),false);
  assert.equal(canProject('manager','pm.plan'),true);
  assert.equal(canProject('manager','pm.accept'),true);
  assert.equal(canProject('manager','pm.approve'),true);
  assert.equal(canProject('owner','pm.approve'),true);
});
