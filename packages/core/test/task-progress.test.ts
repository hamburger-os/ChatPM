import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDuplicateActiveTask } from '../src/task-progress.ts';

test('duplicate task recognition normalizes Chinese punctuation and whitespace',()=>{
  assert.equal(isDuplicateActiveTask('完成 评估测试系统的方案设计！',
    ['完成评估测试系统的方案设计']),true);
  assert.equal(isDuplicateActiveTask('评估测试系统的方案设计',
    ['完成评估测试系统的方案设计']),true);
  assert.equal(isDuplicateActiveTask('搭建单点登录',['完成评估测试系统的方案设计']),false);
});
test('short generic phrases do not silently suppress new work',()=>{
  assert.equal(isDuplicateActiveTask('测试',['测试']),false);
});
