import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {
  SSE_DRAIN_TIMEOUT_MS,writeSseFrame,
} from '../../apps/api/src/message-stream-routes.ts';

class FakeSocket extends EventEmitter{
  constructor(canWrite=false){super();this.canWrite=canWrite;this.frames=[];}
  write(chunk){this.frames.push(chunk);return this.canWrite;}
}
const noLeaks=socket=>{
  assert.equal(socket.listenerCount('close'),0);
  assert.equal(socket.listenerCount('drain'),0);
};

test('SSE immediate write has no backpressure subscriptions',async()=>{
  const socket=new FakeSocket(true);
  assert.equal(await writeSseFrame(socket,'id: 2\\ndata: {}\\n\\n'),true);
  assert.deepEqual(socket.frames,['id: 2\\ndata: {}\\n\\n']);
  noLeaks(socket);
  assert.equal(SSE_DRAIN_TIMEOUT_MS,10000,
    'Production slow/half-open client must have a fixed upper bound');
});

test('SSE backpressure resumes only on real drain and clears its listeners',async()=>{
  const socket=new FakeSocket();
  const delivery=writeSseFrame(socket,'data: one\\n\\n',500);
  assert.equal(socket.listenerCount('drain'),1);
  assert.equal(socket.listenerCount('close'),1);
  socket.emit('drain');
  assert.equal(await delivery,true);
  noLeaks(socket);
  socket.emit('close');
  noLeaks(socket);
});

test('SSE remote close resolves a pending write without cursor advancement',async()=>{
  const socket=new FakeSocket();
  const delivery=writeSseFrame(socket,'data: one\\n\\n',500);
  socket.emit('close');
  assert.equal(await delivery,false);
  noLeaks(socket);
  socket.emit('drain');
  noLeaks(socket);
});

test('SSE half-open client cannot wait forever for drain',async()=>{
  const socket=new FakeSocket();
  // Keep the unit test alive independently of the server's intentionally
  // unref()'d drain deadline, so the false outcome is truly asserted.
  const watchdog=setTimeout(()=>{},250);
  try{
    const delivery=writeSseFrame(socket,'data: blocked\\n\\n',20);
    assert.equal(await delivery,false,
      'Unresponsive browser must release the connection after bounded time');
    noLeaks(socket);
    socket.emit('drain');
    noLeaks(socket);
  }finally{clearTimeout(watchdog);}
});
