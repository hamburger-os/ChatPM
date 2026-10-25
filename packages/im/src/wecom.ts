import { WSClient, type WsFrame, type BaseMessage } from '@wecom/aibot-node-sdk';
import type { ChannelAdapter, ChannelCapabilities, AcceptInbound, InboundText, OutboundText } from './contracts.ts';

/**
 * WeCom intelligent-bot transport: a group @mention is NOT general group archive access.
 * The SDK owns authentication, heartbeats and reconnects.
 */
export const WECOM_CAPABILITIES: ChannelCapabilities = Object.freeze({
  directMessages: true, groupMentions: true, passiveGroupMessages: false,
  groupHistory: false, proactiveText: true, interactiveCards: false,
  attachments: false,
});
// The upstream SDK debug logger prints complete inbound bodies and may include
// sensitive project text. Do not forward SDK diagnostics to application logs.
const privateSdkLogger = Object.freeze({
  debug() {}, info() {}, warn() {}, error() {},
});
const id = (v: unknown): string | null => (
  typeof v === 'string' && v.trim() && v.trim() === v ? v : null
);

export function normalizeWecomText(frame: WsFrame<BaseMessage>, botId: string): InboundText | null {
  const body = frame?.body;
  if (!body || body.msgtype !== 'text' || body.aibotid !== botId) return null;
  const externalMessageId = id(body.msgid);
  const externalActorId = id(body.from?.userid);
  const kind = body.chattype === 'group' ? 'group'
    : body.chattype === 'single' ? 'direct' : null;
  const externalConversationId = kind === 'group' ? id(body.chatid) : externalActorId;
  const content = body.text?.content;
  const text = typeof content === 'string' ? content.trim() : '';
  if (!externalMessageId || !externalActorId || !kind || !externalConversationId
    || !text || Array.from(text).length > 10_000) return null;
  const seconds = body.create_time;
  const sourceCreatedAt = typeof seconds === 'number' && Number.isFinite(seconds)
    && seconds > 0 && seconds * 1000 <= 8.64e15
    ? new Date(seconds * 1000).toISOString() : null;
  return {
    channel: 'wecom', accountId: botId, externalMessageId, externalActorId,
    route: { kind, externalConversationId }, text, sourceCreatedAt,
  };
}

export interface WecomOptions {
  botId: string;
  secret: string;
  /** MUST durably persist, deduplicate and authorize before any downstream effect. */
  accept: AcceptInbound;
  /** No message content, secrets or raw SDK errors should go to diagnostics. */
  onError?: (code: string) => void;
  /** For offline SDK boundary tests only. */
  createClient?: () => WSClient;
}

export class WecomAdapter implements ChannelAdapter {
  readonly id = 'wecom' as const;
  readonly capabilities = WECOM_CAPABILITIES;
  private client: WSClient | null = null;
  private ready = false;
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly options: WecomOptions) {
    if (!id(options.botId) || !options.secret || typeof options.accept !== 'function') {
      throw new TypeError('WeCom bot identity, secret and sink required');
    }
  }

  async start(): Promise<void> {
    if (this.client) return;
    const client = this.options.createClient?.() ?? new WSClient({
      botId: this.options.botId, secret: this.options.secret,
      logger: privateSdkLogger,
    });
    this.client = client;
    this.ready = false;
    client.on('authenticated', () => { if (this.client === client) this.ready = true; });
    client.on('disconnected', () => { if (this.client === client) this.ready = false; });
    client.on('error', () => {
      if (this.client === client) this.options.onError?.('wecom-connection-error');
    });
    client.on('message', (frame: WsFrame<BaseMessage>) => {
      if (this.client !== client || !this.ready) return;
      const event = normalizeWecomText(frame, this.options.botId);
      if (!event) return;
      // SDK may redeliver; persistence, not an in-memory Set, is the idempotency authority.
      const work = Promise.resolve().then(async () => {
        if (this.client !== client || !this.ready) return;
        await this.options.accept(event);
      }).catch(() => {
        this.options.onError?.('wecom-inbound-persistence-failed');
      });
      this.pending.add(work);
      void work.finally(() => this.pending.delete(work));
    });
    try {
      client.connect(); // SDK reports authentication later.
    } catch (error) {
      this.client = null;
      this.ready = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    const old = this.client;
    this.client = null;
    this.ready = false;
    old?.disconnect();
    await Promise.allSettled([...this.pending]);
  }

  async send(message: OutboundText): Promise<{ state: 'accepted' }> {
    if (!this.ready || !this.client) {
      throw Object.assign(new Error('WeCom bot not authenticated'), { code: 'BOT_NOT_CONNECTED' });
    }
    if (message.accountId !== this.options.botId) {
      throw Object.assign(new Error('WeCom bot identity mismatch'), { code: 'BOT_MISMATCH' });
    }
    const destination = id(message.route?.externalConversationId);
    const text = typeof message.text === 'string' ? message.text.trim() : '';
    if (!destination || !['direct', 'group'].includes(message.route?.kind)
      || !text || Buffer.byteLength(text, 'utf8') > 6000) {
      throw new TypeError('Invalid WeCom destination or text');
    }
    await this.client.sendMessage(destination, {
      msgtype: 'markdown', markdown: { content: text },
    });
    return { state: 'accepted' };
  }
}
