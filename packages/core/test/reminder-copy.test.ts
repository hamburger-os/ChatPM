import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reminderCopy } from '../src/automation/reminder-copy.ts';

const base={displayName:'李工',title:'完成接口联调',blocked:false};
test('an overdue reminder must not claim zero days remaining',()=>{
  const content=reminderCopy({...base,daysUntilDue:-2});
  assert.match(content,/【已逾期】/);
  assert.match(content,/已逾期 2 天/);
  assert.doesNotMatch(content,/距截止还有 0 天/);
});
test('reminder on the deadline day says due today',()=>{
  const content=reminderCopy({...base,daysUntilDue:0});
  assert.match(content,/今天截止/);
  assert.doesNotMatch(content,/距截止还有 0 天/);
});
test('blocked reminder keeps priority even when overdue',()=>{
  const content=reminderCopy({...base,blocked:true,daysUntilDue:-1});
  assert.match(content,/【阻塞需关注】/);
  assert.match(content,/已逾期 1 天/);
});
test('ordinary reminder preserves stage and near-due classification',()=>{
  assert.match(reminderCopy({...base,daysUntilDue:10}),/【阶段进展检查】/);
  assert.match(reminderCopy({...base,daysUntilDue:3}),/【临近截止】/);
});
