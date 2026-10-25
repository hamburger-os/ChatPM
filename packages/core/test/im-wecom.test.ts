import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { WSClient, WsFrame, BaseMessage } from '@wecom/aibot-node-sdk';
import { inboundIdentity } from '../../im/src/contracts.ts';
import { normalizeWecomText, WecomAdapter, WECOM_CAPABILITIES } from '../../im/src/wecom.ts';

function frame(body: Record<string, unknown>): WsFrame<BaseMessage> {
  return { body } as unknown as WsFrame<BaseMessage>;
}
function group(msgid = 'm1'): WsFrame<BaseMessage> {
  return frame({ msgid, msgtype: 'text', aibotid: 'b1', chattype: 'group',
    chatid: 'g1', from: { userid: 'person' }, text: { content: '@项目经理 查询进度' } });
}
class FakeClient extends EventEmitter {
  sent: Array<[string, string]> = [];
  connect(): this { return this; }
  disconnect(): void {}
  async sendMessage(to: string, body: { markdown: { content: string } }): Promise<object> {
    this.sent.push([to, body.markdown.content]); return {};
  }
}
test('normalize WeCom group text without trusting nicknames or another bot', () => {
  const event = normalizeWecomText(group(), 'b1');
  assert.ok(event);
  assert.equal(event.externalActorId, 'person');
  assert.equal(event.route.externalConversationId, 'g1');
  assert.equal(inboundIdentity(event), JSON.stringify(['wecom','b1','m1']));
  assert.equal(normalizeWecomText(group(), 'b2'), null);
  assert.equal(normalizeWecomText(frame({
    msgid:'m2',aibotid:'b1',msgtype:'text',chattype:'group',
    from:{userid:'person'},text:{content:'hello'},
  }),'b1'), null);
});
test('unsupported media and passive group capture are not claimed', () => {
  assert.equal(normalizeWecomText(frame({
    msgid:'f1',aibotid:'b1',msgtype:'file',chattype:'group',
    chatid:'g1',from:{userid:'person'},
  }),'b1'), null);
  assert.equal(WECOM_CAPABILITIES.passiveGroupMessages, false);
  assert.equal(WECOM_CAPABILITIES.groupHistory, false);
  assert.equal(WECOM_CAPABILITIES.attachments, false);
});
test('authenticated connection gates sends; SDK callbacks are not implicitly deduplicated', async () => {
  const sdk = new FakeClient();
  const events: string[] = [];
  const adapter = new WecomAdapter({
    botId:'b1',secret:'secret',createClient:()=>sdk as unknown as WSClient,
    accept:async e=>{events.push(e.externalMessageId);},
  });
  await adapter.start();
  const outbound = {accountId:'b1',route:{kind:'group' as const,externalConversationId:'g1'},text:'report'};
  await assert.rejects(adapter.send(outbound), /not authenticated/);
  sdk.emit('message', group('pre-auth'));
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.deepEqual(events, [], 'inbound events must be authenticated first');
  sdk.emit('authenticated');
  sdk.emit('message', group());
  sdk.emit('message', group());
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.deepEqual(events, ['m1','m1']);
  assert.equal((await adapter.send(outbound)).state,'accepted');
  assert.deepEqual(sdk.sent,[['g1','report']]);
  sdk.emit('disconnected');
  sdk.emit('message', group('offline'));
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.deepEqual(events, ['m1','m1']);
  await assert.rejects(adapter.send(outbound), /not authenticated/);
  sdk.emit('authenticated');
  await assert.rejects(adapter.send({...outbound,accountId:'b2'}), /mismatch/);
  await adapter.stop();
  sdk.emit('message',group('late'));
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.deepEqual(events,['m1','m1']);
});
test('WeCom catches sink rejection and exposes only a diagnostic code', async () => {
  const sdk = new FakeClient();
  const errors: string[] = [];
  const adapter = new WecomAdapter({
    botId:'b1',secret:'sensitive',createClient:()=>sdk as unknown as WSClient,
    accept:async()=>{throw new Error('database unavailable');},
    onError:code=>errors.push(code),
  });
  assert.equal(normalizeWecomText(frame({
    msgid:'d1',aibotid:'b1',msgtype:'text',chattype:'single',
    from:{userid:'person'},text:{content:'hello'},
  }),'b1')?.route.externalConversationId,'person');
  await adapter.start(); sdk.emit('authenticated'); sdk.emit('message',group());
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.deepEqual(errors,['wecom-inbound-persistence-failed']);
  await adapter.stop();
});
